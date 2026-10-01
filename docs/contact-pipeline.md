# 問い合わせ受付の標準型 v2（設計書・正本）

対象: reyz.inc の問い合わせフォーム（受付・ボット対策・メール送信・検証・運用）。今後の顧客サイトにそのまま複製する「型」。
更新日: 2026-09-30（v2.4: 前提の検査 ops-check を追加。v2.3: 段階 0 の強化 — PKCE、本番トークンプローブの毎日実行、Turnstile 回転の無人化、アクションの SHA 固定、Scorecard）。変更はこの文書を PR で更新してから実装する。

## 1. 目的と要件

| # | 要件 | 判定方法 |
|---|---|---|
| R1 | 送信者の環境（拡張機能・企業ネットワーク・端末）に依存せず、内容が REYZ に届く | 未検証経路（fail-open）の e2e が通る |
| R2 | ボットの大量送信を抑える | Turnstile 照合 ＋ レート制限 ＋ honeypot ＋ ヒューリスティック。単体テストと e2e |
| R3 | 未確認の宛先へ自動返信しない（なりすまし・バックスキャッター防止） | 未検証時は確認メールを送らない（単体テスト） |
| R4 | 変更を本番に出す前に、本物の部品で通しの動作を確認する | PR 関門 `stack-e2e`（本物 Turnstile＝公式テストキー、Google のアクセストークン取得） |
| R5 | 状態が人手なしで分かる | 記録は PII なしの構造化ログ。`contact-logs` / `contact-watch` / `contact-e2e` を AI が API で読む |
| R6 | 秘密はリポジトリ・チャット・ログに出さない | GitHub Secrets → Worker secret（配備のたびに宣言的に同期。管理対象外は削除）。CI では一時ファイルに展開し必ず削除 |
| R7 | 追加インフラ・費用なし、専用環境を常設しない | Workers / Actions の無料枠。CI 内で起動して終わったら破棄 |
| R8 | 人が行うのは本人確認と承認だけ。値の転記・確認は機械が行う | 秘密の転記が手順に無い。同意した口座は workflow が検証し、違えば保存しない（`infra/oauth` のテスト） |

## 2. 構成

```
訪問者のブラウザ ── contact.html（GitHub Pages を Cloudflare が配信）
   │  Turnstile（読めたら使う。appearance=interaction-only）
   ▼ POST /api/contact（同一 origin。JSON: 入力値 ＋ honeypot ＋ Turnstile トークン ＋ client.turnstile=フォーム側の状態）
Cloudflare Worker reyz-contact
   Origin 検査 → 入力検証 → レート制限（同一 IP 60 秒 5 回）→ Turnstile 照合 → honeypot 判定 → 未検証方針
   → Google アクセストークン（送信専用ユーザー no-reply@ 本人の OAuth、scope gmail.send）
   → Gmail API: ① contact@ へ控え ② 検証済みの送信者へ確認メール（差出人 no-reply@reyz.inc ＝ 送信専用ユーザー本人）
   → 構造化ログ（結果・検証状態・Gmail 受理 ID・種別・国・Ray。本文・氏名・メールアドレスは記録しない）
```

同意の更新（運用）: `reyz.inc/oauth/callback.html`（静的・秘密なし。PKCE S256）→ Google の同意 → 表示された `コード~verifier` を Actions `oauth-consent` に貼る → workflow が交換・口座検証・Secret 更新・配備・失効・記録（ADR-0008）。

送信者に見える挙動: 「送信しました。」。未検証で受け付けた場合は「確認メールの自動送信は行われませんでしたが、内容は届いています。」を追記。送れなかった場合は文面コピー ＋「メールアプリで送る」（contact@reyz.inc）を必ず表示。

## 3. 環境と関門

| 段階 | 起動するもの | 自動で通す関門 | 人 |
|---|---|---|---|
| PR | CI 内: サイト生成物のコピー ＋ Worker（本番と同じコード。設定は `wrangler.toml` から生成、差分 5 点のみ）を同一 origin で起動。本物の Turnstile を**公式テストキー**で。Google は no-reply@ の OAuth でアクセストークン取得まで。メールは送らない | `worker-tests`（単体 11 件 ＋ dry-run）、`stack-e2e`（4 ケース: pass / fail-widget / interactive / fail-secret。初回実測 2026-09-29: pass=検証済み＋Google トークン取得、fail-widget=error-callback → fail-open、interactive=送信が待つ、fail-secret=照合不合格を未検証受付として記録）、`site-verify`（サイト全検証） | マージ承認 |
| 本番 | main へのマージで配備（Worker: `contact-worker` deploy → secret 同期 → 疎通、サイト: `verify-and-deploy`） | 配備後の疎通（405）→ `contact-e2e`（本物キー。Turnstile トークンの有無は情報、エラーと **Google トークン取得の失敗** は失敗）| なし |
| 運用 | `contact-e2e`（毎日 09:07 JST、本番から Google トークン取得＝同意の生存を事前検知）、`contact-watch`（毎日 09:37 JST）、`contact-logs`（手動）、`turnstile-rotate`（四半期）、`scorecard`（毎週）、`ops-check`（毎週。前提＝Secret・トークン・OAuth クライアント・GitHub App の有効性を、何も変更せず判定） | 異常（e2e 失敗・エラー応答・未検証の急増）だけ `noc@reyz.inc` へメール。平常時は無通知 | 通知を受けて判断 |

