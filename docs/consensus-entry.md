# REYZ CONSENSUS の入口（地図を、あなたの言葉で）— 設計書（正本）

reyz.inc の Home 章 3「あなたの地図」でできた地図を、利用者が AI と言葉で深める入口。REYZ CONSENSUS（REYZ PLATFORM の製品）の正面入口の第 1 実装であり、裏側（応答するモデル・基盤）を差し替えても入口の形（契約）は変えない。
決定記録: [ADR-0011](adr/0011-consensus-entry-on-home-map.md)。実装と手順: [workers/consensus/README.md](../workers/consensus/README.md)。

## 1. 目的

- 利用者が、選択だけでできた地図（正本の固定文）を、自分の言葉で具体にできる（DEC-20261023-03「属性と目的目標を正確に汲み取る」の最初の体験）
- その地図が、そのまま「3 つの画面」と「相談」へ引き継がれる（DEC-20261027-04「押す・選ぶ・引き継ぐ」。面を増やさない）
- REYZ CONSENSUS の「メインの入口は REYZ 側で作り、文脈は REYZ 側で保持する」設計（2026-10-22 CEO 決定）の入口を、サイトの中に置く

## 2. 要件

| # | 要件 | 根拠 |
|---|---|---|
| R1 | 入口 Worker が応答できないとき、サイトは従来どおり（入口が出ない）。何も壊れない | Fail-Closed（STANDARDS §3）。配備直後・秘密未設定・障害時 |
| R2 | AI は地図の 3 つの点を整えて返すだけ。約束・金額・期日・成果・実績・顧客数を言わない。決めるのは本人 | Zero-AI-in-Control-Plane。`legal`「表示に関する方針」 |
| R3 | 本文に状態語・除外語（開発中・準備中・先行導入・順次・予定・一枚・所属・話してみる・ご担当者様）を出さない。AI の応答にも出さない | DEC-20260926-05、DEC-20261023-01、qa/run_all.sh のスキャンと同じ語 |
| R4 | AI に渡す事実は、決定済みの事業構造の言葉だけ（3 本柱、3 つの画面、クリエイターの 4 点、企業の確認）。数値・実績は渡さない | DEC-20260927-01、DEC-20261027-11・12、両正本 §3-1 |
| R5 | 会話の本文を Worker の記録に残さない。往復ごとに入力・出力の SHA-256 を前の値につないだ連鎖（chain）を返し、同じ値を Workers Logs に残す | STANDARDS §1「稼働の記録: PII なし」。記録の改変検出の種 |
| R6 | 秘密（モデル API の鍵）はブラウザ・リポジトリ・チャットに出さない。正本は GitHub Secrets、配備のたびに Worker secret へ同期 | STANDARDS §2「秘密の扱い」 |
| R7 | 同一 IP のレート制限、1 会話の往復上限、入力長の上限 | 濫用と費用の上限 |
| R8 | 入口の形（URL・要求・応答）は、裏側を REYZ CONSENSUS 実機に差し替えても変えない | ADR-0003 プロビジョニング層の原則（宣言は自社、事業者は adapter） |

## 3. 構成

```
reyz.inc（GitHub Pages、静的）                           Cloudflare Worker「reyz-consensus」           モデル API（adapter）
Home 章 3 の地図カード                                    reyz.inc/api/consensus/*
  └ #mapTalk（site.js TALK）                               GET  /health → { ok, ready }                  ready = 鍵がある
      1. 地図ができたら GET /health。ready=true のときだけ表示   POST /turn   → 検証 → origin → レート制限 → 往復上限
      2. 送る: POST /turn { who, map, messages, chain }           → system prompt（事実の範囲＋現在の地図＋禁止）→ 生成
      3. 返事を並べ、map が返れば地図を引き直す                    → 応答検査（JSON の形・長さ・禁止語・断定）違反は 1 回再生成、再違反は返さない
      4. consult=true なら「この内容で相談する」を示す              → chain 計算 → 記録（本文なし）→ { ok, reply, map, consult, chain, turn }
      5. 相談へ: 地図（AI の言葉）＋やりとりを sessionStorage で引き継ぐ（送るのは本人）
```

