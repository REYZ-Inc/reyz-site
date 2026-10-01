# 問い合わせフォーム受付 Worker（reyz.inc/api/contact）

設計の正本は [docs/contact-pipeline.md](../../docs/contact-pipeline.md)（要件・関門・方針・秘密・運用）。ここは実装と手順。

フォーム（`site/contact.html`）の「送信」を受け、① `contact@reyz.inc` へ控え、② 送信者へ受付確認メールを送る。Cloudflare Workers 上で動き、同じドメイン（`reyz.inc/api/*`）で応答するので CORS 不要。メールは Google Workspace（Gmail API）から `no-reply@reyz.inc` として送るため、SPF / DKIM / DMARC は既存の設定のまま整合する。

## 流れ

```
ブラウザ（contact.html）
  └─ POST /api/contact（JSON: name, person, email, type, message, website=honeypot, turnstile, client.turnstile=フォーム側の状態, dry_run）
       └─ Worker: Origin 検査 → 入力検証 → honeypot → レート制限（同一 IP 60 秒に 5 回）→ Turnstile 照合（siteverify）
            → 検証済み: Google アクセストークン（送信専用ユーザー no-reply@ 本人の OAuth リフレッシュトークン → refresh_token grant）
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
| 502 `send` | Google 側で失敗（`stage: token` = 同意の失効・クライアント不正、`stage: copy` = Gmail API 側。Workers Logs に詳細） |
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
| `src/index.js` | Worker 本体（依存ライブラリなし。fetch のみ） |
| `test/contact.test.js` | 自己テスト（`node --test`。Google / Turnstile は fetch 差し替え） |
| `wrangler.toml` | 名前 `reyz-contact`、ルート `reyz.inc/api/*` `www.reyz.inc/api/*`、`workers_dev=false`、レート制限 binding、公開値の vars（`UNVERIFIED_POLICY` 含む） |
| `ci/make_ci_config.py` | CI 用 wrangler 設定を本番 `wrangler.toml` から生成（差分 5 点のみ。生成物はコミットしない） |
| `../../qa/e2e_contact.js` | 通し確認。`--mode ci`（CI 内フルスタック、公式テストキー、4 ケース）／`--mode prod`（公開サイト） |
| `../../.github/workflows/contact-worker.yml` | PR: `worker-tests` ＋ `stack-e2e`。main: 配備 → Worker secret を GitHub Secrets と宣言的に同期（管理対象外は削除）→ 疎通 |
| `../../.github/workflows/contact-e2e.yml` | 配備後と毎日 09:07 JST の本番通し確認（`dry_run='token'`＝Google のトークン取得まで。同意の失効を送信前に検知）。失敗は noc@ へ通知 |
| `../../.github/workflows/contact-watch.yml` | 毎日の集計。異常（エラー応答・未検証の急増）だけ noc@ へ通知。同意の失効はエラー応答 `send/token` として現れる |
| `../../infra/check/notify_noc.mjs` | 通知メール送信（Worker と同じ送信経路・同じコード） |
| `../../infra/check/contact_logs.py` + `../../.github/workflows/contact-logs.yml` | Worker の記録（結果・検証状態・Gmail 受理 ID・認証方式 `auth`）を Workers Logs API から一覧にする。手動起動、読み取りのみ |
| `../../site/assets/site.js` | `CONFIG.formEndpoint='/api/contact'`、`CONFIG.turnstileSiteKey` で有効化（確認ページに Turnstile を描画） |
| `../../site/oauth/callback.html` | 同意の受け取りページ（同意リンクの組み立てと同意コードの表示だけ。秘密なし、noindex、サイト導線から未リンク） |
| `../../infra/oauth/consent.mjs` + `test/` | 同意コードの交換、ID トークンによる口座の検証（不一致なら失効して失敗）、古いトークンの失効 |
| `../../.github/workflows/oauth-consent.yml` | 同意コード（`コード~verifier`、PKCE）を 1 回貼ると、検証 → Secret 更新 → 配備 → 失効 → 記録まで行う（GitHub App の権限） |
| `../../.github/workflows/turnstile-rotate.yml` | Turnstile 秘密キーの回転を無人で行う（Cloudflare API → Secret → 配備 → 記録） |
| `../../infra/ops/deploy_wait.sh` / `record.sh` | 運用 workflow 共通: 配備の起動と完了待ち／運用記録 issue へのコメント |

## 前提（1 回だけ。値はリポジトリに書かない）

| 場所 | 名前 | 中身 | 出所 |
|---|---|---|---|
| GitHub → Secrets | `GMAIL_OAUTH_CLIENT_ID` / `GMAIL_OAUTH_CLIENT_SECRET` | OAuth クライアント（内部アプリ、ウェブ アプリケーション、リダイレクト URI = `https://reyz.inc/oauth/callback.html`）。シークレットは作成時にしか全文が見えない（Google の仕様）ので、その場で登録する | GCP（組織 `reyz.inc` 配下のプロジェクト `reyz-mail`）→ Google Auth Platform → クライアント |
| GitHub → Secrets | `GMAIL_OAUTH_REFRESH_TOKEN` | 送信専用ユーザー `no-reply@reyz.inc` **本人**が同意して得たリフレッシュトークン（scope gmail.send）。人は貼らない: `oauth-consent` workflow が検証して登録する | 下の「設定手順」7〜8 |
| GitHub → Secrets / Variables | `OPS_APP_PRIVATE_KEY` / `OPS_APP_ID` | 運用 workflow の主体となる GitHub App「REYZ Ops」の秘密鍵と App ID（Secret 更新・配備起動・記録に使う。ADR-0008） | 下の「GitHub App（1 回）」 |
| GitHub → Variables | `MAIL_SENDER_USER` | 送信専用ユーザーのアドレス `no-reply@reyz.inc`（同意した口座の検証に使う） | — |
| GitHub → Secrets | `TURNSTILE_SECRET_KEY` | Turnstile ウィジェットの Secret Key。初回は作成画面で登録、以後の回転は `turnstile-rotate` workflow が API で行い人は値を見ない | Cloudflare → Turnstile → ウィジェット（hostname: reyz.inc, www.reyz.inc） |
| GitHub → Secrets | `CLOUDFLARE_TURNSTILE_TOKEN` | Turnstile の回転用トークン（アカウント単位、権限は **Turnstile: 編集** のみ） | Cloudflare → プロフィール → API トークン → カスタム トークン |
| GitHub → Secrets | `CLOUDFLARE_WORKERS_TOKEN` | Workers 配備用トークン（テンプレート「Cloudflare Workers を編集する」、Zone を reyz.inc に限定） | Cloudflare → プロフィール → API トークン |
| GitHub → Variables | `CLOUDFLARE_ACCOUNT_ID` | （DNS と共通。設定済み） | — |
| GitHub → Variables | `NOC_EMAIL` | 異常通知の宛先（`noc@reyz.inc`。RFC 2142 の役割アドレス） | 管理コンソールでエイリアス作成 |
| `site/assets/site.js` | `turnstileSiteKey` | Turnstile の Site Key（公開値） | 同上ウィジェット |

GitHub Secrets が Worker secret の正本。配備（`contact-worker`）のたびに、管理対象 4 件は値があれば設定・空なら削除され、管理対象外（Worker にだけある名前）は削除される。手で `wrangler secret put` した値は次の配備で消える。

**完了確認（各行を登録したら）**: Actions → **`ops-check`** → Run workflow（何も変更しない）。Summary の表に C1〜C9 の PASS / FAIL / SKIP と「次にやること」が出る（C1 有無と形式、C2 Turnstile 回転用トークンの権限、C3 Workers 配備用トークン、C4 Turnstile 秘密キー、C5 OAuth クライアントとリダイレクト URI、C6 クライアント シークレット、C7 リフレッシュトークンと同意した口座、C8 GitHub App の鍵・権限・インストール先、C9 受け取りページの公開値）。IV は API で起動して結果を読めるので、人は画面を送らなくてよい。毎週月曜にも自動で走る。

## 設定手順（送信専用ユーザーと OAuth。ADR-0007 / 0008。初回と、型を別サイトへ複製するとき。ロウ）

秘密の値が表示される画面（クライアント シークレット、リフレッシュトークン、バックアップコード）は **スクリーンショットを送らない**。
2026-09-30 の初回実施で分かった落とし穴を手順に織り込んである（[事故記録](../../docs/incidents/2026-09-30-oauth-consent-wrong-account.md)）。

| # | 場所 | 操作 |
|---|---|---|
| 1 | 管理コンソール → ユーザー → 新しいユーザーを追加 | 名 `REYZ` / 姓 `Inc.`（表示名 REYZ Inc.）/ メール `no-reply` → パスワードは会社のパスワード管理へ。同じアドレスがエイリアスとして残っていれば先に削除 |
| 2 | **シークレット ウィンドウ**で https://accounts.google.com に `no-reply@reyz.inc` でログイン | **初回ログインと 2 段階認証の登録をこの時点で済ませる**（組織は 2SV 必須。未登録のままだと後の同意画面でログインを拒否される）。方法は認証システム アプリ。その鍵とバックアップコードもパスワード管理へ |
| 3 | https://console.cloud.google.com に **horiuchi@reyz.inc**（組織の管理者）でログイン | 組織 `reyz.inc` 配下に「プロジェクトを作成」: 名前 `reyz-mail`（請求先は不要）。個人 Gmail の口座で作ったプロジェクトは「組織なし」になり内部アプリを作れない |
| 4 | 同プロジェクト → API とサービス → ライブラリ | **Gmail API** を有効化 |
| 5 | 同 → Google Auth Platform → ブランディング／対象／データアクセス | 対象 **内部**、アプリ名 `REYZ Mail Sender`、サポートメールは Workspace のユーザーかグループ、**データアクセス**でスコープ `https://www.googleapis.com/auth/gmail.send` を追加 → 保存 |
| 6 | 同 → クライアント → クライアントを作成 | 種類 **ウェブ アプリケーション**、名前 `reyz-mail-sender`、「承認済みのリダイレクト URI」（JavaScript 生成元ではない）に **`https://reyz.inc/oauth/callback.html`** → 作成 → **この画面で** クライアント ID を GitHub Secret `GMAIL_OAUTH_CLIENT_ID`、クライアント シークレットを `GMAIL_OAUTH_CLIENT_SECRET` に登録（閉じると末尾 4 文字しか見えない。見失ったら「シークレットを追加」で新しいものを作り、古いものは無効化 → 削除）。クライアント ID は `site/oauth/callback.html` の `CONFIG.clientId` にも書く（公開値） |
| 7 | https://reyz.inc/oauth/callback.html | **「同意を開始する」** → Google のログインは `no-reply@reyz.inc`（リンクが口座を指定している。他の口座で許可しても 8 で拒否される）→ 許可 → ページに戻ると **同意コード**（`コード~verifier`。PKCE の verifier を含む 1 つの文字列）が表示される → 「コードをコピー」。同意を始めたのと同じブラウザで受け取る（verifier はそのブラウザにしかない） |
| 8 | GitHub → Actions → **oauth-consent** → Run workflow | `code` に貼って実行。workflow が: 交換 → 同意した口座が no-reply@ か検証（違えば失効して失敗） → Secret `GMAIL_OAUTH_REFRESH_TOKEN` 更新 → `contact-worker` を起動して配備完了を待つ → issue「運用記録 — 認証情報」にコメント。結果は run の Summary。古いトークンは失効させない（Google の失効はグラント単位で、新しい鍵も消える。[事故記録](../../docs/incidents/2026-10-01-oauth-consent-revoke.md)） |
| 9 | 実送信テスト | フォームから 1 件送る → 控え（contact@ 宛）と確認メールの **両方が `REYZ Inc. <no-reply@reyz.inc>` から届き、受信トレイに入る**ことを確認。`contact-logs` の記録は `verified=True confirmation=True auth=oauth` と Gmail 受理 ID 2 件 |

### 同意の自動化の前提（1 回。Owner 権限。ロウ）

`oauth-consent` workflow が動くために、次の 3 つが要る（無ければ workflow が最初の段で「未設定」を出して止まる）。それぞれ `ops-check` の C5 / C1 / C8 で確認できる。

1. OAuth クライアント `reyz-mail-sender` の「承認済みのリダイレクト URI」に `https://reyz.inc/oauth/callback.html` があること（GCP → Google Auth Platform → クライアント → URI を追加 → 保存。Playground の URI は不要になったら削除）
2. GitHub の変数 `MAIL_SENDER_USER` = `no-reply@reyz.inc`
3. GitHub App「REYZ Ops」（下表）。運用 workflow が Secret を書き、配備を起動し、記録を残すための主体。Actions の既定トークンには Secret を書く権限が無い

| # | 場所 | 操作 |
|---|---|---|
| 1 | GitHub → 組織 REYZ-Inc → Settings → Developer settings → GitHub Apps → **New GitHub App** | GitHub App name `REYZ Ops`、Homepage URL `https://reyz.inc`、**Webhook の Active のチェックを外す** |
| 2 | 同画面 Permissions → Repository permissions | **Actions: Read and write** / **Secrets: Read and write** / **Issues: Read and write**（Metadata: Read-only は自動）。他は No access |
| 3 | 同画面 Where can this GitHub App be installed? | **Only on this account** → Create GitHub App |
| 4 | 作成後の画面 | **App ID** の数字を控える → GitHub → repo `reyz-site` → Settings → Secrets and variables → Actions → **Variables** → New repository variable `OPS_APP_ID` = その数字。あわせて `MAIL_SENDER_USER` = `no-reply@reyz.inc` も作る |
| 5 | 同画面の下 Private keys → **Generate a private key** | `.pem` がダウンロードされる → メモ帳で開いて **全文**（`-----BEGIN RSA PRIVATE KEY-----` から `-----END RSA PRIVATE KEY-----` まで）をコピー → repo の **Secrets** → New repository secret `OPS_APP_PRIVATE_KEY` に貼る → 保存後、`.pem` ファイルは削除 |
| 6 | 左メニュー Install App → REYZ-Inc の **Install** | **Only select repositories** → `reyz-site` → Install |

### 認証情報の更新（ローテーション・失効時）

| 更新するもの | 手順 |
|---|---|
| リフレッシュトークン（失効: 取り消し・no-reply@ のパスワード変更・6 か月未使用。症状: 502 `send/token` `invalid_grant`、`contact-watch` が通知） | 上の 7 → 8（→ 9 で確認）。古いトークンは失効させない（Secret と Worker secret の上書きでどこにも残らず、6 か月未使用で自然失効）。漏えい時だけ: Google アカウント（no-reply@）の「第三者アクセス」で REYZ Mail Sender を削除 → 7 → 8 |
| クライアント シークレット（漏えい時） | GCP → クライアント → 「シークレットを追加」→ 新しい値を GitHub Secret `GMAIL_OAUTH_CLIENT_SECRET` に上書き → 7 → 8（リフレッシュトークンは新しいシークレットでも有効だが、漏えい時は一緒に取り直す）→ 古いシークレットを無効化 → 削除 |
| Turnstile 秘密キー | **無人**: `turnstile-rotate` workflow（四半期ごとに自動。漏えい時は Run workflow）が Cloudflare API で回転 → Secret 更新 → 配備 → 記録。旧キーは Cloudflare の猶予期間（約 2 時間）のあと無効。前提は下の「Turnstile 秘密キーの回転」 |

### Turnstile 秘密キーの回転（1 回の準備。Owner 権限。ロウ）

1. Cloudflare → 右上プロフィール → **API トークン**（ユーザー API トークン。画面が推奨する「アカウント API トークン」は **Turnstile 未対応**なので使えない） → **トークンを作成** → **カスタム トークン**: 名前 `reyz-turnstile-rotate`、権限 **アカウント | Turnstile | 編集** だけ、アカウント リソース = REYZ のアカウント、TTL なし → 作成
2. 表示されたトークンを GitHub Secret `CLOUDFLARE_TURNSTILE_TOKEN` に登録（画面のスクリーンショットは送らない）→ 確認: `ops-check` の C2 が PASS（トークンが有効で、ウィジェットを読める）
3. 以後は `turnstile-rotate` が四半期ごと（1・4・7・10 月 1 日 10:17 JST）に自動で回転する。漏えい時は Actions → `turnstile-rotate` → Run workflow

### 失敗した main の run を再開する

main の `contact-worker` が失敗したとき、修正が起動条件（`workers/contact/**`、`infra/oauth/**`、`qa/e2e_contact.js`、workflow 自体）に当たらないファイルだけなら配備は再開しない。その場合は Actions → 失敗した run → **Re-run failed jobs**（または `contact-worker` の Run workflow）。

### 旧方式（サービスアカウント＋ドメイン全体の委任）の後片付け — 2026-09-30

| 項目 | 状態 |
|---|---|
| GitHub Secrets `GMAIL_SA_KEY` / `GMAIL_SENDER_USER`、変数 `GMAIL_SA_KEY_CREATED` の削除 | 済（2026-09-30） |
| Worker 側の同名 secret の削除 | 済（2026-09-30 PR #18 の配備。annotation `delete=GMAIL_SA_KEY,GMAIL_SENDER_USER`） |
| horiuchi@ の Gmail「他のメールアドレス」から `no-reply@` を削除 | 済（2026-09-30） |
| 管理コンソール → API の制御 → ドメイン全体の委任 の行（contact-mailer）を削除 | 済（2026-09-30。一覧 0 件を確認） |
| 旧プロジェクト `reyz-site`（個人 Gmail の口座）のサービスアカウント `contact-mailer` を削除 | 済（2026-09-30。一覧 0 件を確認） |
| horiuchi@ に誤って与えた「REYZ Mail Sender」のアクセス権を削除 | 済（2026-09-30） |
| 古いクライアント シークレットの無効化・削除 | 済（2026-09-30。1 件のみを確認） |
| no-reply@ の 2 段階認証を登録し、登録期間を「なし」に戻す | 済（2026-09-30。認証システム アプリ） |

## 切替手順（新規サイトで最初に有効にするとき）

1. 上記の secret / 変数をすべて登録
2. この Worker を含む PR をマージ → `contact-worker` が配備 → run の annotation に `GET https://reyz.inc/api/contact -> HTTP 405`
3. `site/assets/site.js` の `formEndpoint: '/api/contact'` と `turnstileSiteKey` を設定する PR をマージ（サイト側の切替。Worker が先）
4. 実送信テスト（設定手順 10）

## 守ること

- フォーム側の要素 id を `turnstile` にしない（id 付き要素は `window.turnstile` として見え、Turnstile API の `window.turnstile` を隠して描画が失敗する。2026-09-29 に実際に起きた障害）

- クライアント シークレット・リフレッシュトークン・Secret Key をチャット・Markdown・コミット・workflow の入力欄に書かない（入力欄の値は run の記録に残る）
- 同意（OAuth）は受け取りページから始め、`oauth-consent` workflow で登録する（口座を機械が検証する）。Playground や手貼りで `GMAIL_OAUTH_REFRESH_TOKEN` を入れない。個人の口座で同意すると、確認メールがその人のアドレスから出て、控えは受信トレイに入らない（2026-09-30 の事故）
- Worker は `workers_dev=false`（`*.workers.dev` では公開しない）。ルートは `reyz.inc/api/*` のみ
- 送信上限は Workspace の枠（有料 2,000 通/日/ユーザー）。フォームの想定量では問題にならないが、迷惑送信の疑いが出たら Turnstile の設定と Workers Logs を見る
