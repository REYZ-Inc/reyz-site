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

## 更新の流れ
1. `build/build.py`（または `site/assets/*`）を編集 → `python3 build/build.py` で `site/` を再生成
2. `npm ci && npx playwright install --with-deps chromium && bash qa/run_all.sh` が ALL PASS であること
3. Pull Request → 検証が通れば main へマージ → 約1分で https://reyz.inc に反映

## 未設定（別途）
- 問い合わせフォームの送信先（`site/assets/site.js` の `CONFIG.formEndpoint` / `contactEmail`）。未設定の間は「文面をコピー」の暫定挙動
- 作品例の動画（`build/build.py` の `WORKS`。YouTube URL を1行追加）
- secret は本リポジトリに置かない（送信先のトークン等はサーバ側の環境変数）
