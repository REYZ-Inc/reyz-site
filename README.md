# reyz-site

株式会社レイズ（REYZ Inc.）コーポレートサイト — https://reyz.inc

## 構成
| パス | 役割 |
|---|---|
| `build/build.py` | サイト生成（唯一の編集対象。文言・構造はここ） → `site/` を出力 |
| `site/` | 生成済みの公開物（HTML 8ページ・assets・robots/sitemap・404）。GitHub Pages はこのフォルダを配信 |
| `site/assets/site.css` `site.js` | 見た目と動き（粒子・メニュー・フォーム）。手で編集する |
| `qa/` | 検証一式。`bash qa/run_all.sh` で全件実行（HTML 妥当性、W3C Nu、章の形成、最上部スタート、文言、フォーム、行組み、viewer 配色、secret） |
| `tools/artifact.py` | claude.ai Artifact 用の派生物と viewer 再現フィクスチャ |
| `.github/workflows/deploy.yml` | main への push → 検証 → GitHub Pages 配備。PR は検証のみ（`infra/` だけの変更では配備しない） |
| `infra/cloudflare/` | DNS の正本（`zones/reyz.inc.json`）と反映スクリプト。手順は [infra/cloudflare/README.md](infra/cloudflare/README.md) |
| `.github/workflows/cloudflare-dns.yml` | 手動起動：DNS 宣言 → Cloudflare へ plan / apply |
| `docs/STANDARDS.md` | **REYZ エンジニアリング標準（正本）**: 原則、最先端の実務との基準対応表、Full Cycle、記録の形式。すべての変更はこの型に従う |
| `docs/adr/` | 決定記録（ADR、MADR 形式）。なぜそうなっているかの履歴 |
| `docs/incidents/` | 事故記録（blameless ポストモーテム）。再発防止は PR 番号で追跡 |
| `docs/contact-pipeline.md` | 問い合わせ受付の標準型 v2（設計書・正本）。要件・関門・未検証方針・秘密・役割アドレス・運用 |
| `.github/PULL_REQUEST_TEMPLATE.md` / `docs-gate.yml` | PR の必須見出し（目的・参照基準・一致と差分・検証・未確認・影響）と、その機械検査 |
| `workers/contact/` | 問い合わせフォームの受付 Worker（`reyz.inc/api/contact`。Turnstile → Gmail API で控え＋確認メール）。実装と手順は [workers/contact/README.md](workers/contact/README.md) |
| `.github/workflows/contact-worker.yml` | PR: 単体テスト ＋ CI 内フルスタック e2e（本物の Turnstile を公式テストキーで）。main: Cloudflare Workers へ配備 |
| `.github/workflows/contact-e2e.yml` / `contact-watch.yml` / `contact-logs.yml` | 本番の通し確認（配備後に自動）／毎日の集計と異常通知（noc@）／記録の一覧（手動） |
| `site/oauth/callback.html` / `infra/oauth/` / `.github/workflows/oauth-consent.yml` | 送信専用ユーザーの OAuth 同意の自動化（受け取りページ → 同意コードを 1 回貼る → 口座検証・Secret 更新・配備・失効・記録を workflow が行う。ADR-0008） |

## 更新の流れ
1. 設計・判断が要る変更は、先に `docs/`（設計書・ADR）を書く（[docs/STANDARDS.md](docs/STANDARDS.md)）
2. `build/build.py`（または `site/assets/*`）を編集 → `python3 build/build.py` で `site/` を再生成
3. `npm ci && npx playwright install --with-deps chromium && bash qa/run_all.sh` が ALL PASS であること
4. Pull Request（テンプレートの見出しを埋める）→ 必須チェック（`site-verify` / `worker-tests` / `stack-e2e` / `docs-gate`）が通れば main へマージ → 数分で https://reyz.inc に反映

## 未設定（別途）
- 問い合わせフォームは `/api/contact`（Worker）へ送信済み。設定は `site/assets/site.js` の `CONFIG`（`formEndpoint` / `turnstileSiteKey` / `contactEmail`）。仕組みと運用は [workers/contact/README.md](workers/contact/README.md)
- 作品例の動画（`build/build.py` の `WORKS`。YouTube URL を1行追加）
- secret は本リポジトリに置かない（鍵・トークンは GitHub Secrets → workflow → Worker の secret）