- ルート: `reyz.inc/api/*` は問い合わせ Worker（`reyz-contact`）が持つ。Cloudflare は「より具体的なルートが勝つ」（[Workers Routes: Matching behavior](https://developers.cloudflare.com/workers/configuration/routing/routes/)）ため、`reyz.inc/api/consensus*` は本 Worker が受ける
- 本文の保持: 本文はブラウザの画面の中だけに持ち、往復ごとに全文を送る（Worker は無状態）。REYZ CONSENSUS の「文脈は REYZ 側で保持」は段階 2 で実機側に移す（§8）
- モデル: `MODEL`（wrangler.toml の vars）で指定。初期値は platform.claude.com の models overview（2026-10-31 確認）にある `claude-haiku-5-5`。API 版は `anthropic-version: 2026-10-21`（同日確認）

## 4. 入口の契約（変えない形）

要求 `POST /api/consensus/turn`（JSON）

| 項目 | 形 | 制約 |
|---|---|---|
| `who` | `"creator"` / `"company"` | 必須 |
| `map` | `{ goal, place, step }` | 各 300 文字以内。現在の地図（AI が変えた後はその文） |
| `messages` | `[{ role: "user"\|"assistant", content }]` | user から始まり交互、最後は user。21 件以内、各 1000 文字以内、全文 12000 文字以内 |
| `chain` | `""` または 64 桁の 16 進 | 前の往復で返された chain |
| `dry_run` | `true` | 検証までで返す（モデルを呼ばない。CI の通し確認用） |

応答

| 応答 | 意味 | サイト側の挙動 |
|---|---|---|
| 200 `{ ok:true, reply, map, consult, chain, turn }` | `map` は 3 つの点が具体になったときだけ（それ以外は null）。`consult` は「相談へ進める段階」という AI の提案 | 返事を並べる。map があれば地図を引き直す。consult なら相談の押し先を示す |
| 400 `validation` / 403 `origin` / 405 / 413 / 415 / 404 | 形の不備・サイト以外からの要求 | 発話を戻し、注記 |
| 409 `turn_limit`（`consult:true`） | 往復の上限（`MAX_TURNS`） | 入力を閉じ、「ここからは、相談で。」 |
| 429 `rate_limited` | 送りすぎ（`Retry-After: 60`） | 「少し待ってから、もう一度。」 |
| 502 `model` / `policy` | モデル側の失敗 / 応答が検査を 2 回通らなかった | 発話を戻し、「返事が届きませんでした」。相談へはそのまま進める |
| 503 `not_configured` | 鍵が無い | （health が ready=false のため、入口は出ていない） |

chain の式: `chain_n = SHA-256( chain_{n-1} | SHA-256(入力) | SHA-256(出力 JSON) )`。初回の `chain_0` は 64 個の `0`。

## 5. 関門（何が通らなければ main に入らないか）

| 関門 | 内容 | どこで |
|---|---|---|
| `consensus-tests` | Worker の自己テスト（形・origin・レート制限・往復上限・禁止語の再生成と Fail-Closed・chain・モデル失敗）＋ wrangler dry-run | `.github/workflows/consensus-worker.yml`（PR） |
| `consensus-stack` | CI 内で Worker を起動し、health / dry_run / 他 origin 拒否 / 往復上限 を実機で確認（モデルは呼ばない） | 同上（PR） |
| `site-verify` → `qa/talk_check.js` | 入口なし: 出ない。入口（模擬）あり: 表示 → 送る → 返事 → 地図の引き直し → chain → 相談へ引き継ぎ → 選択変更で捨てる → 上限で閉じる → 失敗で戻れる。2 画面幅 | `qa/run_all.sh` 6/7（PR） |
| 状態語・除外語スキャン | 本文・JS の文面 | `qa/run_all.sh`（PR） |

## 6. 未検証の方針（事実として書かないもの）

| 項目 | 状態 | 確定させる方法 |
|---|---|---|
| 実モデルでの応答の質（正本の言葉の範囲に留まるか、禁止語の再生成が何割で起きるか） | 未検証（モデルを呼ぶ関門は置かない: 費用と再現性） | 配備後、Workers Logs の `policy` / `model` の比率を `consensus-watch`（段階 2）で日次集計 |
| `Authorization: Bearer` と `anthropic-version: 2026-10-21` の組での実応答 | 未検証（docs の例に従った。ダミー鍵で 401 → 502 `model` は確認） | 配備後の最初の実往復（ロウが Home で 1 回試す）。失敗は `model` として記録される |
| ブランチ保護の必須チェックに `consensus-tests` / `consensus-stack` を加える | 未（ruleset はロウ） | Settings → Rules → main の必須チェックに追加 |

## 7. 秘密・権限

| 秘密 | 置き場 | 用途 |
|---|---|---|
| `ANTHROPIC_API_KEY` | GitHub Secrets（正本）→ workflow が Worker secret へ同期 | モデル API。ブラウザには渡らない。未設定なら health が ready=false（入口は出ない） |
| `CLOUDFLARE_WORKERS_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | 既存（問い合わせ Worker と同じ） | 配備・secret 同期 |

ロウが行うこと: GitHub Secrets に `ANTHROPIC_API_KEY` を 1 回置く（Console で発行した鍵。利用上限を Console 側で設定する）。それ以外は PR のマージで機械が行う。

## 8. 段階

| 段階 | 内容 | 状態 |
|---|---|---|
| 1 | 本設計（入口契約固定、単一モデル adapter、本文なしの連鎖記録、Fail-Closed） | 本 PR |
| 2 | `consensus-watch`（日次集計・異常通知）、記録の日次書き出し（STANDARDS §2「証跡の保全」の GAP と同じ是正） | 設計書に追記のうえ別 PR |
| 3 | 裏側を REYZ CONSENSUS 実機（複数の AI が確かめ、人が決め、記録）に差し替え。文脈の保持を REYZ 側へ。契約は不変 | 実機（Cross-AI Flow 台帳 SL_511 の保留項目）の完了後 |
| 4 | 同じ入口に LINE 等の利用者のチャットを接続（文脈 ID 共有） | 2026-10-22 決定の範囲。記録が自動で残る形ができてから（DEC-20261027-18） |

## 9. 参照標準

- OWASP ASVS / API Security（入力検証・レート制限・origin 検査・秘密の分離）
- OWASP LLM Top 10（Prompt Injection → 出力の機械検査と行為の不在、Excessive Agency → AI は提案のみ、Sensitive Information Disclosure → 本文を記録しない）
- STANDARDS §2「秘密の扱い」「配備前検証」「証跡の保全」
- Cloudflare Workers Routes（ルートの具体性）、Workers Rate Limiting binding

## 10. 意図的に含めないもの

- ストリーミング（逐次表示）。応答は 1〜3 文の短文で、形（JSON）の検査を通してから出すため
- 会話本文のサーバ保存（段階 3 で REYZ CONSENSUS 実機側に持つ）
- 右下に常駐するチャット窓（面を増やす。DEC-20261027-04）
- 「話してみる」等の CTA 文言（DEC-20260926-05）

## 変更履歴

- 2026-10-31 初版（段階 1）
