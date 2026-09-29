# 2026-09-29 問い合わせフォームが Turnstile の照合で全件失敗

- 影響: 2026-09-29 09:20 頃〜10:52（JST）。公開サイトの問い合わせフォームで送信不可（「ボット対策の確認ができませんでした」）。実際の問い合わせは 0 件（CEO のテストのみ）
- 検知: CEO の手動テスト（09:30）。自動検知の仕組みは当時なし
- 重大度: 中（対外機能の停止。データ損失なし）

## 時系列（JST）
| 時刻 | 事象 |
|---|---|
| 09:13 | PR #9 マージ（フォームを `/api/contact` に接続、Turnstile 有効化） |
| 09:29 | CEO テスト: 確認ページに Turnstile が表示されず、送信で照合失敗 |
| 09:36 | CEO 指示「送信者の環境に依存しない標準方式を実装せよ」 |
| 10:11 | PR #10（fail-open・多層防御・e2e）作成時のローカル再現で根本原因を特定 |
| 10:18 | PR #10 マージ。配備後の自動 e2e が旧 JS で `window.turnstile.render is not a function` を再現、新 JS で `turnstile.ready()` 例外を検出 |
| 10:40 | PR #11 マージ（`ready()` を使わない） |
| 10:52 | CEO テスト: 受付成功（ただし古いキャッシュの JS のため未検証経路。控えは contact@ に到達） |

## 根本原因
1. 確認ページの Turnstile 用要素の id が `turnstile` だった。ブラウザの「id 付き要素は `window.<id>` として見える」仕様により `window.turnstile` がその div を指し、本物の Turnstile API が読み込まれず／呼ばれず、トークンが作られなかった
2. 修正後、`turnstile.ready()` を async/defer 読み込みで呼び、Turnstile が例外を投げた（公式の制約）

いずれも「本物の Turnstile を読み込んだときだけ」起きる。単体テストは外部を呼ばない密閉型で、本物との結合は本番で初めて動いた。

## 是正
- id を `turnstileBox` に変更し、API の存在を `typeof window.turnstile.render === 'function'` で判定（PR #10）
- `ready()` を使わず onload 後に直接描画（PR #11）
- Turnstile を「読めたら使う」方式（fail-open）にし、読めない環境でも受付（PR #10、ADR-0005）

## 再発防止
- PR 関門 `stack-e2e`: CI 内でサイト ＋ Worker を起動し、本物の Turnstile を公式テストキーで最後まで操作（PR #14、ADR-0006）。今回の 2 件はこの関門で止まる
- 配備後の本番 e2e と日次監視・異常通知（PR #14）
- 設計書 `docs/contact-pipeline.md` と本記録

## 教訓
- 外部部品との結合は、提供元の公式テスト手段（テストキー）で PR 段階に検証する
- 障害のたびに 1 本ずつ PR を出す場当たりを止め、設計 → Full Cycle → 1 本の PR に統合する（同日の CEO 指示）
- id・グローバル名は外部スクリプトのグローバルと衝突しない命名にする
