# サイト工場（型の量産と運用の自動化）設計書 v1.2

対象: REYZ 自身のサイト（reyz.inc）の修正・運用と、REYZ が顧客のホームページを制作・運用する場合の、制作から運用・更新・失効対応までの全作業。
目的: **人が行う操作を「承認・本人確認・支払い・契約」だけにする。** それ以外（作成・設定・検証・配備・監視・記録・鍵の更新）は宣言と workflow が行う。
更新日: 2026-10-01 v1.2（D1〜D6 の Full Cycle 検証、D8（公開先）を追加、U2・U3・U5・U7 を更新。v1.1: D6・D7 追加。v1: 初版 2026-09-30）。決定: [ADR-0009](adr/0009-site-factory-declarative-provisioning.md)。

## 1. 今回（2026-09-28〜30、reyz.inc）の手動作業の棚卸し（FACT）

| 領域 | 手動で行った作業 | 回数（概数） | 自動化の分類 | 方法 |
|---|---|---|---|---|
| GitHub | Secrets / Variables の登録・更新・削除 | 14 | **A 完全自動化**（API） | 値を人が扱わない: 発行元 API → workflow → `gh secret set`（App 権限）。人が見るのは名前だけ |
| GitHub | PR のマージ | 20 | **H 人の承認**（残す） | 関門 4 件が通った PR を承認する行為そのもの。減らすのは「PR の数」（1 変更 1 PR、修正の連鎖を設計で防ぐ） |
| GitHub | Run workflow（再配備・確認） | 6 | A | 起動は workflow 同士が行う（`oauth-consent` → `contact-worker` の例）。人が押すのは「初回」だけ |
| GitHub | ルールセット作成、Pages 有効化、App 作成 | 3 | A（App 作成のみ **S 1 回の準備**） | REST API（rulesets / pages / secrets / environments）。App は組織に 1 つ作れば全 repo で使える |
| Cloudflare | API トークン作成（誤った権限で 1 回作り直し） | 2 | S 1 回の準備 → 以後 A | 「トークンを作るトークン」による自己ローテーション（未確認 → §6） |
| Cloudflare | Turnstile ウィジェット作成・秘密キーのローテーション（画面に秘密が出て露出事故） | 2 | **A**（API: create / rotate_secret が秘密を返す） | workflow が作成・回転し、秘密を直接 GitHub Secret へ。人は秘密を見ない |
| Cloudflare | DNS、Workers ルート、ゾーン | 0（DNS as code 済） | A（済） | `infra/cloudflare` の宣言 → `cloudflare-dns` workflow |
| Google Workspace | エイリアス作成・削除、ユーザー作成、送信元エイリアス削除 | 7 | A（Admin SDK Directory API） | 専用の管理ユーザー（限定ロール）の OAuth 同意（自動化済みの型を流用）→ workflow |
| Google Workspace | 2 段階認証の登録（バックアップコード発行、登録期間の変更、認証アプリ登録） | 4 | **H 本人操作**（残す。ただし手順を先頭に固定して事故を防ぐ） | 代替（2SV 免除の OU）は安全性を下げるため採らない（DECISION D4） |
| Google Workspace | ドメイン全体の委任の追加・削除 | 2 | 廃止（ADR-0007） | — |
| GCP | 組織作成、プロジェクト作成（個人口座で 1 回誤り）、API 有効化、サービスアカウント作成・鍵・削除 | 7 | A（Resource Manager / Service Usage API）。組織作成は S 1 回 | 顧客向けには **不要にする**（D1: 顧客サイトは送信事業者 API を既定にし、GCP を使わない） |
| GCP | OAuth 同意画面・クライアント作成・シークレット発行 | 5 | **N 自動化不可**（Google が API を廃止） | 自社ドメインのみ 1 回。顧客向けには不要にする（D1） |
| OAuth 同意 | Playground での同意（誤口座 1 回）、トークンの転記 | 3 | A（ADR-0008 で実施済み）。人は「許可」＋「コードを 1 回貼る」 | — |
| 検証 | 実送信テスト、受信トレイ確認 | 7 | A（大半）＋ H（受信箱の目視は権限を広げないため残す） | 本番からのトークン取得プローブ、記録の機械読取（済）。受信箱は AI に権限を渡さない方針（設計書 §8） |
| 報告 | スクリーンショットの共有と読解 | 約 60 枚 | A | 状態は API と記録で読む。画面共有が要る作業自体を無くす |
| レジストラ | 登録者メールの変更（未）、DNS 切替 | 1 | N（Squarespace に API なし） | D5: レジストラの選定 |

