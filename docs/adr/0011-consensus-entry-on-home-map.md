# 0011 REYZ CONSENSUS の入口を Home の「あなたの地図」の続きに置き、入口の契約を先に固定する

- 状態: 提案（2026-10-31 CEO「構築する」。PR のマージで採用）
- 決定者: ロウ（CEO）／起案: IV

## 文脈
- CEO の問い「ホームに AI チャットができる UI を入れる方法」に対し、事業構造を考慮した最適解として「問い合わせボットではなく、REYZ CONSENSUS の正面入口（データプレーン）そのものを置く」を提示し、CEO が「構築する」と指示（2026-10-31）
- REYZ CONSENSUS は「メインの入口は REYZ 側で作り、LINE 等からも同じ入口に入る。文脈は REYZ 側で保持する」と決定済み（2026-10-22）。実機は未構築（Cross-AI Flow 台帳 SL_511 の保留項目）
- サイトは「面を広げず、押す・選ぶ・引き継ぐの深さで伝える」（DEC-20261027-04）。Home 章 3 には選択式の「あなたの地図」があり、3 つの画面・相談へ引き継がれる（DEC-20261027-16）
- 「話してみる」CTA は置かない（DEC-20260926-05）。状態語は書かない（DEC-20261023-01）

## 選択肢
1. **Home の地図カードの中に「この地図を、あなたの言葉で。」を置く。入口 Worker（`/api/consensus`）が応答できるときだけ表示。入口の契約（URL・要求・応答）を最終形で固定し、裏側は単一モデル → REYZ CONSENSUS 実機へ差し替える**
2. 全ページ右下に常駐するチャット窓（面が増える。地図との連動が切れる）
3. 外部チャット SaaS の埋め込みスクリプト（デザイン・記録・秘密が REYZ の統制外。SSOT 統制の理由で STUDIO を却下した前例と同じ）
4. REYZ CONSENSUS 実機の完成まで入口を置かない（サイトが製品の実演にならない）

## 決定
1。本 ADR では「置き場」「Fail-Closed」「契約先行固定」「本文を記録しない連鎖記録」を決める。実モデルでの応答の質は未検証として扱い（設計書 §6）、配備後の記録で測る。

## 帰結
- `workers/consensus/`（Worker）、`.github/workflows/consensus-worker.yml`（関門と配備）、Home の地図カード内 `#mapTalk`（`build/build.py`・`site/assets/site.js` TALK・`site.css`）、`qa/talk_check.js`（模擬 Worker での通し検査）を追加
- ルートは `reyz.inc/api/consensus*`（問い合わせ Worker の `reyz.inc/api/*` より具体的なため本 Worker が受ける）
- 秘密は `ANTHROPIC_API_KEY` の 1 つ。GitHub Secrets が正本。未設定でも本番は壊れない（入口が出ないだけ）
- 問い合わせへの引き継ぎ本文に「【地図について、やりとりした内容】」が加わる（AI の言葉で引き直された地図＋やりとり）。問い合わせ Worker は本文を自由文として扱うため影響しない
- 決定台帳（`docs/decisions/`）への行追加は、CEO の Yes 後に新しい版で行う（DEC-20261027-09 の規則。本 PR では行わない）

## 参照
- `docs/consensus-entry.md`（設計書）、`docs/STANDARDS.md`
- ADR-0003（プロビジョニング層）、ADR-0010（/consensus ページ）
- DEC-20261027-04・16・18、DEC-20260926-05、DEC-20261023-01、2026-10-22 REYZ CONSENSUS 入口の決定
