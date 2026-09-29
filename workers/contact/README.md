# 問い合わせフォーム受付 Worker（reyz.inc/api/contact）

設計の正本は [docs/contact-pipeline.md](../../docs/contact-pipeline.md)（要件・関門・方針・秘密・運用）。ここは実装と手順。

フォーム（`site/contact.html`）の「送信」を受け、① `contact@reyz.inc` へ控え、② 送信者へ受付確認メールを送る。Cloudflare Workers 上で動き、同じドメイン（`reyz.inc/api/*`）で応答するので CORS 不要。メールは Google Workspace（Gmail API）から `no-reply@reyz.inc` として送るため、SPF / DKIM / DMARC は既存の設定のまま整合する。

## 流れ

```
ブラウザ（contact.html）
  └─ POST /api/contact（JSON: name, person, email, type, message, website=honeypot, turnstile, client.turnstile=フォーム側の状態, dry_run）
       └─ Worker: Origin 検査 → 入力検証 → honeypot → レート制限（同一 IP 60 秒に 5 回）→ Turnstile 照合（siteverify）
            → 検証済み: Google token（サービスアカウント JWT、ドメイン全体の委任で GMAIL_SENDER_USER になりすます）
                        → Gmail API send ×2（控え → 送信者へ確認メール）→ {ok:true, verified:true, confirmation:true|false}
            → 未検証（トークン無し／不合格）: UNVERIFIED_POLICY=accept-flagged なら控えだけ送る（件名 [未検証]、本文にフォーム側の状態と siteverify の codes）
                        → {ok:true, verified:false, confirmation:false}。確認メールは送らない（未確認の宛先へ自動返信しない）
```

### 送信者の環境に依存しない設計（多層防御）

| 層 | 内容 | 目的 |
|---|---|---|
| フォーム | Turnstile は「読めたら使う」（appearance=interaction-only、入力開始時に先読み）。読めない／描画失敗／時間切れでも送信し、状態を `client.turnstile` で伝える。トークン不受理は 1 回取り直して再送、通信断は 1 回再試行。それでも駄目なら文面コピー＋「メールアプリで送る」（`CONFIG.contactEmail`） | 拡張機能・企業ネットワーク・古い端末でも連絡経路を失わない |
| Worker | honeypot → レート制限（`CONTACT_RL`）→ Turnstile → 未検証ヒューリスティック（リンク 3 本以上・名前に URL は拒否） | ボットの大量送信を抑える |
| 運用 | 未検証は件名 `[未検証]` で届く。増えたら `UNVERIFIED_POLICY=reject`（wrangler.toml）に切り替える | 状況に応じて厳しさを変えられる |
| 確認 | `contact-e2e` workflow（拡張機能なしの Chromium から dry_run で通し確認。配備後に自動実行、手動起動も可） | 実端末に依存しない再現性のある検証 |

`dry_run: true` を付けた POST は照合まで行い送信しない（`{ok:true, dry_run:true, verified, codes, client, rate_limit}`）。

| 応答 | 意味 |
|---|---|
| 200 `{ok:true, verified, confirmation}` | 受付完了。`verified:false` は未検証で受付（確認メールなし）、`confirmation:false` は確認メールだけ失敗 |
| 400 `validation` | 入力不備（`fields` に項目名） |
| 403 `origin` / `turnstile` / `suspicious` | フォーム以外からの送信 / 未検証を拒否する方針のとき / 未検証かつ内容が疑わしい |
| 429 `rate_limited` | 同一 IP からの送りすぎ（`Retry-After: 60`） |
| 413 / 415 / 405 / 404 | 大きすぎる / JSON でない / POST 以外 / 別パス |
| 502 `send` | Google 側で失敗（委任未設定・鍵不正・API 無効など。Workers Logs に詳細） |
| 503 `not_configured` | secret / vars が足りない（配備直後の未設定など） |

honeypot（`website`）に値があるものは、Turnstile 検証済み（＝人。ブラウザの自動入力が埋めた可能性）なら注記付きで受け付け、未検証なら成功を装って捨てる。記録（Workers Logs）は結果・検証状態・Gmail の受理 ID・種別・国・Ray のみで、本文とメールアドレスは残さない。

### 運用（人手を最小にする）

| 知りたいこと | 手段 | 誰が |
|---|---|---|
| フォームが壊れていないか | `contact-e2e`（配備のたびに自動。手動起動も可） | 自動 → AI が結果を読む |
| 送信が Worker に届き、Gmail が受理したか | `contact-logs`（Actions → Run workflow → 直近 N 時間）。`gmail_copy` / `gmail_confirmation` に ID が出れば Gmail は受理済み（＝送信者アカウントの「送信済み」にある） | AI が起動・判読 |
| 受信箱に実際に入ったか（迷惑メール判定など） | 受信側のメールボックス（自動化しない: 読み取り権限を広げない方針） | ロウ（必要時のみ） |