Turnstile テストキーの事実（Cloudflare 公式）: 常に合格 `1x00000000000000000000AA`、常に不合格 `2x00000000000000000000AB`、必ず対話式 `3x00000000000000000000FF`（サイトキー）、常に合格 / 常に不合格（秘密キー）。localhost を含むどのドメインでも使え、本番の秘密キーはテスト用トークンを拒否する（混在事故が起きない）。

CI 用設定の差分（`workers/contact/ci/make_ci_config.py` が生成。手で複製しない）: name / routes 削除 / assets（`html_handling=none`） / ALLOWED_ORIGINS / TURNSTILE_HOSTNAMES（テストキーの siteverify は `example.com` を返す＝初回 CI で実測） / レート制限上限 100。

## 4. 未検証（fail-open）方針

| 状態 | 受付 | 控え | 確認メール |
|---|---|---|---|
| Turnstile 検証済み | する | 通常 | 送る |
| 未検証（読めない・失敗・不合格）かつ内容が通常 | する（`UNVERIFIED_POLICY=accept-flagged`） | 件名 `[未検証]`、本文にフォーム側の状態と照合コード | 送らない |
| 未検証かつ疑わしい（リンク 3 本以上、名前に URL） | 拒否 403 `suspicious` | — | — |
| honeypot に値 ＋ 検証済み | する（自動入力とみなす） | 注記付き | 送る |
| honeypot に値 ＋ 未検証 | 成功を装って捨てる | — | — |
| `UNVERIFIED_POLICY=reject` | 未検証は 403 `turnstile` | — | — |

## 5. 秘密と権限

| 秘密 | 置き場 | 権限 | 寿命 |
|---|---|---|---|
| OAuth クライアント `GMAIL_OAUTH_CLIENT_ID` / `GMAIL_OAUTH_CLIENT_SECRET` | GitHub Secrets → Worker secret / CI の一時ファイル | 内部アプリ（reyz.inc のユーザーのみ同意可） | 漏えい時に「シークレットを追加」で再発行し古いものを削除（クライアント作成は Google の API では不可＝コンソールのみ） |
| リフレッシュトークン `GMAIL_OAUTH_REFRESH_TOKEN`（no-reply@ 本人の同意） | 同上。**人は貼らない**: `oauth-consent` workflow が交換・口座検証・登録・旧トークンの失効まで行う | scope `gmail.send` のみ（ID トークン用に `openid email` を併せて許可）。影響範囲は no-reply@ の送信だけ | 失効条件: 取り消し／no-reply のパスワード変更／6 か月未使用。失効は送信失敗として `contact-watch` と `stack-e2e` が検知。取り直しは受け取りページ → workflow（ADR-0008） |
| GitHub App「REYZ Ops」の秘密鍵 `OPS_APP_PRIVATE_KEY`（ID は変数 `OPS_APP_ID`） | GitHub Secrets | この repo のみ。Secrets 書き込み・Actions 書き込み・Issues 書き込み | 漏えい時は App の鍵を再生成して差し替え |
| Turnstile 秘密キー | 同上。回転は `turnstile-rotate` が API で行い人は値を見ない | — | 四半期ごとに自動回転。漏えい時は Run workflow（2026-09-29 の露出事故はこの無人化で再発防止） |
| Cloudflare トークン `CLOUDFLARE_WORKERS_TOKEN` | GitHub Secrets | Workers スクリプト編集・ルート編集（reyz.inc 限定）・可観測性 | 必要時に再発行 |

AI は秘密の値を持たない。読むのは配備結果・記録・e2e の結果のみ。受信箱の中身は読まない（DECISION: 権限設計を別途判断）。

秘密の正本は GitHub Secrets。Worker secret は配備のたびに `wrangler secret list` → `secret bulk`（JSON merge-patch）で同期し、管理対象 4 件は値があれば設定・空なら削除、管理対象外の名前は削除する。手で入れた値は次の配備で消える（意図的）。

## 6. 役割アドレス（RFC 2142 準拠）

| アドレス | 用途 |
|---|---|
| `contact@` | 対外窓口（控えの宛先・確認メールの返信先） |
| `noc@` | 稼働・障害の通知先（`contact-watch` / `contact-e2e` の異常通知。変数 `NOC_EMAIL`） |
| `hostmaster@` | DNS・ドメインの責任者（レジストラの登録者連絡先） |
| `dmarc@` | DMARC 集計の受け口 |
| `security@` | 脆弱性報告（`/.well-known/security.txt`、次の小 PR） |

## 7. 参照した標準・実務

