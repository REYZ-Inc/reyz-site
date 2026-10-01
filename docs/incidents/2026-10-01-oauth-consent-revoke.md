# 2026-10-01 同意の自動化の初回実行で、古いトークンの失効が新しいトークンまで無効にし、フォームの送信が止まった

- 影響: 17:38〜18:11 JST（33 分）、問い合わせフォームの送信が Google 側で失敗（502 `send` / `stage: token` / `invalid_grant`）。受付の検証（Turnstile）までは通るが、控えと確認メールが出ない状態。**実害: 受付 0 件**（`contact-logs` 直近 4 時間の記録は 17:39:05 の 1 件のみで、これは配備直後の本番 e2e の探り。FACT）
- 検知: 配備直後の本番 e2e（`contact-e2e`、`dry_run='token'`）が失敗（17:38）。IV が `ops-check` C7 で「refresh できない: Token has been expired or revoked」を確認（17:40）
- 重大度: 中（送信停止。外部からの問い合わせが来れば失われる状態だったが、期間中の実受付は 0 件）

## 時系列（JST）
| 時刻 | 事象 |
|---|---|
| 17:30 | ロウが受け取りページから no-reply@reyz.inc で同意（手順どおり） |
| 17:35 | `oauth-consent` run #1 を実行。交換 → 口座検証 PASS（no-reply@reyz.inc、scope gmail.send + email + openid）→ Secret 更新 → `contact-worker` 配備（secret 同期・疎通 405 PASS）|
| 17:38 | workflow の「古いリフレッシュトークンを失効」が成功 → 直後の `contact-e2e` が `google_token` で失敗 |
| 17:40 | `ops-check` C7: 新しいトークンで refresh できない（invalid_grant: Token has been expired or revoked） |
| 17:48 | 原因を特定（下記）。失効の段を外す修正 PR #33 を作成 |
| 17:50 | PR #33 の関門 `stack-e2e` が無効な鍵のため赤 → マージ前に鍵を直す必要があると判明 |
| 18:10 | ロウが再同意し、`oauth-consent` を **修正ブランチの定義で** Run workflow（run #2）: 口座検証 PASS → Secret 更新 → 配備 |
| 18:11 | 配備後の `contact-e2e` 成功（復旧）。`ops-check` C7「同意した口座: no-reply@reyz.inc」 |
| 18:18 | PR #33 の関門を再実行して緑 → 18:19 マージ |

## 根本原因
- Google の失効（`/revoke`）は、トークン 1 本ではなく **「口座 × OAuth クライアント」のグラント（同意そのもの）** を取り消す。同じ口座（no-reply@）に対して、新しい同意の直後に古いトークンを失効させたため、新しいトークンも同じグラントとして無効になった
- 設計（ADR-0008）は「古いトークンだけが失効する」というトークン単位の前提に立っていた。外部 API の副作用の**単位**（トークンかグラントか）を実測せずに設計へ組み込んだ（Fact Check の漏れ）
- 手元テストは fetch を差し替えるため、この副作用を再現できない。初回の実 run だけが検証機会だった

## 是正（PR #33）
- `oauth-consent`: 「古いトークンを退避 → 失効」の 2 段を削除。古いトークンは Secret と Worker secret が上書きされた時点でどこにも残らず、6 か月未使用で自然失効する（Google の仕様）
- `infra/oauth/consent.mjs`: 失効は「別の口座が同意した」ときだけ（その口座のグラントのみ。本人のグラントには影響しない）。scope 不足・ID トークン不明の場合は失効させず、保存もしない
- 文書: ADR-0008 追記、`workers/contact/README.md`、`docs/contact-pipeline.md`、`docs/README.md` から「旧トークン失効」を削除し理由を記載

## 再発防止
- `docs/STANDARDS.md` の Fact Check の観点に「外部 API の副作用の単位（何が一緒に消えるか）を実測で確かめる」を追加
- 初回実行は「稼働中の鍵を壊しうる段」を含む workflow では、配備直後に本番 e2e が走る設計（既存）を維持し、失敗を即検知する。今回はこれで 2 分以内に検知できた

## 教訓
- 「失効」は親切ではなく破壊的操作。相手の仕様が「何を単位に消すか」を確かめるまで自動化に入れない
- 復旧の最短経路は「失効を外して再同意」。失効を残したまま再同意すると同じ事故を繰り返す
- 関門が本番の鍵に依存していると、鍵を壊した修正 PR 自体が関門を通れない。GitHub の「Run workflow で別ブランチの定義を選ぶ」機能で、マージ前に修正版を実行して復旧できた（手順として README に記載）
