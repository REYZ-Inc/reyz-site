# 0001 公開サイトの出口を Cloudflare に置き、GitHub Pages を配信元にする

- 状態: 採用（2026-09-28）
- 決定者: ロウ（CEO）／起案: IV

## 文脈
GitHub Pages を出口にすると、独自ドメインの証明書発行が最大 24 時間かかり、その間 HTTPS が壊れて見える（2026-09-28 に実際に発生）。訪問者に見せる証明書・HTTPS 転送・防御は、数分で反映され、外から実測できる場所に置く必要がある。

## 選択肢
1. GitHub Pages を出口にする（証明書は GitHub 任せ、反映が遅く不透明）
2. Cloudflare を出口（proxied）にし、GitHub Pages を裏の配信元にする
3. Cloudflare だけで配信する（GitHub の PR・CI・記録を失う）

## 決定
2。Cloudflare が DNS・証明書・HTTPS 転送・防御を担い、GitHub は原本・承認・自動検証・記録・配備を担う。Cloudflare→GitHub 間は `ssl=full`。

## 帰結
- HTTPS は切替から数分で有効（実測 2026-09-28 16:08 JST）
- 出口の候補は比較してから推奨する、初日から第三の観測点（GitHub ランナー）で実測する、という手順を標準にした
- GitHub Pages の「Enforce HTTPS」は使わない

## 参照
- `infra/cloudflare/README.md`、`infra/check/site_check.sh`