分類の定義: **A** = API があり workflow で無人化できる ／ **S** = 1 回の準備だけ人が行い、以後は A ／ **H** = 本人操作・承認・支払い・契約（残す） ／ **N** = 事業者に API が無く自動化できない（設計で回避するか、頻度を最小化する）。

## 2. 目標状態（人が行うこと）

| 場面 | 人が行うこと | 機械が行うこと |
|---|---|---|
| 新規サイト（自社・顧客） | 顧客情報とサイト要件を 1 つの宣言（`sites/<domain>.json`）に書く（AI が起草、人が承認）／ネームサーバの変更（顧客のレジストラ）／支払い・契約／公開の承認 | repo の生成（型から）、Pages、ルールセット、Secrets、Cloudflare ゾーン・DNS・Worker・Turnstile、送信ドメインの検証（DNS を API で）、監視の登録、記録 |
| 修正 | PR の承認・マージ | 起票（AI）、関門（単体・フルスタック e2e・サイト全検証・文書検査）、配備、配備後検証 |
| 運用 | 異常通知への判断 | 日次集計、合成監視、失効の事前検知、記録の保全 |
| 鍵の更新 | OAuth: 「許可」＋コードを 1 回貼る（自社のみ）。他: なし | Turnstile・送信事業者・Cloudflare トークンは API で回転し、Secret に直接反映 |
| 事故 | 事故記録の承認 | 記録の起票、再発防止の PR |

## 3. 構成（Control-Plane と Data-Plane の分離）

```
REYZ-Inc/site-factory（control-plane、private）
  sites/<domain>.json         … サイトごとの宣言（顧客名、ドメイン、言語、送信経路、監視先、担当）
  .github/workflows/
    site-bootstrap.yml        … 宣言 → GitHub repo（型から生成）+ Pages + ルールセット + Secrets/Variables
                                → Cloudflare ゾーン・DNS・Worker ルート・Turnstile（秘密は直接 Secret へ）
                                → 送信ドメインの検証（DKIM/SPF/DMARC を DNS へ）→ 監視登録 → 記録
    fleet-watch.yml           … 全サイトの contact-watch を集約し、異常だけ noc@ へ
    rotate-*.yml              … Turnstile / 送信事業者 API キー / Cloudflare トークンの定期回転（無人）
  packages/contact-worker     … 型の Worker（adapter: gmail-oauth ｜ provider-api）
REYZ-Inc/site-template（型の repo。いまの reyz-site を分離して作る）
  build/ site/ qa/ workers/ .github/ docs/   … 生成物・関門・文書の骨格。差し替えは宣言と assets だけ
REYZ-Inc/<customer>-site（data-plane、顧客ごとに 1 repo。型から生成。顧客へ引き渡し可能）
```

主体（権限）: GitHub App「REYZ Ops」を組織にインストール（既存。権限は最小: Secrets / Actions / Issues / Contents（型からの生成に必要な範囲））。Cloudflare はアカウント単位のトークン（ゾーン作成・DNS・Workers・Turnstile）。Google Workspace は専用の管理ユーザー（限定管理者ロール）の OAuth 同意（ADR-0008 の型）。

送信経路（adapter）: 自社ドメインは `gmail-oauth`（no-reply@ 本人。ADR-0007）。顧客サイトは **`provider-api`（送信事業者の API。ドメイン検証まで API で完結）を既定** とし、顧客が自社の Google Workspace から送りたい場合だけ `gmail-oauth`（顧客側の管理者に OAuth クライアント作成と同意を依頼する。Google に API が無いため人手が残る）。→ D1

## 4. 段階計画

