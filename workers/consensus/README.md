# REYZ CONSENSUS 入口 Worker（reyz.inc/api/consensus/*）

設計の正本は [docs/consensus-entry.md](../../docs/consensus-entry.md)（目的・要件・契約・関門・未検証・秘密・段階）。ここは実装と手順。

Home 章 3「あなたの地図」の地図カードにある「この地図を、あなたの言葉で。」（`site/assets/site.js` の TALK）から呼ばれる。同じドメインで応答するので CORS 不要。依存ライブラリなし。

## 流れ

```
GET  /api/consensus/health → { ok:true, ready }   ready = ANTHROPIC_API_KEY がある。false ならサイトは入口を出さない
POST /api/consensus/turn   { who, map:{goal,place,step}, messages:[…], chain, dry_run? }
  → Origin 検査 → 形の検証 → レート制限（同一 IP 60 秒に 20 回）→ 往復上限（MAX_TURNS）→ dry_run ならここで返す
  → モデル API（system = 事実の範囲 + 現在の地図 + 禁止 + 出力の形。messages = 全文）
  → 応答検査（JSON / reply 220 文字以内 / map 各 90 文字以内 / 禁止語 / 約束・金額・期日の表現）。違反は理由を添えて 1 回だけ再生成。再違反は 502 policy
  → chain = sha256(前 | sha256(入力) | sha256(出力)) → 記録 → { ok:true, reply, map, consult, chain, turn }
```

記録（Workers Logs）は `event / ok / who / turn / map_changed / consult / chain / model / tokens_in / tokens_out / country / ray / ms`。会話の本文は残さない。

## 設定

| 置き場 | 項目 | 意味 |
|---|---|---|
| `wrangler.toml` `[vars]` | `ALLOWED_ORIGINS` | 入口を置くページの origin |
| | `MODEL` | モデル ID（初期値 `claude-haiku-5-5`） |
| | `MAX_TURNS` / `MAX_OUTPUT_TOKENS` | 1 会話の利用者の発話数の上限 / 1 応答の出力トークン上限 |
| `[[ratelimits]]` | `CONSENSUS_RL` | 同一 IP 60 秒に 20 回 |
| Worker secret | `ANTHROPIC_API_KEY` | 正本は GitHub Secrets。`.github/workflows/consensus-worker.yml` が配備のたびに同期（Worker にだけある secret は削除） |

## 手順

- ローカル: `node --test`（自己テスト）／`npx wrangler@4.142.0 deploy --dry-run --outdir /tmp/wr-out`（設定と束ねの検査）／`printf 'ANTHROPIC_API_KEY=…\n' > .dev.vars && npx wrangler@4.142.0 dev --port 8788`（`.dev.vars` は git 対象外）
- 配備: main へのマージで自動（`consensus-worker` workflow の `deploy`、environment `cloudflare`）。配備後に `https://reyz.inc/api/consensus/health` が 200 で、`ready` を通知に出す
- 鍵の更新: GitHub Secrets の `ANTHROPIC_API_KEY` を更新 → workflow を手動起動（Run workflow）。人が値を Worker に貼る工程はない
- 止めたいとき: GitHub Secrets の `ANTHROPIC_API_KEY` を空にして配備 → `ready:false` → 入口は出なくなる（サイトの再配備は不要）
