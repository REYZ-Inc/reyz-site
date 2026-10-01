# docs — 入口（初めて読む人・AI はここから）

このリポジトリは「REYZ のコーポレートサイト」と、そこから複製する「サイトの型」の正本です。文書は 4 種類に分かれ、それぞれ置き場と役割が固定されています（[STANDARDS.md](STANDARDS.md) §1）。

## 1. 読む順番

| 順 | 文書 | 何が分かるか | 所要 |
|---|---|---|---|
| 1 | この文書 | 全体図・運用カレンダー・用語・迷ったときの行き先 | 5 分 |
| 2 | [STANDARDS.md](STANDARDS.md) | 原則（人の操作は承認・本人確認・支払い・契約だけ）、最先端実務との対応表（PASS / GAP）、判定の手順（Full Cycle）、記録の形式 | 10 分 |
| 3 | [contact-pipeline.md](contact-pipeline.md) | 問い合わせ受付の設計（要件・構成・関門・未検証方針・秘密・運用） | 10 分 |
| 4 | [site-factory.md](site-factory.md) | 型の量産と運用の自動化（手動作業の棚卸し、目標状態、段階計画、未確認、CEO の決定事項） | 10 分 |
| 5 | [adr/](adr/README.md) | なぜそうなっているか（決定記録。番号順） | 必要な番号だけ |
| 6 | [incidents/](incidents/README.md) | 何が起きて、どう直したか（事故記録） | 必要なものだけ |
| 7 | [../workers/contact/README.md](../workers/contact/README.md) | 実装と手順（設定・更新・後片付け・失敗時の再開） | 作業時 |

コードの入口は [../README.md](../README.md)（パスと役割の表）。

## 2. 全体図（2026-09-30 現在）

```
訪問者 ──▶ Cloudflare（DNS・CDN・Turnstile）──▶ GitHub Pages（site/ = 公開物。build/build.py が生成）
              │
              └─ reyz.inc/api/contact ──▶ Cloudflare Worker「reyz-contact」（workers/contact/）
                                              │  Origin 検査 → 入力検証 → レート制限 → Turnstile 照合 → 未検証方針
                                              └─▶ Google（no-reply@reyz.inc 本人の OAuth）──▶ Gmail API: 控え（contact@）＋ 確認メール
                                                   記録: Cloudflare Workers Logs（PII なし）

GitHub Actions（.github/workflows/）
  関門（PR ごと）: worker-tests / stack-e2e（CI 内で本物の Turnstile を公式テストキーで）/ site-verify / docs-gate ── 全部通らないと main に入らない
  配備（main）   : verify-and-deploy（サイト）/ contact-worker（Worker。GitHub Secrets → Worker secret を宣言的同期）
  監視           : contact-e2e（配備後＋毎日）/ contact-watch（毎日）/ contact-logs（手動）/ scorecard（毎週）
  運用（鍵）     : oauth-consent（同意コードを 1 回貼る）/ turnstile-rotate（四半期。無人）/ ops-check（前提の検査。変更なし）
  主体           : GitHub App「REYZ Ops」（Secrets・Actions・Issues の書き込み。この repo のみ）

秘密の正本 = GitHub Secrets。人が値を扱う工程は無い（発行元 API → workflow → Secret → 配備）。
```

## 3. 運用カレンダー（何が・いつ・何をして・失敗したら・どこに残るか）