| 段階 | 内容 | 人の操作（1 回） | 完了判定 |
|---|---|---|---|
| 0（今週） | 強化: アクションの SHA 固定＋Dependabot、PKCE（貼る文字列に同梱）、本番トークンプローブ＋毎日実行、OpenSSF Scorecard 常設、Turnstile の回転を API 化（秘密を人が見ない。作成の API 化は段階 1 の bootstrap）、時刻依存テストの禁止を標準に追加 — **実装済み（2026-09-30）** | PR のマージ、`CLOUDFLARE_TURNSTILE_TOKEN` の作成（1 回） | Scorecard が公開され、Turnstile の回転が無人で通る |
| 1 | 型の分離: `site-template`（この repo から生成物・関門・文書の骨格を切り出し、内容は `site.json` と assets に）と `site-factory`（宣言＋bootstrap workflow）。REYZ の 2 つ目のドメインで bootstrap を実証 | App の組織インストール、Cloudflare アカウントトークン 1 回、宣言の承認 | 宣言 1 つから公開まで人の操作が「承認とネームサーバ」だけになる |
| 2 | 顧客向け: 送信事業者 adapter（DNS 検証まで API）、顧客要件の入力様式（JSON Schema）→ AI がコンテンツ起草 → PR → 承認 | 事業者の契約 1 回、顧客ごとの承認 | 顧客サイト 1 件を型どおりに公開 |
| 3 | 全サイトの監視集約、証跡の日次保管、AI 専用のコミット名義、Scorecard の全 repo 展開 | — | 標準表の GAP が 0 |

## 5. 事実・推論・仮説

- FACT: Cloudflare Turnstile の作成・回転・削除は API で行え、作成と回転の応答に秘密キーが含まれる（開発者ドキュメント）。GitHub の repo 生成（template）・Pages・ルールセット・Secrets・Variables・Environments は REST API で行える。Google の OAuth クライアント作成は API で行えない（IAP OAuth Admin API は 2025-01-22 廃止）
- INFERENCE: 上記から、自社ドメインで残る「人の操作」は OAuth クライアント関連（初回と漏えい時）・2SV 登録・許可・承認・契約に限定できる。顧客向けに Gmail 経路を既定にすると顧客テナントの手作業が毎回残るため、既定は送信事業者 API とするのが整合する
- HYPOTHESIS（§6 で確認してから設計に入れる）: Cloudflare API トークンの自己ローテーション、Cloudflare Registrar API による登録・移管、送信事業者の API 網羅性、Admin SDK の限定管理者ロール＋OAuth の実現性

## 6. 未確認事項（設計に入れる前の確認タスク）

| # | 確認事項 | 方法 | 結果の使い道 | 状態（2026-10-01） |
|---|---|---|---|---|
| U1 | Cloudflare API トークンの自己ローテーション（「トークンを作るトークン」の権限モデル、有効期限の付与） | API 文書と実測 | Phase 0/1 の rotate workflow | 未 |
| U2 | Cloudflare Registrar の API（登録・移管が API で可能か） | API 文書 | D5 | **済: 不可。** API は一覧・取得・更新の 3 つだけで、いずれも deprecated 表示。登録・移管の API は無い（公式 API 文書） |
| U3 | 送信事業者の API 網羅性（ドメイン検証 DNS レコードの取得、送信、Webhook、日本への到達性、料金） | 各社文書と試験送信 | D1 の採用 | 文書調査済み（下表）。**試験送信は未**（候補 1: Cloudflare Email Service、候補 2: Resend、候補 3: Amazon SES） |
| U4 | Google Admin SDK を「限定管理者ロール ＋ OAuth 同意」で使えるか（必要 scope、ロール） | 文書と実測 | 自社 Workspace の操作の無人化 | 未 |
| U5 | GitHub App の組織インストールと権限で template からの repo 生成（`POST /repos/{t}/{t}/generate`）が行えるか | 実測 | site-bootstrap | 文書調査済み: インストール トークンで「Resource not accessible by integration」になる報告が複数（GitHub Community）。**代替案を用意**: `POST /orgs/{org}/repos` で空 repo を作り、型の内容を git push（Contents: write で確実に可能）。実測は段階 1 の最初のタスク |
| U6 | 本番合成監視の別 vantage（データセンター IP では Turnstile がトークンを出さない） | 候補の評価 | 段階 3 | 未 |
| U7 | 顧客 repo（private）での GitHub Actions の無料枠（組織 Free: private repo は月 2,000 分。site-verify は 1 回約 8 分）が足りるか。足りなければ Team プラン or 検証の短縮 | 使用量の実測 | 段階 1 の費用 | 未 |