- Cloudflare Turnstile: Testing（公式テストキー）、Server-side validation（siteverify）、Workers Rate Limiting binding、Workers Logs / Observability API
- Google: OAuth 2.0 for Web Server Applications（refresh_token grant）、Manage OAuth Clients（シークレットは作成時のみ表示）、Gmail API `users.messages.send`、送信者ガイドライン（SPF/DKIM/DMARC）、Workspace 2 段階認証の展開（新規ユーザーの登録期間）
- RFC 2142（役割メールボックス名）、RFC 9116（security.txt）、RFC 7489（DMARC）
- OWASP Automated Threats to Web Applications（多層のボット対策）、WCAG 2.2（CAPTCHA の代替手段）
- DORA / Continuous Delivery（自動テスト・継続的インテグレーション・配備前検証・小さなバッチ）

## 8. 意図的に含めないもの

- staging 環境の常設（CI 内起動で代替。理由: 本番ドメインに試験用の入口を置かない、費用と名前を増やさない）
- 受信箱の自動検査（AI にメール読み取り権限を渡さない。必要なら専用受信箱と限定権限を別途設計）
- 鍵なし認証（Cloudflare Workers → Google では不可。ローテーションで代替）

## 9. 運用手順

| したいこと | 手順 |
|---|---|
| 状態を知る | Actions → `contact-logs` → Run workflow（直近 N 時間）。AI が起動して読む |
| 異常通知が来た | 本文の記録を見る → `contact-logs` で詳細 → 必要なら `UNVERIFIED_POLICY` 変更や鍵の再発行（PR） |
| 送信の認証情報を更新 | https://reyz.inc/oauth/callback.html → 「同意を開始する」→ no-reply@ で許可 → 表示された同意コードを Actions `oauth-consent` に貼って実行（検証・Secret 更新・配備・旧トークン失効・記録は workflow）。詳細は `workers/contact/README.md` の「認証情報の更新」 |
| 型を新規サイトに設定（1 回） | `workers/contact/README.md` の「設定手順」。各設定の完了確認は Actions → `ops-check` → Run workflow（変更なし。Summary の表で PASS / FAIL と「次にやること」） |
| Turnstile 秘密キーをローテーション | Actions → `turnstile-rotate` → Run workflow（無人。四半期ごとは自動） |
| 型を別サイトへ複製 | `workers/contact/` と `qa/e2e_contact.js`、workflow 3 本をコピーし、vars（origin・宛先）と secrets を差し替える |

## 10. 関連する決定記録
ADR-0001（Cloudflare 出口）、0003（プロビジョニング層）、0004（役割アドレス）、0005（fail-open）、0006（CI 内フルスタック関門）、0007（送信主体の分離と OAuth。実施済み）、0008（同意の自動化。採用）。

## 11. 変更履歴

- 2026-09-29 v1: 初版。障害（`#turnstile` id 衝突、`turnstile.ready()`）を機に、PR 関門を CI 内フルスタック化。
- 2026-09-29 v2: 送信主体を `no-reply@` 実ユーザーに分離し、ドメイン全体の委任を OAuth 同意に置き換え（ADR-0007）。Worker の secret を GitHub Secrets から宣言的に同期。段階 2（MTA-STS / TLS-RPT / Postmaster Tools / security.txt）と段階 3（証跡の日次保管、AI 専用 GitHub App）は次版。
- 2026-09-30 v2.1: OAuth へ切替完了（実送信で差出人・受信トレイ・記録を確認）。サービスアカウント経路を Worker・workflow から削除。secret 同期を完全宣言型（管理対象外の削除）に。記録に認証方式 `auth`。同意を個人口座で行った事故（`docs/incidents/2026-09-30-…`）の再発防止として同意の自動化を ADR-0008 で扱う。
- 2026-09-30 v2.4: 前提の検査 `ops-check`（`infra/ops/check.mjs`）: 1 回設定の完了確認と週 1 の定期確認を、何も変更しない検査で機械化（Cloudflare トークンの権限、Turnstile 秘密キー、OAuth クライアント・リダイレクト URI・シークレット、リフレッシュトークンと同意した口座、GitHub App の鍵・権限・インストール先、受け取りページの公開値）。
- 2026-09-30 v2.3: 段階 0 の強化（ADR-0009 段階 0）: PKCE（RFC 9700 の推奨。貼る文字列に verifier を同梱し手順は不変）、本番 e2e を `dry_run='token'` にして毎日実行（同意の失効を送信前に検知）、Turnstile 回転の無人化（`turnstile-rotate`）、全アクションの SHA 固定＋Dependabot、OpenSSF Scorecard の常設、`contact-worker` の起動条件に関門が読む全ファイルを追加、運用 workflow 共通スクリプト `infra/ops/`。
- 2026-09-30 v2.2: 同意の自動化（ADR-0008）: 受け取りページ `site/oauth/callback.html`、`infra/oauth/consent.mjs`、workflow `oauth-consent`（口座の機械検証・Secret 更新・配備・旧トークン失効・issue への記録）、GitHub App「REYZ Ops」。Worker は Gmail の 401 で 1 回だけ取り直す。要件 R8 を追加。