## 配置

| パス | 役割 |
|---|---|
| `src/index.js` | Worker 本体（依存ライブラリなし。WebCrypto + fetch） |
| `test/contact.test.js` | 自己テスト（`node --test`。Google / Turnstile は fetch 差し替え、鍵はテスト内で生成） |
| `wrangler.toml` | 名前 `reyz-contact`、ルート `reyz.inc/api/*` `www.reyz.inc/api/*`、`workers_dev=false`、レート制限 binding、公開値の vars（`UNVERIFIED_POLICY` 含む） |
| `ci/make_ci_config.py` | CI 用 wrangler 設定を本番 `wrangler.toml` から生成（差分 5 点のみ。生成物はコミットしない） |
| `../../qa/e2e_contact.js` | 通し確認。`--mode ci`（CI 内フルスタック、公式テストキー、4 ケース）／`--mode prod`（公開サイト） |
| `../../.github/workflows/contact-worker.yml` | PR: `worker-tests` ＋ `stack-e2e`。main: 配備 |
| `../../.github/workflows/contact-e2e.yml` | 配備後の本番通し確認。失敗は noc@ へ通知 |
| `../../.github/workflows/contact-watch.yml` | 毎日の集計。異常と鍵の期限だけ noc@ へ通知 |
| `../../infra/check/notify_noc.mjs` | 通知メール送信（Worker と同じ送信経路・同じコード） |
| `../../infra/check/contact_logs.py` + `../../.github/workflows/contact-logs.yml` | Worker の記録（結果・検証状態・Gmail 受理 ID）を Workers Logs API から一覧にする。手動起動、読み取りのみ |
| `../../site/assets/site.js` | `CONFIG.formEndpoint='/api/contact'`、`CONFIG.turnstileSiteKey` で有効化（確認ページに Turnstile を描画） |

## 前提（1 回だけ。値はリポジトリに書かない）

| 場所 | 名前 | 中身 | 出所 |
|---|---|---|---|
| GitHub → Secrets | `GMAIL_OAUTH_CLIENT_ID` / `GMAIL_OAUTH_CLIENT_SECRET` | OAuth クライアント（内部アプリ、Web アプリケーション、リダイレクト URI = OAuth Playground） | GCP（reyz.inc 組織配下のプロジェクト）→ API とサービス → 認証情報 |
| GitHub → Secrets | `GMAIL_OAUTH_REFRESH_TOKEN` | 送信専用ユーザー `no-reply@reyz.inc` 本人が同意して得たリフレッシュトークン（scope gmail.send） | OAuth Playground（下の「移行手順」） |
| （移行期間のみ）GitHub → Secrets | `GMAIL_SA_KEY` / `GMAIL_SENDER_USER` | サービスアカウント鍵と、なりすまし先ユーザー。OAuth の 3 件がそろえば adapter は OAuth を使い、これらは削除できる | — |
| GitHub → Secrets | `TURNSTILE_SECRET_KEY` | Turnstile ウィジェットの Secret Key | Cloudflare → Turnstile → ウィジェット（hostname: reyz.inc, www.reyz.inc） |
| GitHub → Secrets | `CLOUDFLARE_WORKERS_TOKEN` | Workers 配備用トークン（テンプレート「Cloudflare Workers を編集する」、Zone を reyz.inc に限定） | Cloudflare → プロフィール → API トークン |
| GitHub → Variables | `CLOUDFLARE_ACCOUNT_ID` | （DNS と共通。設定済み） | — |
| GitHub → Variables | `NOC_EMAIL` | 異常通知の宛先（`noc@reyz.inc`。RFC 2142 の役割アドレス） | 管理コンソールでエイリアス作成 |
| GitHub → Variables | `GMAIL_SA_KEY_CREATED` | サービスアカウント鍵の作成日 `YYYY-MM-DD`（90 日ローテーションの起点） | 鍵を作った日 |
| `site/assets/site.js` | `turnstileSiteKey` | Turnstile の Site Key（公開値） | 同上ウィジェット |

## 移行手順（サービスアカウント＋委任 → 送信専用ユーザーの OAuth。ADR-0007。1 回だけ、ロウ）

秘密の値が表示される画面（クライアント シークレット、リフレッシュトークン）は **スクリーンショットを送らない**。

