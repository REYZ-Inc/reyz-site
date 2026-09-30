# 0009 サイトの制作・運用は宣言と workflow で行い、人の操作は承認・本人確認・支払い・契約に限定する

- 状態: 提案（2026-09-30 CEO 指示「手動操作を限界まで無くし、顧客サイトの制作からその他発生しうる作業を限界まで自動化する」。設計書 `docs/site-factory.md` v1 と同時に起案。DECISION D1〜D5 の決定で採用）
- 決定者: ロウ（CEO）／起案: IV

## 文脈
- reyz.inc の制作（2026-09-28〜30）で、問い合わせメールの設定だけで人の操作が約 80 回、画面共有が約 60 枚発生した（`docs/site-factory.md` §1）。うち事故 3 件（Turnstile の秘密露出、OAuth の誤口座、時限式テスト）はいずれも「人が値を扱う」「人が状態を判断する」工程で起きた
- REYZ は同じ型で顧客のホームページを制作・運用する。人の操作が残るほど、件数に比例して事故と工数が増える
- 事業者の API で行えることは事実として確認済み（Cloudflare: Turnstile・DNS・Workers・ゾーン、GitHub: repo 生成・Pages・ルールセット・Secrets、Google Workspace: ユーザー・エイリアス）。行えないことも確認済み（Google の OAuth クライアント作成、Squarespace のレジストラ操作）

## 選択肢
1. **宣言（`sites/<domain>.json`）→ control-plane の workflow が全構成要素を生成・設定・検証・監視・記録する。人は承認・本人確認・支払い・契約だけ。事業者に API が無い工程は、設計で回避する（顧客サイトの送信は事業者 API）か、頻度を初回と漏えい時に限定する**
2. 手順書を整備して人が正確に行う（今回の方式の延長。件数に比例して事故と工数が増える）
3. 外部の制作・運用 SaaS に載せる（REYZ の型・関門・記録が SaaS の制約に従属し、差し替え可能性を失う）

## 決定
1。人が行う操作を次の 4 種に限定する: **承認**（PR のマージ、宣言の承認、公開の承認）、**本人確認**（OAuth の許可、2 段階認証の登録）、**支払い・契約**、**事業者に API が無い 1 回の準備**（OAuth クライアント、GitHub App、初回の API トークン）。それ以外の操作が手順に現れたら、設計の欠陥として扱い、是正計画を持つ。

## 帰結
- control-plane（`site-factory`）と data-plane（サイト repo）を分離し、秘密は control-plane の Environments と各 repo の Secrets に、値を人が扱わずに API から直接入れる
- 型は `site-template` として repo 化し、内容（文言・assets・宣言）と骨格（生成・関門・Worker・文書）を分ける。顧客サイトは 1 顧客 1 repo（D2）
- 送信経路は adapter: 自社ドメインは `gmail-oauth`（ADR-0007/0008）、顧客サイトは `provider-api` を既定（D1）。顧客テナントの管理操作を REYZ が代行する設計は採らない
- 鍵の回転は無人化する（Turnstile: API、送信事業者: API、Cloudflare トークン: 自己ローテーション（U1 で確認）、OAuth: 「許可」＋コード 1 回）
- 検証は機械が読める形にする（API・記録・Summary）。画面共有が必要な工程は設計の欠陥として扱う
- 基準の可視化: OpenSSF Scorecard を全 repo で常設し、第三者尺度の数値で状態を示す
- 段階 0〜3（設計書 §4）。各段階の完了判定は「人の操作の数」で行う

## 参照
- `docs/site-factory.md` v1、`docs/STANDARDS.md`「人の操作の最小化」
- Cloudflare API: Turnstile Widgets（create / rotate_secret）、DNS、Workers、Zones。GitHub REST API: Repositories（generate from template）、Pages、Rulesets、Actions Secrets/Variables。Google Admin SDK Directory API。Google: Migrate from the IAP OAuth Admin API（2025-01-22 廃止）
- 事故記録: `docs/incidents/2026-09-29-turnstile-secret-exposure.md`、`2026-09-30-oauth-consent-wrong-account.md`