| workflow | いつ | 何をする | 失敗したら | 記録 |
|---|---|---|---|---|
| `contact-e2e` | Worker／サイトの配備後、毎日 09:07 JST | 本番のフォームを実ブラウザで操作し、Worker が Google のトークンを取れるまで確認（メールは送らない） | noc@ へメール | run の Summary |
| `contact-watch` | 毎日 09:37 JST | 直近 24 時間の受付・エラー・未検証を集計。異常だけ通知 | noc@ へメール（run も失敗にする） | run の Summary、通知メール |
| `contact-logs` | 手動 | 記録の一覧（結果・検証状態・Gmail 受理 ID・認証方式） | — | run の Summary |
| `scorecard` | 毎週月曜 10:23 JST、main 更新時 | OpenSSF Scorecard で採点 | — | Code scanning、README のバッジ |
| `turnstile-rotate` | 1・4・7・10 月 1 日 10:17 JST、手動 | Turnstile 秘密キーを API で回転 → Secret → 配備 | run が失敗（GitHub の通知） | issue「運用記録 — 認証情報」 |
| `ops-check` | 毎週月曜 09:47 JST、手動（1 回設定の完了確認） | 前提（Secret・変数・Cloudflare トークンの権限・OAuth クライアント・リフレッシュトークン・GitHub App・受け取りページ）を何も変更せずに判定 | Summary の「次にやること」に従う（定期実行の FAIL は noc@ へメール） | run の Summary（表）・annotation |
| `oauth-consent` | 手動（同意が要るときだけ） | 同意コードを検証 → Secret → 配備（旧トークンは失効させない: Google の失効はグラント単位で新しい鍵も消えるため） | run が失敗し理由を表示（保存しない） | issue「運用記録 — 認証情報」 |
| `contact-worker` | PR ごと（関門）、main の変更時 | 単体・CI 内フルスタック e2e → 配備 → secret 同期 → 疎通 | main が失敗したら Re-run failed jobs | run の annotation |
| `verify-and-deploy` | PR ごと（関門）、main の変更時 | サイト全検証 → GitHub Pages へ配備 | main が失敗したら Re-run failed jobs。「cancelled」は、より新しい main の run に置き換えられた印（待ちは最新 1 件だけ残る）で、公開中のサイトは前回の配備のまま | run の Summary・artifact |
| `docs-gate` | PR ごと | PR 本文に必須 6 見出しがあるか | PR がマージできない | — |
| `branch-cleanup` | 毎月 1 日 09:57 JST、手動 | main にマージ済みのブランチを削除（開いている PR の head は残す） | — | run の annotation・Summary |
| Dependabot | 毎週月曜 09:00 JST（actions）、毎月（npm） | 依存の更新 PR を開く（まとめて 1 本）。関門はそのまま通す（docs-gate は bot を免除） | 関門が赤なら人はマージしない。原因は AI が調べて修正 PR を出す（例: PR #27） | PR |

予定（人の操作は不要。結果だけ確認）:

| いつ | 何が起きるか | 確認すること |
|---|---|---|
| 2026-10-19 以降 | GitHub の `ubuntu-latest` が Ubuntu 26 へ移行（[runner-images#14748](https://github.com/actions/runner-images/issues/14748)） | 移行後最初の `verify-and-deploy` と `contact-worker` の run が緑か（Java・Playwright・Python を使うため） |

## 4. 人が行うこと（それ以外は機械）

| 種類 | 例 |
|---|---|
| 承認 | PR のマージ、宣言の承認、公開の承認 |
| 本人確認 | OAuth の「許可」、2 段階認証の登録 |
| 支払い・契約 | Workspace の席、ドメイン、事業者 |
| 事業者に API が無い 1 回の準備 | OAuth クライアントの作成、GitHub App の作成、初回の API トークン |

手順に上記以外の人の操作が現れたら、設計の欠陥として扱う（[ADR-0009](adr/0009-site-factory-declarative-provisioning.md)）。

## 5. 用語

| 用語 | 意味 |
|---|---|
| Worker | Cloudflare 上で動く小さなプログラム。ここでは問い合わせの受付係（`reyz-contact`） |
| Turnstile | Cloudflare のボット判定。サイトキー（公開）と秘密キー（Worker だけが持つ） |
| OAuth の同意 | no-reply@ 本人が「このアプリにメール送信を許可する」と押すこと。結果として得る「リフレッシュトークン」が送信の鍵 |
| GitHub Secrets | 鍵の金庫。人は名前だけ見え、値は見えない。Worker へは配備のたびに機械が写す |
| GitHub App「REYZ Ops」 | 運用 workflow が金庫に鍵を入れたり配備を起動したりするための「機械の身分証」 |
| 関門 | PR がマージされる前に必ず通る自動検査 4 件 |
| e2e | 実際のブラウザでフォームを最後まで操作する通し確認 |
| dry_run | 送信せずに途中まで確かめるモード（`verify`＝照合まで、`token`＝Google のトークン取得まで） |
| ADR | 決定記録。番号は増えるだけで、覆すときは新しい番号で「置き換え」 |
| BLOCKING / DECISION / RECORD | 検出事項の分類。BLOCKING は納品を止める、DECISION は CEO が決める、RECORD は記録して進む |
| FACT / INFERENCE / HYPOTHESIS | 事実（確認済み）／推論／仮説（検証タスク付き）。混ぜて書かない |

## 6. 迷ったら

| 知りたいこと | 行き先 |
|---|---|
| フォームが動いているか | Actions → `contact-e2e` の最新 run（緑なら本番で Google のトークンまで取れている） |
| 今日の受付件数・エラー | Actions → `contact-logs` → Run workflow |
| 鍵を更新したい | [workers/contact/README.md](../workers/contact/README.md)「認証情報の更新」 |
| なぜこの設計か | [adr/](adr/README.md) の該当番号 |
| 過去に何が起きたか | [incidents/](incidents/README.md) |
| 変更を入れたい | [../README.md](../README.md)「更新の流れ」→ PR テンプレートの 6 見出しを埋める |
| 顧客サイトを作りたい | [site-factory.md](site-factory.md)（段階 1 以降） |
