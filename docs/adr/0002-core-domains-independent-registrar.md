# 0002 中核ドメインは独立レジストラに置き、DNS は宣言（コード）で管理する

- 状態: 採用（2026-09-28）
- 決定者: ロウ（CEO）／起案: IV

## 文脈
reyz.inc は Squarespace で登録（更新 2027-09-14、移管ロック 〜2026-11-13）。Cloudflare Registrar は Cloudflare のネームサーバー使用が条件で、レジストラと DNS 事業者が同一になる。

## 選択肢
1. Cloudflare Registrar へ移管（DNS 事業者と一体化）
2. 独立レジストラに置き、DNS は Cloudflare（宣言はコード）で管理
3. Squarespace の DNS のまま（自動化不可）

## 決定
2。登録（所有）と運用（DNS）を分け、どちらの事業者も差し替え可能にする。移管判断は 2027-07 までに行う。

## 帰結
- DNS の正本は `infra/cloudflare/zones/reyz.inc.json`。変更は PR → plan → apply
- 登録者連絡先は役割アドレス `hostmaster@reyz.inc` に切り替える（保留リスト）

## 参照
- ADR-0003
