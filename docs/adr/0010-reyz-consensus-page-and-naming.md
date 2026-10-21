# 0010 REYZ CONSENSUS の公開ページを設け、サイト上の製品名を NAMING-001 に合わせる

- 状態: 提案（2026-10-22 CEO 指示「REYZ のホームページから REYZ CONSENSUS にアクセスできるようにする」。PR のマージで採用）
- 決定者: ロウ（CEO）／起案: IV

## 文脈
- REYZ CONSENSUS（旧 Cross-AI Flow）は REYZ PLATFORM の製品のひとつ。設計は Cross-AI Flow 台帳で採択済み、実装は未着手（製品は開発中）
- 製品命名は 2026-10-15 の CEO 決定 NAMING-001 で Z-PLATFORM→REYZ PLATFORM、Z-DEVELOPER→REYZ DEVELOPER、Cross-AI Flow→REYZ CONSENSUS に改名済み。公開サイトは旧名のままだった（`ai.html`、`index.html` 事業内容、`creative.html` AI導入、`contact.html` ご用件）
- サイトからの到達経路が無いと、製品名を出しても説明と相談先に辿り着けない
- 表示の規律（`legal.html`「表示に関する方針」）: 稼働・実績・顧客数を示す表現は根拠を併記できるまで書かない

## 選択肢
1. **公開ページ `/consensus` を新設し、`ai.html` の製品 03 からリンクする。sitemap に載せる。同時にサイト上の製品名を NAMING-001 に合わせる。ヘッダーのメニューは変えない**
2. 製品 03 の名前だけ改名し、ページは作らず問い合わせへ誘導する（到達はできるが説明が無い）
3. ヘッダーのメニューに Consensus を追加する（幅 821〜900px で 6 項目が収まるか未検証。メニュー構成は CEO 判断）

## 決定
1。メニュー追加（3）は別の判断とし、本 ADR では採らない。

## 帰結
- 公開ページは 9 本（`consensus.html`、公開 URL は `/consensus`）。章の語は `Consensus`（粒子で描画）
- ページの文言は「仕組み／進め方／提供の形」に限り、「現在開発中」「先行導入のご相談」と明記する。稼働・実績の表現は置かない
- 製品名の改名に伴い、QA の固定文言（`qa/v13_check.js` 事業内容、`qa/form_check.js` ご用件）も同時に更新する。問い合わせ Worker はご用件を自由文として扱うため影響しない
- 実機（REYZ CONSENSUS の UI）が公開されたら、このページに入口リンクを追加する（別 PR）
- QA のページ一覧（`qa/v8_check.js`、`qa/typo_check.js`）に新ページを加える。以後、ページ追加時は両方へ追記する

## 参照
- NAMING-001（2026-10-15 CEO 決定、命名正本 v1.0.4）
- `docs/STANDARDS.md`、`legal.html`「表示に関する方針」
- `build/build.py` の AI セクション注記（2026-10-03 名称決定、2026-10-15 改名）
