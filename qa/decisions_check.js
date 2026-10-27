// 決定台帳の写し（docs/decisions/）とサイトの QA の接続（DEC-20261027-09）。
// 1) 写しの SHA-256 が docs/decisions/README.md の表の値と一致する（写しの手編集・改ざんを検出）
// 2) 「決定」かつ領域がサイト系の行は、検証の経路（成果物欄の QA ファイル／qa/*.js・run_all.sh のコメントの DEC-ID／下の MANUAL 表）を必ず持つ。
//    無い行があれば落ちる：決定を 1 行足したら、検査を 1 つ足す（機械で測れないものは MANUAL に理由を書く）。
// 出力: JSON { fails, rows, linked, manual }
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'docs', 'decisions');
const fails = [];
const F = (name, ok) => { if (!ok) fails.push(name); };

// 機械で測れない決定：配備後の目視・模擬ユーザー検査で確かめる。理由を 1 行で
const MANUAL = {
  'DEC-20260926-01': '複数ページ構成そのもの（ページ数は v8_check の PAGES が固定）',
  'DEC-20260926-02': 'デザイン要件（黒・ぼかし・ミニマル・ポップ感不可）は目視',
  'DEC-20260926-06': '会社情報の値は build.py の PROFILE・legal に直書き。値の照合は目視（typo_check は色だけ）',
  'DEC-20260928-01': '運用（main merge で配備、AI 単独で本番を変えない）は .github/workflows/deploy.yml と branch protection が守る',
  'DEC-20261003-01': '拡張子なし URL は build.py clean_links。v8_check の links broken 0 で間接に確認',
  'DEC-20261022-01': '/consensus の存在は v8_check の PAGES に含まれることで確認',
  'DEC-20261023-02': '読者が開発者でない前提の文（専門用語なし）は目視',
  'DEC-20261023-03': '「任せたい」と確信させる設計は模擬ユーザー検査（IV_RECORD_015・016）',
  'DEC-20261023-04': '3 拠点の住所は build.py の ADDR_* に直書き。目視',
  'DEC-20261024-01': '実現した状態で書く方針。状態語スキャン（DEC-20261023-01）が間接に守る',
  'DEC-20261026-01': '表現で解決・字だらけ NG は目視と文字量の計測（IV_RECORD_019〜023）',
  'DEC-20261027-02': '初画面の文は正本に基づく。目視（正本 §0 と照合）',
  'DEC-20261027-03': '初画面の同じ形・同じ分量は目視（3 行、各 1 事業）',
  'DEC-20261027-05': '重複なしは文言の全件抽出で確認（IV_RECORD_022）',
  'DEC-20261027-06': '入れる必要のないものは入れない：目視',
  'DEC-20261027-07': '事業構造が伝わる構成：模擬ユーザー再検査（配備後）',
  'DEC-20261027-08': '反映の決定そのもの（PR #47 merge、6017a64）',
  'DEC-20261027-09': '本検査（decisions_check.js）そのもの',
  'DEC-20261027-10': '初画面 3 行の文言：目視',
  'DEC-20261027-11': 'Home の図の順：目視',
  'DEC-20261027-12': '入口 6 行の語：目視（禁止語は run_all.sh のスキャン）',
  'DEC-20261027-13': '提供の束 4 つ：目視',
  'DEC-20261027-14': '会社情報を常時表示：目視',
  'DEC-20261027-15': '困りごと・はじめ方・TikTok を常時表示：v13_check の creator copy が固定文を守る。たたんでいないことは目視',
  'DEC-20261027-20': '保留（事実待ち）' };

const readme = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8');
const copies = [...readme.matchAll(/\|\s*`([^`]+\.md)`\s*\|[^|]*\|\s*(\d+)\s*\|\s*`([0-9a-f]{64})`\s*\|/g)];
F('README lists at least one copy', copies.length > 0);
let rows = [], latest = null;
for (const [, name, bytes, sha] of copies) {
  const file = path.join(DIR, name);
  if (!fs.existsSync(file)) { fails.push(`copy missing: ${name}`); continue; }
  const buf = fs.readFileSync(file);
  F(`${name}: bytes ${bytes}`, String(buf.length) === bytes);
  F(`${name}: SHA-256 matches README`, crypto.createHash('sha256').update(buf).digest('hex') === sha);
  if (!latest || name > latest.name) latest = { name, text: buf.toString('utf8') };
}
if (latest) {
  for (const line of latest.text.split('\n')) {
    if (!line.startsWith('| DEC-')) continue;
    const c = line.split('|').map(x => x.trim());
    if (c.length !== 10) { fails.push(`row with ${c.length - 2} columns: ${c[1]}`); continue; }
    rows.push({ id: c[1], area: c[3], artifact: c[7], status: c[8] });
  }
  F('rows parsed', rows.length > 0);
  const ids = rows.map(r => r.id); F('ids unique', new Set(ids).size === ids.length);
  // 検証の経路
  const qaFiles = fs.readdirSync(path.join(ROOT, 'qa')).filter(f => /\.(js|sh)$/.test(f) && f !== 'decisions_check.js');   // 本ファイルの MANUAL 表は「コメントの経路」に数えない
  const qaText = qaFiles.map(f => fs.readFileSync(path.join(ROOT, 'qa', f), 'utf8')).join('\n');
  const siteAreas = new Set(['サイト', 'サイト運用', '会社情報']);
  let linked = 0, manual = 0;
  for (const r of rows) {
    if (r.status !== '決定' || !siteAreas.has(r.area)) continue;
    const m = r.artifact.match(/QA qa\/([A-Za-z0-9_.-]+)/);
    const byArtifact = !!(m && fs.existsSync(path.join(ROOT, 'qa', m[1])));
    const byComment = qaText.includes(r.id);
    const byManual = Object.prototype.hasOwnProperty.call(MANUAL, r.id);
    if (byArtifact || byComment) linked++; else if (byManual) manual++;
    F(`${r.id}: has a verification path (QA file / DEC-ID comment / MANUAL)`, byArtifact || byComment || byManual);
    if (m && !byArtifact) fails.push(`${r.id}: 成果物欄の QA ファイル qa/${m[1]} が存在しない`);
  }
  for (const id of Object.keys(MANUAL)) F(`MANUAL ${id} exists in the ledger`, ids.includes(id));
  console.log(JSON.stringify({ fails, rows: rows.length, linked, manual, copy: latest.name }));
} else {
  console.log(JSON.stringify({ fails, rows: 0, linked: 0, manual: 0 }));
}