送信事業者の比較（U3 の文書調査、2026-10-01。価格・制限は各社公開情報。FACT だが変動する）:

| 候補 | 料金 | ドメイン検証・DNS | 利点 | 懸念 |
|---|---|---|---|---|
| **Cloudflare Email Service**（Email Sending） | Workers Paid（$5/月）に 3,000 通/月込み、以後 $0.35/1,000 通。検証済み宛先への送信は無料 | ゾーンが Cloudflare にあれば DNS は同一アカウント内（API で完結）。Worker から binding で送信 | **既存の構成（Workers ＋ Cloudflare DNS）と同一基盤**。OAuth・リフレッシュトークン・GCP が不要になる。宛先 50/通、本文 5 MiB | **ベータ**（仕様・制限が変わりうる）。新規アカウントは日次上限が小さく実績で拡大 |
| Resend | Free: 3,000 通/月・100 通/日・1 ドメイン → Pro $20/月〜: 10 ドメイン → Scale $90/月〜: 1,000 ドメイン | ドメインごとに DNS レコード（DKIM/SPF/DMARC）を API で取得し、Cloudflare DNS API で登録 | 開発者向け API が簡潔。複数ドメイン（代理店）向けの Scale 枠 | 2024 年に Scale の価格を予告なく倍増（記録）。顧客数が 10 を超えると Scale が必要 |
| Amazon SES | $0.10/1,000 通（月額なし） | Easy DKIM の CNAME を API で取得 → Cloudflare DNS へ | 大量送信で最安。実績豊富 | AWS アカウント・IAM の運用が増える。サンドボックス解除に**人の審査**（200 通/日制限） |
| 顧客の Google Workspace（Gmail API） | 顧客の席料に含まれる | 不要（顧客ドメインの DKIM は Workspace 側） | 顧客の既存ドメイン評価をそのまま使える | **顧客の管理者にユーザー作成・2SV・同意の手作業が毎回残る**（本設計書 §1 の棚卸しの再発）。上限 2,000 通/日/ユーザー |

## 7. DECISION（CEO が決める）— Full Cycle 検証済み（2026-10-01、IV）

各決定は「ベストプラクティス（出典）→ FACT / INFERENCE / HYPOTHESIS → 反証（推奨を壊す観点）→ 推奨」の順。「世界最先端」の断定はせず、公開されている標準・公式文書・実測に接地する。

### D1 顧客サイトの送信経路
- ベストプラクティス: サイトからの取引メール（確認・控え）は、**顧客ドメインで SPF・DKIM・DMARC を揃えた送信事業者 API** から出す。Google・Yahoo の送信者ガイドライン（2024〜）は SPF/DKIM の認証と、1 日 5,000 通超の送信者に DMARC を要求（Gmail ヘルプ「Email sender guidelines」）。認証に要る DNS は、顧客ゾーンが Cloudflare にあれば API で全部置ける。
- FACT: 上の比較表。Cloudflare Email Service は Workers から binding で送れる（ベータ）。Resend は Free 1 ドメイン、Pro 10、Scale 1,000。SES はサンドボックス解除に人の審査。
- INFERENCE: 顧客ごとの手作業を 0 にできるのは「事業者 API ＋ Cloudflare DNS」の組み合わせだけ。Google Workspace 経路は顧客側の人手が構造的に残る（自社で 2 日かかった作業の再発）。
- HYPOTHESIS（U3 で検証）: Cloudflare Email Service を既定にすると、自社サイトの OAuth 機構（ADR-0007/0008）も不要にできる。ベータの制限（日次上限・到達性）は試験送信で確かめる。
- 反証: 事業者への依存（価格改定・停止）。対策は adapter 境界（Worker の送信部を差し替え可能に保つ。現状 `gmailSend` が 1 か所）と、第 2 候補（Resend）を同じ adapter で動くようにしておくこと。
- **推奨: 送信事業者 API を既定（案 A）。** 事業者の採用は U3（試験送信）の結果で確定し、ADR で記録。第一候補 Cloudflare Email Service、第二 Resend、第三 SES。

