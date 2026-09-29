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
| `workers/contact/` | 問い合わせフォームの受付 Worker（`reyz.inc/api/contact`。Turnstile → Gmail API で控え＋確認メール）。手順は [workers/contact/README.md](workers/contact/README.md) |
| `.github/workflows/contact-worker.yml` | PR は Worker のテスト + dry-run。main へのマージで Cloudflare Workers へ配備（environment `cloudflare`） |
| `qa/e2e_contact.js` / `.github/workflows/contact-e2e.yml` | 公開サイトの問い合わせフォームを拡張機能なしの Chromium で通し確認（メールは送らない dry_run）。配備後に自動実行、手動起動も可 |
| `infra/check/contact_logs.py` / `.github/workflows/contact-logs.yml` | 手動起動：問い合わせ Worker の記録（結果・Gmail 受理 ID）を一覧表示（読み取りのみ） |

## 更新の流れ
1. `build/build.py`（または `site/assets/*`）を編集 → `python3 build/build.py` で `site/` を再生成
2. `npm ci && npx playwright install --with-deps chromium && bash qa/run_all.sh` が ALL PASS であること
3. Pull Request → 検証が通れば main へマージ → 約1分で https://reyz.inc に反映

## 未設定（別途）
- 問い合わせフォームは `/api/contact`（Worker）へ送信済み。設定は `site/assets/site.js` の `CONFIG`（`formEndpoint` / `turnstileSiteKey` / `contactEmail`）。仕組みと運用は [workers/contact/README.md](workers/contact/README.md)
- 作品例の動画（`build/build.py` の `WORKS`。YouTube URL を1行追加）
- secret は本リポジトリに置かない（鍵・トークンは GitHub Secrets → workflow → Worker の secret）
