# 問い合わせ受付の標準型 v1（設計書・正本）

対象: reyz.inc の問い合わせフォーム（受付・ボット対策・メール送信・検証・運用）。今後の顧客サイトにそのまま複製する「型」。
更新日: 2026-09-29。変更はこの文書を PR で更新してから実装する。

## 1. 目的と要件

| # | 要件 | 判定方法 |
|---|---|---|
| R1 | 送信者の環境（拡張機能・企業ネットワーク・端末）に依存せず、内容が REYZ に届く | 未検証経路（fail-open）の e2e が通る |
| R2 | ボットの大量送信を抑える | Turnstile 照合 ＋ レート制限 ＋ honeypot ＋ ヒューリスティック。単体テストと e2e |
| R3 | 未確認の宛先へ自動返信しない（なりすまし・バックスキャッター防止） | 未検証時は確認メールを送らない（単体テスト） |
| R4 | 変更を本番に出す前に、本物の部品で通しの動作を確認する | PR 関門 `stack-e2e`（本物 Turnstile＝公式テストキー、Google 委任トークン） |
| R5 | 状態が人手なしで分かる | 記録は PII なしの構造化ログ。`contact-logs` / `contact-watch` / `contact-e2e` を AI が API で読む |
| R6 | 秘密はリポジトリ・チャット・ログに出さない | GitHub Secrets → Worker secret。CI では一時ファイルに展開し必ず削除 |
| R7 | 追加インフラ・費用なし、専用環境を常設しない | Workers / Actions の無料枠。CI 内で起動して終わったら破棄 |

## 2. 構成

```
訪問者のブラウザ ── contact.html（GitHub Pages を Cloudflare が配信）
   │  Turnstile（読めたら使う。appearance=interaction-only）
   ▼ POST /api/contact（同一 origin。JSON: 入力値 ＋ honeypot ＋ Turnstile トークン ＋ client.turnstile=フォーム側の状態）
Cloudflare Worker reyz-contact
   Origin 検査 → 入力検証 → レート制限（同一 IP 60 秒 5 回）→ Turnstile 照合 → honeypot 判定 → 未検証方針
   → Google 委任トークン（サービスアカウント JWT、ドメイン全体の委任 gmail.send）
   → Gmail API: ① contact@ へ控え ② 検証済みの送信者へ確認メール（差出人 no-reply@reyz.inc）
   → 構造化ログ（結果・検証状態・Gmail 受理 ID・種別・国・Ray。本文・氏名・メールアドレスは記録しない）
```

送信者に見える挙動: 「送信しました。」。未検証で受け付けた場合は「確認メールの自動送信は行われませんでしたが、内容は届いています。」を追記。送れなかった場合は文面コピー ＋「メールアプリで送る」（contact@reyz.inc）を必ず表示。

## 3. 環境と関門

| 段階 | 起動するもの | 自動で通す関門 | 人 |
|---|---|---|---|
| PR | CI 内: サイト生成物のコピー ＋ Worker（本番と同じコード。設定は `wrangler.toml` から生成、差分 5 点のみ）を同一 origin で起動。本物の Turnstile を**公式テストキー**で。Google は委任トークン取得まで。メールは送らない | `worker-tests`（単体 11 件 ＋ dry-run）、`stack-e2e`（4 ケース: pass / fail-widget / interactive / fail-secret。初回実測 2026-09-29: pass=検証済み＋Google トークン取得、fail-widget=error-callback → fail-open、interactive=送信が待つ、fail-secret=照合不合格を未検証受付として記録）、`site-verify`（サイト全検証） | マージ承認 |
| 本番 | main へのマージで配備（Worker: `contact-worker` deploy、サイト: `verify-and-deploy`） | 配備後の疎通（405）→ `contact-e2e`（本物キー。トークンの有無は情報、エラーは失敗）| なし |
| 運用 | `contact-watch`（毎日 09:37 JST）、`contact-logs`（手動） | 異常（エラー応答・未検証の急増・鍵の期限）だけ `noc@reyz.inc` へメール。平常時は無通知 | 通知を受けて判断 |

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
| Google サービスアカウント鍵 `GMAIL_SA_KEY` | GitHub Secrets → Worker secret / CI の一時ファイル | 委任スコープ `gmail.send` のみ | 90 日でローテーション（`contact-watch` が 80 日で警告。作成日は変数 `GMAIL_SA_KEY_CREATED`） |
| なりすまし先 `GMAIL_SENDER_USER` | 同上 | — | — |
| Turnstile 秘密キー | 同上 | — | 漏えい時はローテーション（2026-09-29 実施済み） |
| Cloudflare トークン `CLOUDFLARE_WORKERS_TOKEN` | GitHub Secrets | Workers スクリプト編集・ルート編集（reyz.inc 限定）・可観測性 | 必要時に再発行 |

AI は秘密の値を持たない。読むのは配備結果・記録・e2e の結果のみ。受信箱の中身は読まない（DECISION: 権限設計を別途判断）。

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
- Google: Workspace ドメイン全体の委任、Gmail API `users.messages.send`、送信者ガイドライン（SPF/DKIM/DMARC）
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
| 鍵をローテーション | GCP → サービスアカウント → キー → 新しい鍵（JSON）→ GitHub Secret `GMAIL_SA_KEY` を更新 → 変数 `GMAIL_SA_KEY_CREATED` を更新 → 古い鍵を削除 → `contact-worker` を Run workflow（再配備で Worker secret 更新） |
| Turnstile 秘密キーをローテーション | Cloudflare → Turnstile → ウィジェット → ローテーション → Secret 更新 → `contact-worker` を Run workflow |
| 型を別サイトへ複製 | `workers/contact/` と `qa/e2e_contact.js`、workflow 3 本をコピーし、vars（origin・宛先）と secrets を差し替える |

## 10. 変更履歴

- 2026-09-29 v1: 初版。障害（`#turnstile` id 衝突、`turnstile.ready()`）を機に、PR 関門を CI 内フルスタック化。