| # | 場所 | 操作 |
|---|---|---|
| 1 | 管理コンソール → ユーザー → horiuchi@ → 予備のメールアドレス | エイリアス `no-reply` を削除（同じアドレスを実ユーザーにするため） |
| 2 | 管理コンソール → ユーザー → 新しいユーザーを追加 | 名 `REYZ` / 姓 `Inc.`（表示名 REYZ Inc.）/ メール `no-reply` → パスワードを控える（初回ログインで 2 段階認証の設定を求められる） |
| 3 | https://console.cloud.google.com に **horiuchi@reyz.inc** でログイン | 利用規約に同意すると組織 `reyz.inc` が自動作成される → 「プロジェクトを作成」: 名前 `reyz-mail`、場所 = 組織 `reyz.inc`（請求先は不要） |
| 4 | 同プロジェクト → API とサービス → ライブラリ | **Gmail API** を有効化 |
| 5 | 同プロジェクト → API とサービス → OAuth 同意画面（Google Auth Platform） | 対象 **内部**、アプリ名 `REYZ Mail Sender`、サポートメール `noc@reyz.inc`、スコープに `https://www.googleapis.com/auth/gmail.send` を追加 → 保存 |
| 6 | 同 → 認証情報 → 認証情報を作成 → OAuth クライアント ID | 種類 **ウェブ アプリケーション**、名前 `reyz-mail-sender`、承認済みのリダイレクト URI `https://developers.google.com/oauthplayground` → 作成 → クライアント ID を GitHub Secret `GMAIL_OAUTH_CLIENT_ID`、クライアント シークレットを `GMAIL_OAUTH_CLIENT_SECRET` に登録 |
| 7 | https://developers.google.com/oauthplayground | 右上の歯車 → ✅ Use your own OAuth credentials → 6 の ID とシークレットを入力 → 左の Step 1 の入力欄に `https://www.googleapis.com/auth/gmail.send` → Authorize APIs → **no-reply@reyz.inc** でログインして許可 → Step 2 「Exchange authorization code for tokens」→ 表示された **Refresh token** を GitHub Secret `GMAIL_OAUTH_REFRESH_TOKEN` に登録 |
| 8 | GitHub → Actions → contact-worker → Run workflow | 再配備（Worker secret が同期される）。以後の送信は no-reply@ 本人の OAuth |
| 9 | 動作確認後の後始末 | GitHub Secrets `GMAIL_SA_KEY` `GMAIL_SENDER_USER` と変数 `GMAIL_SA_KEY_CREATED` を削除 → contact-worker を再実行（Worker からも削除される）→ 管理コンソール → API の制御 → ドメイン全体の委任 の行を削除 → 旧プロジェクト `reyz-site` のサービスアカウント `contact-mailer` を削除 → horiuchi@ の Gmail「他のメールアドレス」から no-reply を削除 |

Google 側（参考。旧方式＝移行期間のみ）:

1. Gmail API を有効化
2. 管理コンソール → セキュリティ → API の制御 → ドメイン全体の委任 → サービスアカウントの「一意の ID」とスコープ `https://www.googleapis.com/auth/gmail.send`
3. `GMAIL_SENDER_USER` のユーザーにエイリアス `no-reply@reyz.inc` と Gmail の送信元登録

## 切替手順

1. 上記の secret / token をすべて登録
2. この Worker を含む PR をマージ → `contact-worker` が配備 → run の annotation に `GET https://reyz.inc/api/contact -> HTTP 405`
3. `site/assets/site.js` の `formEndpoint: '/api/contact'` と `turnstileSiteKey` を設定する PR をマージ（サイト側の切替。Worker が先）
4. 実送信テスト: フォームから 1 件送り、`contact@reyz.inc` の控え（Reply-To が送信者）と送信者側の確認メール（From `no-reply@reyz.inc`、DKIM/SPF/DMARC PASS）を確認

## 守ること

- フォーム側の要素 id を `turnstile` にしない（id 付き要素は `window.turnstile` として見え、Turnstile API の `window.turnstile` を隠して描画が失敗する。2026-09-29 に実際に起きた障害）

- JSON 鍵・Secret Key・トークンをチャット・Markdown・コミットに書かない。鍵の JSON はダウンロード後に Secret へ入れて手元から削除
- Worker は `workers_dev=false`（`*.workers.dev` では公開しない）。ルートは `reyz.inc/api/*` のみ
- 送信上限は Workspace の枠（有料 2,000 通/日/ユーザー）。フォームの想定量では問題にならないが、迷惑送信の疑いが出たら Turnstile の設定と Workers Logs を見る
