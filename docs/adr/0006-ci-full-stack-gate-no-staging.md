# 0006 配備前検証は CI 内フルスタック（公式テストキー）で行い、staging を常設しない

- 状態: 採用（2026-09-29）
- 決定者: ロウ（CEO）／起案: IV

## 文脈
2026-09-29 の障害 2 件（`#turnstile` id 衝突、`turnstile.ready()` の例外）は、本物の Turnstile を読み込んだときにだけ起きるもので、外部を呼ばない単体テストでは見つからず、本番で初めて露見した。

## 選択肢
1. staging Worker を本番ドメインの別ルートに常設し、PR ごとに配備して e2e
2. 本番配備後に e2e（それまでの状態）
3. CI 内でサイト生成物 ＋ Worker を同一 origin で起動し、本物の Turnstile を Cloudflare 公式テストキーで動かし、Google は委任トークン取得まで確認する

## 決定
3。理由: 本番ドメインに試験用の入口を置かない、テストキーは決定的（常に合格／不合格／対話式）、追加インフラ・費用なし、専用環境を常設しない。エッジ固有の挙動は配備後 e2e で補う。

## 帰結
- CI 用設定は本番 `wrangler.toml` から生成（差分 6 点のみ）。手で複製しない
- 初回実測で判明した事実（テストキーの siteverify は `example.com` を返す、「常に不合格」サイトキーは error-callback）を設計書に記録
- Full Cycle を設計に先に適用し、staging 案を取り下げた（比較の記録は `docs/contact-pipeline.md`）

## 参照
- Cloudflare Turnstile Testing、`.github/workflows/contact-worker.yml`、`workers/contact/ci/make_ci_config.py`
