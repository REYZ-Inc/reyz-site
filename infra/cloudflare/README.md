# Cloudflare DNS（reyz.inc）— DNS as code

DNS の正本はこのフォルダの宣言ファイルです。Cloudflare の画面で手で変えず、宣言ファイルを PR で変えて workflow で反映します。

## 設計（2026-09-28 決定）

| 層 | 担当 |
|---|---|
| 原本・承認・自動検証・記録 | GitHub（repo・PR・Actions） |
| DNS・証明書・HTTPS 転送・防御 | **Cloudflare（proxied）**。訪問者に見せる証明書は Cloudflare が数分で発行する |
| ビルド済みファイルの配信元 | GitHub Pages（Cloudflare の裏側） |

Cloudflare→GitHub 間は `settings.ssl=full`（暗号化はするが、GitHub 側の証明書名の一致は求めない）。GitHub 側に reyz.inc の証明書が発行されたら `strict` に上げてよい。GitHub Pages の「Enforce HTTPS」は使わない（HTTPS 転送は Cloudflare の `always_use_https` が担う）。

| パス | 役割 |
|---|---|
| `zones/reyz.inc.json` | reyz.inc に置くレコードとゾーン設定の宣言（正本） |
| `cf_dns.py` | 宣言と Cloudflare の実状態の差分表示（plan）と反映（apply）。ゾーン作成・レコード・設定・DNSSEC・activation check。標準ライブラリのみ |
| `test_cf_dns.py` | ネットワーク不要の自己テスト。workflow の先頭でも実行 |
| `../check/site_check.sh` + `site-check.yml` | 外から見た DNS・証明書・HTTP の実測（読み取りのみ） |
| `../../.github/workflows/cloudflare-dns.yml` | 手動起動。plan → apply（apply は environment `cloudflare` の承認ルールで止められる） |

## 前提（GitHub 側に 1 回だけ設定）

| 場所 | 名前 | 中身 |
|---|---|---|
| Settings → Secrets and variables → Actions → **Secrets** | `CLOUDFLARE_API_TOKEN` | Cloudflare の API トークン。権限：**Zone › Zone › Edit**、**Zone › DNS › Edit**、**Zone › Zone Settings › Edit**。対象「このアカウントの全ゾーン」 |
| 同 → **Variables** | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare の Account ID |

## 使い方

Actions → **cloudflare-dns** → Run workflow

| 入力 | 意味 |
|---|---|
| `zone` | 対象ゾーン（既定 reyz.inc） |
| `mode` | `plan` = 差分表示のみ / `apply` = 反映。apply でも plan が先に走る |
| `dnssec` | `keep` = 触らない / `on` = 有効化して DS を表示（ネームサーバー切替の**後**に使う） |
| `prune` | 宣言にないレコードを削除（既定 false。通常は使わない） |

結果は run の Summary と annotation に出る（ゾーン状態・ネームサーバー・レコード差分・設定差分・DNSSEC の DS）。

## reyz.inc 切替手順（Squarespace のネームサーバーだけを Cloudflare に向ける）

| # | 作業 | 誰 |
|---|---|---|
| 1 | Squarespace → reyz.inc → DNS → **DNSSEC を OFF**。以後 1 時間以上待つ（レジストリの DS TTL 3600 秒） | ロウ |
| 2 | `apply`（dnssec=keep）→ レコード proxied・設定（ssl=full 等）が入る | workflow |
| 3 | site-check で DS が消えたことを確認 | AI |
| 4 | Squarespace → DNS → Domain Nameservers → **Use Custom Nameservers** → `cory.ns.cloudflare.com` / `dolly.ns.cloudflare.com` | ロウ |
| 5 | site-check で NS＝Cloudflare、証明書の SAN に reyz.inc、https 200 を確認（数分〜） | AI |
| 6 | `apply`（dnssec=on）→ Summary の **DS** を Squarespace → DNS → DNSSEC に登録 | workflow → ロウ |
| 7 | 以後の変更は `zones/reyz.inc.json` を PR → マージ → `plan` で確認 → `apply` | 全員 |

## 守ること

- 宣言にないレコードは `apply` でも消さない（`prune` を付けたときだけ消す）
- トークンの値をチャット・Markdown・コミットに書かない
- `settings.ssl` を `flexible` にしない（Cloudflare→GitHub 間が平文になる）
