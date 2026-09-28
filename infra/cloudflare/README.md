# Cloudflare DNS（reyz.inc）— DNS as code

DNS の正本はこのフォルダの宣言ファイルです。Cloudflare の画面で手で変えず、宣言ファイルを PR で変えて workflow で反映します。

| パス | 役割 |
|---|---|
| `zones/reyz.inc.json` | reyz.inc に置くレコードの宣言（正本） |
| `cf_dns.py` | 宣言と Cloudflare の実状態の差分表示（plan）と反映（apply）。標準ライブラリのみ |
| `test_cf_dns.py` | ネットワーク不要の自己テスト（差分・冪等性・DNSSEC 手順）。workflow の先頭でも実行 |
| `../../.github/workflows/cloudflare-dns.yml` | 手動起動の workflow。plan → apply（apply は environment `cloudflare` の承認ルールで止められる） |

## 前提（GitHub 側に 1 回だけ設定）

| 場所 | 名前 | 中身 |
|---|---|---|
| Settings → Secrets and variables → Actions → **Secrets** | `CLOUDFLARE_API_TOKEN` | Cloudflare の API トークン。権限は **Zone › Zone › Edit** と **Zone › DNS › Edit**、対象は「このアカウントの全ゾーン」（ゾーン作成に必要）。値はここ以外に書かない |
| 同 → **Variables** | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare の Account ID（秘密ではないが、ログには mask する） |

DNSSEC の有効化（`PATCH /zones/{id}/dnssec`）に上記 2 権限で足りるかは未確認。403 になったら **Zone › Zone Settings › Edit** を追加する（確認タスク）。

## 使い方

Actions → **cloudflare-dns** → Run workflow

| 入力 | 意味 |
|---|---|
| `zone` | 対象ゾーン（既定 reyz.inc） |
| `mode` | `plan` = 差分表示のみ / `apply` = 反映。apply でも plan が先に走る |
| `dnssec` | `keep` = 触らない / `on` = 有効化して DS を表示（ネームサーバー切替の**後**に使う） |
| `prune` | 宣言にないレコードを削除（既定 false。通常は使わない） |

結果は run の Summary に出ます（ゾーン状態・Cloudflare のネームサーバー名・レコード差分・DNSSEC の DS）。

## reyz.inc 移行の手順（Squarespace のネームサーバーだけを Cloudflare に向ける）

| # | 作業 | 誰 |
|---|---|---|
| 1 | `apply`（dnssec=keep）を実行 → Summary の **nameservers** 2 つを控える | workflow |
| 2 | Squarespace → reyz.inc → DNS → **DNSSEC を OFF** → 1 時間以上待つ（レジストリの DS TTL 3600 秒） | ロウ |
| 3 | Squarespace → DNS → Domain Nameservers → **Use Custom Nameservers** → 手順 1 の 2 つを入力 | ロウ |
| 4 | 伝播確認：`dig NS reyz.inc`、`dig A reyz.inc`、https://reyz.inc と https://www.reyz.inc、GitHub Pages の DNS check が緑 | AI・ロウ |
| 5 | `apply`（dnssec=on）を実行 → Summary の **DS** を Squarespace → DNS → DNSSEC に登録 | workflow → ロウ |
| 6 | 以後の変更は `zones/reyz.inc.json` を PR → マージ → `plan` で確認 → `apply` | 全員 |

## 守ること

- A / AAAA / CNAME は **proxied=false（DNS only）** のまま。GitHub Pages の証明書更新経路を変えないため
- 宣言にないレコードは `apply` でも消さない（`prune` を付けたときだけ消す）
- トークンの値・Account ID をチャット・Markdown・コミットに書かない
