# 決定記録（ADR）

形式は MADR（文脈 / 選択肢 / 決定 / 帰結 / 参照）。1 決定 1 ファイル、番号は増えるのみ。決定を覆すときは新しい ADR を書き、古い ADR の状態を「置き換え済み（→ NNNN）」にする。

| 番号 | 決定 | 状態 |
|---|---|---|
| [0001](0001-cloudflare-front-github-pages-origin.md) | 公開サイトの出口を Cloudflare に置き、GitHub Pages を配信元にする | 採用 |
| [0002](0002-core-domains-independent-registrar.md) | 中核ドメインは独立レジストラに置き、DNS は宣言（コード）で管理する | 採用 |
| [0003](0003-provisioning-layer-principle.md) | 宣言は自社、事業者は差し替え可能な adapter（プロビジョニング層の原則） | 採用 |
| [0004](0004-role-addresses-rfc2142.md) | 役割メールアドレスは RFC 2142 に合わせる | 採用 |
| [0005](0005-contact-form-fail-open-turnstile.md) | 問い合わせフォームのボット対策は fail-open（未検証受付・確認メールなし）とする | 採用 |
| [0006](0006-ci-full-stack-gate-no-staging.md) | 配備前検証は CI 内フルスタック（公式テストキー）で行い、staging を常設しない | 採用 |
| [0007](0007-system-sender-identity-oauth.md) | システムメールの送信主体を `no-reply@` 実ユーザーにし、ドメイン全体の委任を OAuth 同意に置き換える | 実施済み（2026-09-30） |
| [0008](0008-oauth-consent-automation.md) | 送信専用ユーザーの OAuth 同意を自動化し、人の操作を「許可」と「コードを 1 回貼る」だけにする | 採用（初回実行で確定） |
