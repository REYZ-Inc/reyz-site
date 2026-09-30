#!/usr/bin/env bash
# 全検証を一括実行する。ローカルでも CI（GitHub Actions）でも同じ内容。
# 使い方: bash qa/run_all.sh            （site/ を検証。QA_OUT=出力先（既定 qa/out））
# 終了コード 0 = 全件 PASS。1件でも FAIL なら非 0 で止まる（Fail-Closed）。
set -euo pipefail
cd "$(dirname "$0")/.."
export QA_OUT="${QA_OUT:-qa/out}"; mkdir -p "$QA_OUT"
SITE="$(pwd)/site"

echo "== 1/7 build（再現性: 生成物がコミット済み site/ と一致すること）"
python3 build/build.py >/dev/null
if ! git diff --quiet -- site/ 2>/dev/null; then
  echo "FAIL: site/ がビルド結果と異なります（build.py を変えたら site/ を再生成してコミットしてください）"; git --no-pager diff --stat -- site/; exit 1
fi

echo "== 2/7 html-validate"
npx html-validate site/*.html

echo "== 3/7 W3C Nu checker（エラー 0・警告 0）"
VNU="$(node -e "console.log(String(require('vnu-jar')))")"   # vnu-jar 26 以降は String オブジェクト（+vnu プロパティ）を返すので文字列化する
java -jar "$VNU" --format json site/*.html 2>"$QA_OUT/nu.json" || true
node -e '
const fs = require("fs"); const raw = fs.readFileSync(process.argv[1], "utf8"); const i = raw.indexOf("{"); const r = JSON.parse(raw.slice(i));
console.log("Nu messages:", r.messages.length); for (const m of r.messages) console.log(m.type, m.url.split("/").pop(), m.lastLine, m.message);
if (r.messages.length) process.exit(1);' "$QA_OUT/nu.json"

echo "== 4/7 chapters / thread / copy sync / links（全ページ × 3 画面）"
node qa/v8_check.js "$SITE" "$QA_OUT/v8" >/dev/null
node -e '
const r = require(process.argv[1]); let bad = 0, n = 0;
for (const [pg, vps] of Object.entries(r.pages)) for (const [vp, d] of Object.entries(vps)) { n++;
  if (d.errors.length || d.console.length || d.failed.length || d.basics.scrollW > d.basics.innerW || d.basics.h1 !== 1 || d.basics.small.length || d.end.loopInSlot < 0.99) { bad++; console.log(pg, vp, JSON.stringify({ e: d.errors, c: d.console, f: d.failed, small: d.basics.small, loop: d.end.loopInSlot })); }
  for (const c of d.chapters) { if (c.word.startsWith("hold:")) { if (!(c.copyOpacity === null || c.copyOpacity >= 0.9)) { bad++; console.log(pg, vp, JSON.stringify(c)); } }
    else if (!c.word.startsWith("thread") && !(c.inStage >= 0.95 && c.textOverlap === 0 && c.inView >= 0.95 && (c.copyOpacity === null || c.copyOpacity >= 0.9))) { bad++; console.log(pg, vp, JSON.stringify(c)); } } }
const broken = Object.values(r.links).reduce((a, l) => a + l.broken.length, 0);
console.log("page×viewport:", n, "bad:", bad, "links broken:", broken); if (bad || broken) process.exit(1);' "$(pwd)/$QA_OUT/v8/report.json"

echo "== 5/7 start-at-top（直接 + 全リンク遷移）"
node qa/start_top_check.js site | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log("transitions:",r.transitions,"fails:",r.fails.length);if(r.fails.length){console.log(JSON.stringify(r.fails,null,1));process.exit(1)}})'

echo "== 6/7 acceptance（文言・メニュー・ブランド色・作品例）/ フォーム（入力→確認→送信）/ 行組み"
node qa/v13_check.js site | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log("acceptance fails:",r.fails.length);if(r.fails.length){console.log(r.fails);process.exit(1)}})'
node qa/form_check.js site fallback | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log("form(fallback) fails:",r.fails.length);if(r.fails.length){console.log(r.fails);process.exit(1)}})'
node qa/form_check.js site endpoint | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log("form(endpoint) fails:",r.fails.length);if(r.fails.length){console.log(r.fails);process.exit(1)}})'
node qa/lines_check.js | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log("lines fails:",r.fails.length);if(r.fails.length){console.log(r.fails);process.exit(1)}})'

echo "== 7/7 viewer 骨格下の文字色（claude.ai artifact 再現）"
python3 tools/artifact.py >/dev/null
cp qa/viewer_sim.html site/__viewer_sim.html
node qa/typo_check.js > "$QA_OUT/typo.json"; rm -f site/__viewer_sim.html
node -e 'const r = require(process.argv[1]); const n = Object.values(r).reduce((a, d) => a + d.darkTextElements.length, 0); console.log("dark text elements:", n); if (n) { console.log(JSON.stringify(r, null, 1)); process.exit(1); }' "$(pwd)/$QA_OUT/typo.json"

echo "== secret / 除外文言スキャン"
if grep -rEn "ghp_|github_pat_|sk-[A-Za-z0-9]{8}|AKIA[0-9A-Z]{12}|PRIVATE KEY" site build tools qa --include=*.html --include=*.js --include=*.css --include=*.py --include=*.sh | grep -v "qa/run_all.sh"; then echo "FAIL: secret らしき文字列"; exit 1; fi
if grep -rn "所属\|話してみる\|© 2026 REYZ\|人とAIの共生を前提に\|REYZの人とAIが共に" site/*.html; then echo "FAIL: 除外文言"; exit 1; fi
echo "ALL PASS"
