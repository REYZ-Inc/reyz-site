# 問い合わせフォーム受付 Worker（reyz.inc/api/contact）

フォーム（`site/contact.html`）の「送信」を受け、① `contact@reyz.inc` へ控え、② 送信者へ受付確認メールを送る。Cloudflare Workers 上で動き、同じドメイン（`reyz.inc/api/*`）で応答するので CORS 不要。メールは Google Workspace（Gmail API）から `no-reply@reyz.inc` として送るため、SPF / DKIM / DMARC は既存の設定のまま整合する。

## 流れ

```
ブラウザ（contact.html）
  └─ POST /api/contact（JSON: name, person, email, type, message, website=honeypot, turnstile）
       └─ Worker: Origin 検査 → 入力検証 → Turnstile 照合（siteverify）
            → Google token（サービスアカウント JWT、ドメイン全体の委任で GMAIL_SENDER_USER になりすます）
            → Gmail API send ×2（控え → 確認メール）→ {ok:true, confirmation:true|false}
```

| 応答 | 意味 |
|---|---|
| 200 `{ok:true}` | 受付完了（`confirmation:false` は控えは届いたが確認メールだけ失敗） |
| 400 `validation` | 入力不備（`fields` に項目名） |
| 403 `origin` / `turnstile` | フォーム以外からの送信 / ボット対策の照合失敗 |
| 413 / 415 / 405 / 404 | 大きすぎる / JSON でない / POST 以外 / 別パス |
| 502 `send` | Google 側で失敗（委任未設定・鍵不正・API 無効など。Workers Logs に詳細） |
| 503 `not_configured` | secret / vars が足りない（配備直後の未設定など） |

honeypot（`website`）に値があるものは成功を装って捨てる。記録（Workers Logs）は結果・種別・国・Ray のみで、本文とメールアドレスは残さない。

## 配置

| パス | 役割 |
|---|---|
| `src/index.js` | Worker 本体（依存ライブラリなし。WebCrypto + fetch） |
| `test/contact.test.js` | 自己テスト（`node --test`。Google / Turnstile は fetch 差し替え、鍵はテスト内で生成） |
| `wrangler.toml` | 名前 `reyz-contact`、ルート `reyz.inc/api/*` `www.reyz.inc/api/*`、`workers_dev=false`、公開値の vars |
| `../../.github/workflows/contact-worker.yml` | PR: テスト + dry-run。main へのマージ: secret 投入 → deploy → 疎通（GET が 405）。environment `cloudflare` |
| `../../site/assets/site.js` | `CONFIG.formEndpoint='/api/contact'`、`CONFIG.turnstileSiteKey` で有効化（確認ページに Turnstile を描画） |

## 前提（1 回だけ。値はリポジトリに書かない）

| 場所 | 名前 | 中身 | 出所 |
|---|---|---|---|
| GitHub → Secrets | `GMAIL_SA_KEY` | サービスアカウントの JSON 鍵の全文 | GCP プロジェクト `reyz-site` → IAM → サービス アカウント `contact-mailer` → キー |
| GitHub → Secrets | `GMAIL_SENDER_USER` | なりすまし先の Workspace ユーザー（`no-reply@reyz.inc` を送信エイリアスに持つ実ユーザーのアドレス） | Google Workspace 管理コンソール |
| GitHub → Secrets | `TURNSTILE_SECRET_KEY` | Turnstile ウィジェットの Secret Key | Cloudflare → Turnstile → ウィジェット（hostname: reyz.inc, www.reyz.inc） |
| GitHub → Secrets | `CLOUDFLARE_WORKERS_TOKEN` | Workers 配備用トークン（テンプレート「Cloudflare Workers を編集する」、Zone を reyz.inc に限定） | Cloudflare → プロフィール → API トークン |
| GitHub → Variables | `CLOUDFLARE_ACCOUNT_ID` | （DNS と共通。設定済み） | — |
| `site/assets/site.js` | `turnstileSiteKey` | Turnstile の Site Key（公開値） | 同上ウィジェット |

Google 側（管理コンソール）:

1. Gmail API を有効化（プロジェクト `reyz-site`。済）
2. 管理コンソール → セキュリティ → アクセスとデータ管理 → API の制御 → **ドメイン全体の委任** → 新しく追加 → クライアント ID = サービスアカウントの「一意の ID」、スコープ `https://www.googleapis.com/auth/gmail.send`
3. `GMAIL_SENDER_USER` のユーザーにエイリアス `no-reply@reyz.inc` を追加し、そのユーザーの Gmail → 設定 → アカウント → 「他のメールアドレスを追加」で `REYZ Inc. <no-reply@reyz.inc>` を送信元に登録（同一ドメインのエイリアスは確認なしで追加できる）。未登録だと From はそのユーザーの本アドレスに書き換えられる（送信自体は成功する）

## 切替手順

1. 上記の secret / token をすべて登録
2. この Worker を含む PR をマージ → `contact-worker` が配備 → run の annotation に `GET https://reyz.inc/api/contact -> HTTP 405`
3. `site/assets/site.js` の `formEndpoint: '/api/contact'` と `turnstileSiteKey` を設定する PR をマージ（サイト側の切替。Worker が先）
4. 実送信テスト: フォームから 1 件送り、`contact@reyz.inc` の控え（Reply-To が送信者）と送信者側の確認メール（From `no-reply@reyz.inc`、DKIM/SPF/DMARC PASS）を確認

## 守ること

- JSON 鍵・Secret Key・トークンをチャット・Markdown・コミットに書かない。鍵の JSON はダウンロード後に Secret へ入れて手元から削除
- Worker は `workers_dev=false`（`*.workers.dev` では公開しない）。ルートは `reyz.inc/api/*` のみ
- 送信上限は Workspace の枠（有料 2,000 通/日/ユーザー）。フォームの想定量では問題にならないが、迷惑送信の疑いが出たら Turnstile の設定と Workers Logs を見る
