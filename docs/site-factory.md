# サイト工場（型の量産と運用の自動化）設計書 v1

対象: REYZ 自身のサイト（reyz.inc）の修正・運用と、REYZ が顧客のホームページを制作・運用する場合の、制作から運用・更新・失効対応までの全作業。
目的: **人が行う操作を「承認・本人確認・支払い・契約」だけにする。** それ以外（作成・設定・検証・配備・監視・記録・鍵の更新）は宣言と workflow が行う。
更新日: 2026-09-30 v1（棚卸しと目標状態、段階計画、DECISION）。決定: [ADR-0009](adr/0009-site-factory-declarative-provisioning.md)。

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
| 0（今週） | 強化: アクションの SHA 固定＋Dependabot、PKCE（貼る文字列に同梱）、本番トークンプローブ＋毎日実行、OpenSSF Scorecard 常設、Turnstile の作成・回転を API 化（秘密を人が見ない）、時刻依存テストの禁止を標準に追加 | PR のマージ | Scorecard が公開され、Turnstile の回転が無人で通る |
| 1 | 型の分離: `site-template`（この repo から生成物・関門・文書の骨格を切り出し、内容は `site.json` と assets に）と `site-factory`（宣言＋bootstrap workflow）。REYZ の 2 つ目のドメインで bootstrap を実証 | App の組織インストール、Cloudflare アカウントトークン 1 回、宣言の承認 | 宣言 1 つから公開まで人の操作が「承認とネームサーバ」だけになる |
| 2 | 顧客向け: 送信事業者 adapter（DNS 検証まで API）、顧客要件の入力様式（JSON Schema）→ AI がコンテンツ起草 → PR → 承認 | 事業者の契約 1 回、顧客ごとの承認 | 顧客サイト 1 件を型どおりに公開 |
| 3 | 全サイトの監視集約、証跡の日次保管、AI 専用のコミット名義、Scorecard の全 repo 展開 | — | 標準表の GAP が 0 |

## 5. 事実・推論・仮説

- FACT: Cloudflare Turnstile の作成・回転・削除は API で行え、作成と回転の応答に秘密キーが含まれる（開発者ドキュメント）。GitHub の repo 生成（template）・Pages・ルールセット・Secrets・Variables・Environments は REST API で行える。Google の OAuth クライアント作成は API で行えない（IAP OAuth Admin API は 2025-01-22 廃止）
- INFERENCE: 上記から、自社ドメインで残る「人の操作」は OAuth クライアント関連（初回と漏えい時）・2SV 登録・許可・承認・契約に限定できる。顧客向けに Gmail 経路を既定にすると顧客テナントの手作業が毎回残るため、既定は送信事業者 API とするのが整合する
- HYPOTHESIS（§6 で確認してから設計に入れる）: Cloudflare API トークンの自己ローテーション、Cloudflare Registrar API による登録・移管、送信事業者の API 網羅性、Admin SDK の限定管理者ロール＋OAuth の実現性

## 6. 未確認事項（設計に入れる前の確認タスク）

| # | 確認事項 | 方法 | 結果の使い道 |
|---|---|---|---|
| U1 | Cloudflare API トークンの自己ローテーション（「トークンを作るトークン」の権限モデル、有効期限の付与） | API 文書と実測 | Phase 0/1 の rotate workflow |
| U2 | Cloudflare Registrar の API（登録・移管が API で可能か） | API 文書 | D5 |
| U3 | 送信事業者（候補: Amazon SES / Resend / Postmark / Cloudflare Email Service）の API 網羅性（ドメイン検証 DNS レコードの取得、送信、Webhook、日本への到達性、料金） | 各社文書と試験送信 | D1 の採用 |
| U4 | Google Admin SDK を「限定管理者ロール ＋ OAuth 同意」で使えるか（必要 scope、ロール） | 文書と実測 | 自社 Workspace の操作の無人化 |
| U5 | GitHub App の組織インストールと Contents 権限で template からの repo 生成が行えるか | 実測 | site-bootstrap |
| U6 | 本番合成監視の別 vantage（データセンター IP では Turnstile がトークンを出さない） | 候補の評価 | 段階 3 |

## 7. DECISION（CEO が決める）

| # | 論点 | 案（推奨を先頭） | 影響 |
|---|---|---|---|
| D1 | 顧客サイトの送信経路 | **送信事業者 API を既定**（人手ゼロ、GCP 不要）／ 顧客の Google Workspace（顧客管理者の手作業が残る） | Phase 2 の中核 |
| D2 | 顧客サイトの repo 構成 | **1 顧客 1 repo（型から生成。引き渡し・権限分離が容易）**／ monorepo | site-factory の設計 |
| D3 | control-plane repo | **`REYZ-Inc/site-factory`（private）** | 宣言と秘密の置き場 |
| D4 | Workspace のシステム用ユーザーの 2SV | **本人操作で登録（手順の先頭に固定）**／ 2SV 免除の OU（安全性低下） | 運用手順 |
| D5 | レジストラ | Squarespace 継続（API なし、手作業残る）／ **Cloudflare Registrar へ移管（U2 の結果次第）** | 2027-07 の更新前に |

## 8. 意図的に含めないもの
- 受信箱の自動読取（AI にメール読み取り権限を渡さない）
- 2SV の免除や、鍵を人が転記する手順の温存
- 顧客テナント（Google/Microsoft）の管理操作を REYZ が代行する設計（顧客の管理権限を預からない）

## 9. 変更履歴
- 2026-09-30 v1: 初版。reyz.inc 制作の手動作業を棚卸し（GitHub 43 回、Cloudflare 4 回、Google 25 回、検証 7 回、画面共有約 60 枚）。目標状態・構成・段階計画・未確認・DECISION を定義。
