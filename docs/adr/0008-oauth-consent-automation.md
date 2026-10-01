# 0008 送信専用ユーザーの OAuth 同意を自動化し、人の操作を「許可」と「コードを 1 回貼る」だけにする

- 状態: 採用（2026-09-30 CEO 指示「自動化させる」）。初回実行で PASS を確定
- 決定者: ロウ（CEO）／起案: IV

## 文脈
- 2026-09-30、OAuth の同意を CEO 個人の口座で行ってしまい、本番の確認メールが個人アドレスから出た（[事故記録](../incidents/2026-09-30-oauth-consent-wrong-account.md)）。原因は、手順が「同意する口座」を機械的に確かめる段を持たず、人の目視と転記（Playground にクライアント ID／シークレットを 3 回入力、リフレッシュトークンを GitHub に貼る）に頼っていたこと
- REYZ の原則（`docs/STANDARDS.md`「人の操作の最小化」）: 人が行うのは本人確認と承認だけ。値の転記・確認は機械が行う
- Google 側の制約（FACT）: OAuth クライアントの作成とシークレットの発行はコンソールのみ（IAP OAuth Admin API は 2025-01-22 廃止）。同意（許可ボタン）は本人の操作そのものであり自動化してはならない。それ以外は API で扱える

## 選択肢
1. **受け取りページ ＋ 同意 workflow**: 自サイトの静的ページ（`reyz.inc/oauth/callback.html`。秘密なし）が同意リンクを組み立て、戻ってきた同意コードを表示する。人はコードを GitHub Actions の `oauth-consent` に 1 回貼る。workflow がコードを交換し、ID トークンで「同意した口座 = 送信専用ユーザー」を検証し、GitHub App の権限で Secret を更新、配備を起動して完了を待ち、運用記録の issue にコメントする（古いトークンの失効は行わない。追記 2026-10-01）
2. Cloudflare Tunnel で workflow 実行中だけ受け口を開き、コードの貼り付けも無くす（クリックだけで完了）。追加インフラ: Tunnel・DNS・トークン 1 個
3. 現状維持（OAuth Playground で手動。口座は人が確認）

## 決定
1。理由: 同意は初回と失効時にしか起きない（年に数回以下）ので、2 の追加インフラは頻度に見合わない。1 で「口座の誤り」「転記ミス」「秘密の目視」「古いトークンの放置」「記録の欠落」がすべて機械側に移る。人に残るのは「許可を押す」と「コードを 1 回貼る」だけで、どちらも秘密ではない（コードは 1 回限り・数分で失効・クライアント シークレットが無ければ無価値）。

## 帰結
- 新しい構成要素: `site/oauth/callback.html`（noindex、外部資源なし、秘密なし、サイト導線から未リンク）、`infra/oauth/consent.mjs`（交換・検証・失効。テスト付き）、`.github/workflows/oauth-consent.yml`
- 同意 URL は `login_hint=<送信専用ユーザー>` と `hd=<ドメイン>` で口座を固定し、`prompt=consent` `access_type=offline` でリフレッシュトークンを必ず得る。scope に `openid email` を加え、ID トークンの `email`（`email_verified=true`、`aud`、`iss` も確認）で同意した口座を機械検証する。不一致なら受け取ったトークンをその場で失効させ、保存しない
- GitHub App「REYZ Ops」（権限: Secrets 書き込み・Actions 書き込み・Issues 書き込み。この repo のみにインストール）を運用 workflow の主体にする。秘密鍵は GitHub Secret `OPS_APP_PRIVATE_KEY`、ID は変数 `OPS_APP_ID`。Actions の既定トークンは Secret を書けないため
- 記録: run の Summary（詳細）＋ issue「運用記録 — 認証情報」へのコメント（誰が・いつ・どの口座で・結果・run へのリンク。main はブランチ保護で直接 commit できないため、ファイルではなく issue を使う）。トークンの値はどこにも書かない
- クライアント ID（公開識別子）は受け取りページに埋め込む（GitHub Secret `GMAIL_OAUTH_CLIENT_ID` と同じ値。違えば交換が失敗して分かる）。クライアントを作り直したときはページも更新する
- Worker は Gmail API の 401 で 1 回だけアクセストークンを取り直す（ローテーション直後に古いトークンが失効しても送信を落とさない）
- 追記（2026-10-01）: **古いリフレッシュトークンは失効させない。** Google の失効は「口座 × クライアント」のグラント単位で、新しい同意の直後に古いトークンを失効させると新しいトークンも無効になる（初回実行で発生。[事故記録](../incidents/2026-10-01-oauth-consent-revoke.md)）。古いトークンは Secret と Worker secret の上書きでどこにも残らず、6 か月未使用で自然失効する。失効は「別の口座が同意した」ときだけ、その口座のグラントに対して行う。漏えい時は no-reply@ のグラントを失効（`consent.mjs revoke` または Google アカウントの「第三者アクセス」から削除）→ 再同意、の順
- 追記（2026-09-30 段階 0）: PKCE（S256）を採用。verifier は受け取りページのブラウザにだけあり、表示する文字列を `コード~verifier` にして 1 回の貼り付けで PKCE が成立する（RFC 9700 §2.1.1 の RECOMMENDED に適合。手順は不変）。旧形式（コードのみ）も交換側は受け付ける
- 残る手動（Owner 権限。いずれも Google に API が無いか、本人確認そのもの）: OAuth クライアントの作成／シークレットの再発行と GitHub Secret への登録、送信専用ユーザーの作成・初回ログイン・2 段階認証の登録、GitHub App の作成（1 回）、同意画面で「許可」、同意コードを 1 回貼る
- 型を別サイトへ複製するとき: ページの `CONFIG`（クライアント ID・送信専用ユーザー・workflow の URL）と変数 `MAIL_SENDER_USER` を差し替える

## 参照
- Google: OAuth 2.0 for Web Server Applications（`login_hint` / `hd` / `prompt` / `access_type`）、OpenID Connect（ID トークンの検証。token endpoint から TLS で直接受け取った場合は署名検証を省略できる: OpenID Connect Core 1.0 §3.1.3.7）、Manage OAuth Clients、Migrate from the IAP OAuth Admin API（2025-01-22 廃止）
- GitHub: `GITHUB_TOKEN` の権限一覧（Secrets は含まれない）、GitHub Apps の権限、`gh secret set`、`actions/create-github-app-token`
- `docs/contact-pipeline.md` v2.2、`docs/incidents/2026-09-30-oauth-consent-wrong-account.md`