### D2 顧客サイトの repo 構成
- ベストプラクティス: 顧客ごとに所有・引き渡し・権限を分ける対象は **repo を分ける**（GitHub の権限はリポジトリ単位。monorepo では顧客間の権限分離が CODEOWNERS 程度しかできない）。共通部分は template repo と reusable workflow（`workflow_call`）で共有する。
- FACT: template からの生成 API は存在するが、App トークンでの失敗報告がある（U5）。空 repo 作成 ＋ push は確実。GitHub Pages は **private repo では有料プラン（Pro/Team 以上）が必要**で、かつ「オンラインビジネスの運営や EC、SaaS を主目的とするサイトのための無料ホスティングとしての利用は不可」（GitHub Pages limits）。
- INFERENCE: 顧客サイトを GitHub Pages で量産するのは、プラン条件と利用規約の両面で適さない。**ホスティング先は Cloudflare Workers（static assets）が整合する**（静的アセットへのリクエストは全プランで無料・無制限（Cloudflare 公式）。DNS・Worker・送信と同一アカウント。Cloudflare 自身が新規は Pages ではなく Workers を推奨）。→ 新しい決定 **D8** を追加。
- 反証: repo が増えると Actions の無料枠（U7）と Dependabot PR の件数（D6）が線形に増える。対策は reusable workflow による関門の共通化と、検証時間の短縮（site-verify 約 8 分の内訳見直し）。
- **推奨: 1 顧客 1 repo（案 A）。** ただし公開先は D8 で決める。

### D3 control-plane repo
- ベストプラクティス: 宣言（どの顧客・どのドメイン・どの事業者）と運用記録は、顧客名を含むため **private の専用 repo**。秘密は repo に置かず、各顧客 repo の Secrets か Secret Manager へ。
- FACT: 組織の private repo は Free プランでも作れる（Actions 分数だけ有料枠の影響。U7）。
- 反証: 専用 repo を作ると「2 か所を見る」運用になる。対策は docs/README.md と同じ「読む順番」をそこにも置き、site-factory → 各顧客 repo の導線を 1 本にする。
- **推奨: `REYZ-Inc/site-factory`（private）（案 A）。**

### D4 送信専用ユーザーの 2 段階認証
- ベストプラクティス: 組織全体で 2SV を強制し、例外 OU を作らない（Google の推奨。例外はフィッシング耐性を下げる）。システム用ユーザーは認証システム アプリかパスキーで登録し、バックアップコードはパスワード管理（1Password）に保管。
- FACT: 今回の初回実施で、登録期間 1 週間 → 登録 → 期間なし、で運用できた（事故記録 2026-09-30）。
- 反証: 「登録期間」を一時的に開けるのが毎回の手作業になる。対策は手順の先頭に固定（済）。また D1 で事業者 API に移れば、同意そのものが不要になり D4 の頻度は 0 に近づく。
- **推奨: 本人操作で登録、例外 OU は作らない（案 A）。**

### D5 レジストラ
- ベストプラクティス: DNS と同じ事業者にまとめると運用面（1 画面、DNSSEC のワンクリック、原価販売）が単純になる。ただし**登録・移管は Cloudflare でも API では行えない**（U2: 済）。
- FACT: Cloudflare Registrar の API は一覧・取得・更新のみで deprecated 表示。Squarespace Domains に API は無い。移管には 60 日ロック等の一般規則がある。
- INFERENCE: 移管しても「無人化」は進まない（登録・更新の支払いと契約は、本設計書 §2 で人に残すと決めた操作そのもの）。得られるのは一元管理と価格。
- 反証: 移管作業自体が 1 回の手作業と移管中の DNS リスクを生む。急ぐ理由はない。
- **推奨: 方針は Cloudflare Registrar へ移管（案 B）だが、優先度は低。2027-07 の更新前に実施。** 顧客ドメインは顧客名義のまま（REYZ は預からない）。

