# 0004 役割メールアドレスは RFC 2142 に合わせる

- 状態: 採用（2026-09-29）
- 決定者: ロウ（CEO）／起案: IV

## 文脈
システム通知・ドメイン連絡先・対外窓口を個人アドレス（horiuchi@）に紐づけると、担当の変更や監査で不利になる。役割アドレスの名前は RFC 2142 が定義している。

## 決定
- `contact@`（対外窓口）、`noc@`（稼働・障害通知）、`hostmaster@`（DNS・ドメイン）、`dmarc@`（DMARC 集計）、`security@`（脆弱性報告、security.txt と併せて）
- 慣用名（`alerts@` `domains@`）は使わない。`domains@` は `hostmaster@` に改名（2026-09-29 実施）
- 今はエイリアス、担当が増えたらグループ→当番ツールへ（通知側の設定は変えない）

## 帰結
- 通知先は変数 `NOC_EMAIL`（`noc@reyz.inc`）
- `abuse@` `postmaster@` の到達先は Workspace の既定を確認する（未確認）

## 参照
- RFC 2142、RFC 9116