### D6 Dependabot の更新 PR のマージ
- ベストプラクティス: GitHub 公式の手順では、関門が通った patch/minor を自動マージし、major は人が見る（`dependabot/fetch-metadata` → `gh pr merge --auto`）。前提は「自動マージの先に本番配備の人の承認があるか、関門が本番相当であること」。
- FACT: 本 repo は main へのマージ＝本番配備。関門は CI 内で本物の Turnstile と Google トークンまで通す（本番相当に近い）。今回の初回サイクルでは、依存更新 2 本のうち 1 本（npm）が関門で止まり、修正 PR が必要だった（＝自動マージなら自動的に止まるだけで害はない）。
- 反証（人がマージ案への反証）: repo が増えると人のクリックが線形に増える。反証（自動マージ案への反証）: 「本番配備は人の承認を通す」（CEO 規律）に反する。
- **推奨: 当面は人がマージ（案 A）。段階 1 で repo が増えた時点で、Dependabot のグループを patch/minor と major に分け、patch/minor だけ自動マージへ（ADR で記録）。**

### D8（新規）顧客サイトの公開先（ホスティング）
- 案 A: **Cloudflare Workers（static assets）**。静的アセット無料・無制限、カスタムドメインは同一アカウントの DNS、配備は `wrangler deploy`（既に Worker 配備で使用中のトークン種別）。private repo でも制約なし。Cloudflare が新規プロジェクトに推奨。
- 案 B: GitHub Pages 継続。private repo は Team プラン必須、利用規約の商用制限、1 GB・100 GB/月の制限。REYZ 自身の reyz.inc は当面このまま（公開 repo・会社案内のため規約内）。
- 反証（案 A）: Cloudflare 障害時に DNS・CDN・配備・送信が同時に影響を受ける（単一事業者）。対策は静的サイトであること（復旧が容易）と、Pages/他 CDN への退避手順を段階 3 で用意。
- **推奨: 顧客サイトは案 A。reyz.inc は段階 1 で同じ型に合わせて移行（Pages → Workers）するか据え置くかを、型の完成時に判断。**

### 決定一覧

| # | 論点 | 推奨 | 根拠の種類 | 決定後に起きること |
|---|---|---|---|---|
| D1 | 顧客サイトの送信経路 | 送信事業者 API を既定（事業者は U3 で確定） | FACT（比較表）＋ INFERENCE | 段階 2 の adapter 設計 |
| D2 | 顧客サイトの repo 構成 | 1 顧客 1 repo（型から生成） | FACT（GitHub 権限単位）| site-bootstrap |
| D3 | control-plane repo | `REYZ-Inc/site-factory`（private） | 慣行 | repo 新設 |
| D4 | 2SV | 本人登録、例外 OU なし | Google 推奨 | 手順は現状維持 |
| D5 | レジストラ | Cloudflare へ移管（低優先。2027-07 前） | FACT（API なし） | 1 回の移管作業 |
| D6 | Dependabot マージ | 当面は人。段階 1 で patch/minor を自動化 | GitHub 公式手順 ＋ CEO 規律 | 運用カレンダー |
| D7 | Copilot | 見送り（決定済み 2026-09-30） | — | — |
| D8 | 顧客サイトの公開先 | Cloudflare Workers（static assets） | FACT（Pages のプラン条件・規約、Workers の無料静的配信） | 型の配備先 |

## 8. 意図的に含めないもの
- 受信箱の自動読取（AI にメール読み取り権限を渡さない）
- 2SV の免除や、鍵を人が転記する手順の温存
- 顧客テナント（Google/Microsoft）の管理操作を REYZ が代行する設計（顧客の管理権限を預からない）

## 9. 変更履歴
- 2026-09-30 v1: 初版。reyz.inc 制作の手動作業を棚卸し（GitHub 43 回、Cloudflare 4 回、Google 25 回、検証 7 回、画面共有約 60 枚）。目標状態・構成・段階計画・未確認・DECISION を定義。
- 2026-10-01 v1.2: D1〜D6 を Full Cycle で検証（ベストプラクティス・FACT・反証・推奨）。U2 済（Registrar API なし）、U3 文書調査（事業者比較表）、U5 に代替案、U7（Actions 無料枠）追加。D8（顧客サイトの公開先: GitHub Pages のプラン条件・規約により Cloudflare Workers static assets を推奨）を追加。
- 2026-09-30 v1.1: D6（Dependabot の PR のマージ方式。未決）・D7（Copilot 見送り。決定）を追加。段階 0 の初回の依存更新（PR #23・#24）で判明した、PR 検証と main 配備の同時実行の列の分離を `verify-and-deploy` に反映。
