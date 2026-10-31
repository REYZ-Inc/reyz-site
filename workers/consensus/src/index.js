/* REYZ Inc. — REYZ CONSENSUS 入口 Worker（https://reyz.inc/api/consensus/*）
   Home 章 3「あなたの地図」でできた地図を、利用者が AI と言葉で深める入口。設計: docs/consensus-entry.md

   契約（入口の形。裏側のモデル・基盤を差し替えても変えない）:
     GET  /api/consensus/health  → { ok, ready }          ready=false のとき、サイト側は入口を出さない（Fail-Closed）
     POST /api/consensus/turn    → { ok, reply, map, consult, chain, turn }
         body: { who: 'creator'|'company', map: { goal, place, step }, messages: [{ role, content }...], chain: '' | sha256hex }

   統制（Zero-AI-in-Control-Plane）:
     - AI は地図の言葉を整え、問いを返すだけ。約束・金額・期日・成果の断定はしない（system prompt で禁じ、応答を機械で検査。違反は 1 回だけ再生成、再び違反なら応答を返さない）
     - 決めるのは人。「相談」へは利用者自身が進む（consult=true は、相談へ進める段階だという AI の提案に過ぎない）
   記録: 会話の本文は記録しない。往復ごとに 入力と出力の SHA-256 を前の値につないだ連鎖（chain）を返し、Workers Logs にも同じ値を残す。
   依存ライブラリなし（fetch のみ）。秘密は Worker の secret（ANTHROPIC_API_KEY）。正本は GitHub Secrets（.github/workflows/consensus-worker.yml が配備のたびに同期）。 */

const BASE = '/api/consensus';
const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2026-10-21';   // platform.claude.com/docs/en/api/versioning（2026-10-31 確認）
const LIMITS = { body: 48 * 1024, messages: 21, content: 1000, total: 12000, mapLine: 300, replyChars: 220, mapOut: 90, timeoutMs: 25_000 };
// サイトの除外語・状態語（qa/run_all.sh のスキャンと同じ）。AI の応答にも載せない
const BANNED = ['開発中', '準備中', '先行導入', '順次', '予定', '一枚', '所属', '話してみる', 'ご担当者様', '©'];
// 断定を禁じる語（約束・金額・期日・成果）。含まれたら再生成
const PROMISE = /(保証|必ず|絶対|確実に|[0-9０-９,，]+\s*(円|万円)|契約|請求|着手金|納期|[0-9０-９]+\s*(日|週|か月|ヶ月|カ月)以内)/;   // 「費用ゼロ」「100%還元」は決定済みの固定文なので対象外

export default {
  async fetch(request, env) {
    return handle(request, env, { fetch: (...a) => fetch(...a), now: () => Date.now() });
  }
};

/* ---------- 受付 ---------- */

export async function handle(request, env, deps) {
  const started = deps.now();
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  if (path === BASE + '/health') {
    if (request.method !== 'GET') return json({ ok: false, error: 'method' }, 405, { Allow: 'GET' });
    return json({ ok: true, ready: ready(env) });
  }
  if (path !== BASE + '/turn') return json({ ok: false, error: 'not_found' }, 404);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: baseHeaders({ Allow: 'POST, OPTIONS' }) });
  if (request.method !== 'POST') return json({ ok: false, error: 'method' }, 405, { Allow: 'POST, OPTIONS' });

  const origins = allowedOrigins(env);
  const origin = request.headers.get('Origin') || '';
  if (!origins.includes(origin)) return json({ ok: false, error: 'origin' }, 403);
  if (!ready(env)) { log({ event: 'consensus', ok: false, error: 'not_configured' }); return json({ ok: false, error: 'not_configured' }, 503); }

  const ct = (request.headers.get('Content-Type') || '').toLowerCase();
  if (!ct.startsWith('application/json')) return json({ ok: false, error: 'content_type' }, 415);
  if (Number(request.headers.get('Content-Length') || 0) > LIMITS.body) return json({ ok: false, error: 'too_large' }, 413);
  const text = await request.text();
  if (text.length > LIMITS.body) return json({ ok: false, error: 'too_large' }, 413);
  let data;
  try { data = JSON.parse(text); } catch (err) { return json({ ok: false, error: 'json' }, 400); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return json({ ok: false, error: 'json' }, 400);

  const { fields, errors } = validate(data);
  if (errors.length) return json({ ok: false, error: 'validation', fields: errors }, 400);

  const meta = { country: request.headers.get('CF-IPCountry') || '', ray: request.headers.get('CF-Ray') || '' };
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const rl = await rateLimit(env, ip);
  if (!rl.ok) { log({ event: 'consensus', ok: false, error: 'rate_limited', ray: meta.ray }); return json({ ok: false, error: 'rate_limited' }, 429, { 'Retry-After': '60' }); }

  const turn = fields.messages.filter(m => m.role === 'user').length;
  const maxTurns = Number(env.MAX_TURNS) || 10;
  if (turn > maxTurns) { log({ event: 'consensus', ok: false, error: 'turn_limit', who: fields.who, turn, ray: meta.ray }); return json({ ok: false, error: 'turn_limit', consult: true }, 409); }

  if (fields.dry_run) return json({ ok: true, dry_run: true, who: fields.who, turn, rate_limit: rl.skipped ? 'skipped' : 'ok' });

  // 生成 → 検査。違反は 1 回だけ、違反箇所を伝えて再生成（それでも違反なら応答を返さない: Fail-Closed）
  let out = null, usage = { in: 0, out: 0 }, lastErr = '';
  for (let attempt = 0; attempt < 2 && !out; attempt++) {
    let res;
    try { res = await callModel(deps, env, fields, lastErr); }
    catch (err) { log({ event: 'consensus', ok: false, error: 'model', detail: String(err).slice(0, 200), ray: meta.ray }); return json({ ok: false, error: 'model' }, 502); }
    usage = { in: usage.in + res.usage.in, out: usage.out + res.usage.out };
    const parsed = parseReply(res.text, fields.map);
    if (parsed.ok) out = parsed.value; else lastErr = parsed.error;
  }
  if (!out) { log({ event: 'consensus', ok: false, error: 'policy', detail: lastErr, who: fields.who, turn, tokens_in: usage.in, tokens_out: usage.out, ray: meta.ray }); return json({ ok: false, error: 'policy' }, 502); }

  const lastUser = fields.messages.length ? fields.messages[fields.messages.length - 1].content : '';
  const chain = await chainHash(fields.chain, lastUser, JSON.stringify(out));
  log({ event: 'consensus', ok: true, who: fields.who, turn, map_changed: !!out.map, consult: out.consult, chain, model: env.MODEL, tokens_in: usage.in, tokens_out: usage.out, country: meta.country, ray: meta.ray, ms: deps.now() - started });
  return json({ ok: true, reply: out.reply, map: out.map, consult: out.consult, chain, turn });
}

export function ready(env) { return !!env.ANTHROPIC_API_KEY; }

/* ---------- 検証 ---------- */

const clean = (v, multiline) => {
  let s = String(v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  if (!multiline) s = s.replace(/\n/g, ' ');
  return s.trim();
};

export function validate(data) {
  const errors = []; const fields = {};
  fields.who = data.who === 'creator' || data.who === 'company' ? data.who : '';
  if (!fields.who) errors.push('who');
  const m = data.map && typeof data.map === 'object' && !Array.isArray(data.map) ? data.map : null;
  if (!m) errors.push('map');
  else {
    fields.map = {};
    for (const k of ['goal', 'place', 'step']) {
      const v = typeof m[k] === 'string' ? clean(m[k], false) : '';
      if (!v || v.length > LIMITS.mapLine) errors.push('map.' + k);
      fields.map[k] = v;
    }
  }
  const msgs = Array.isArray(data.messages) ? data.messages : null;
  if (!msgs || !msgs.length || msgs.length > LIMITS.messages) errors.push('messages');
  else {
    fields.messages = [];
    for (let i = 0; i < msgs.length; i++) {
      const x = msgs[i];
      const role = x && (x.role === 'user' || x.role === 'assistant') ? x.role : '';
      const content = x && typeof x.content === 'string' ? clean(x.content, true) : '';
      const expect = i % 2 === 0 ? 'user' : 'assistant';   // user から始まり交互。最後は user
      if (!role || role !== expect || !content || content.length > LIMITS.content) { errors.push('messages.' + i); continue; }
      fields.messages.push({ role, content });
    }
    if (msgs.length % 2 === 0) errors.push('messages.last');
    if (fields.messages.reduce((a, m) => a + m.content.length, 0) > LIMITS.total) errors.push('messages.total');   // 1 会話の全文の上限（費用と文脈の上限）
  }
  const chain = typeof data.chain === 'string' ? data.chain.trim().toLowerCase() : '';
  if (chain && !/^[0-9a-f]{64}$/.test(chain)) errors.push('chain');
  fields.chain = chain;
  fields.dry_run = data.dry_run === true;
  return { fields, errors };
}

// 同一 IP のレート制限（wrangler.toml の [[ratelimits]] CONSENSUS_RL）。binding が無い環境（テスト等）では通す
async function rateLimit(env, ip) {
  if (!env.CONSENSUS_RL || !ip) return { ok: true, skipped: true };
  try { const r = await env.CONSENSUS_RL.limit({ key: ip }); return { ok: r && r.success !== false, skipped: false }; }
  catch (err) { log({ event: 'consensus', warn: 'ratelimit_error', detail: String(err).slice(0, 200) }); return { ok: true, skipped: true }; }
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
}

/* ---------- 生成（モデルは adapter。契約は変えずに差し替える） ---------- */

// 事業の決定済みの言葉だけを AI に渡す（決定台帳 DEC-20260927-01・DEC-20261027-11・12、クリエイター正本 §3-1、企業正本 §3-1）。数値・実績・顧客数は渡さない
const CANON = {
  common: [
    'REYZ Inc.（株式会社レイズ）の事業は 3 つ。クリエイターエコノミー事業（クリエイターの創造性を、続く収入に）、エンタープライズ事業（企業の発信を、設計から確認まで）、AIプラットフォーム事業（AIを、安心して仕事に使える形に）。',
    'REYZ PLATFORM では、提供元の異なる複数のAIが確かめ、人が決め、記録が残る。一致しないものは止まる。',
    '確認を通った案件と商品だけが、企業からクリエイターへ届く。'
  ],
  creator: [
    'クリエイターの 3 つの画面は「地図・入口・明細」。地図＝どこで、何を、いつ出すかの進め方。入口＝収益の入口（ライブ配信／商品の紹介・販売／企業の案件／ファンへの直販／広告・再生の収益／映像・共同IP）。明細＝活動と収入の記録。',
    'REYZ が立つのは、進め方を決めて記録すること、公開前に確かめること、収益の入口を開くこと、記録を持ち運べる形にすること。クリエイター本人から手数料は取らない。',
    'TikTok LIVE の支援は費用ゼロ。ギフト報酬は100%還元。',
    '目標が変わっても、地図を引き直して続ける。'
  ],
  company: [
    '企業の 3 つの画面は「地図・確認・記録」。地図＝目的から逆算した進め方と判断の材料。確認＝公開前に 4 つの法令（ステマ規制・景表法・医療広告・薬機法）に照らす。記録＝確認と決定が残る。',
    '企業が「はい」か「いいえ」で迷わず決められるよう、判断の材料を揃える。最小の人数で最大の利益が残る体制をつくる。',
    '映像制作・SNS運用と、クリエイターとの販売設計を重ねる。国内の基盤を固めながら、アジアへの越境販売と多言語での発信を設計する。'
  ]
};

export function systemPrompt(fields, lastErr) {
  const who = fields.who === 'creator' ? 'クリエイター' : '企業';
  const lines = [
    `あなたは REYZ Inc. の公式サイト（reyz.inc）で、${who}の方の「あなたの地図」を一緒に整える案内役です。地図は 3 つの点（今いる場所 → 最初の一歩 → 目的）を 1 本の線で結んだものです。`,
    '',
    '# 事実（この範囲の言葉だけを使う。ここに無いことは「相談で確かめる」と言う）',
    ...CANON.common.map(s => '- ' + s),
    ...CANON[fields.who].map(s => '- ' + s),
    '',
    '# 現在の地図',
    `- 目的: ${fields.map.goal}`,
    `- 今いる場所: ${fields.map.place}`,
    `- 最初の一歩: ${fields.map.step}`,
    '',
    '# 役割',
    '- 相手の言葉を正確に汲み取り、地図の 3 つの点をその人の言葉で具体にする。問いは 1 回に 1 つだけ。',
    '- 決めるのは相手。あなたは整えて返すだけ。相手の代わりに決めない。',
    '- 地図が十分に具体になったら、または相手が人と話したいと言ったら、consult を true にする（相談へ進める段階だという提案）。',
    '',
    '# 禁止',
    '- 約束・金額・費用・期日・日数・成果・実績・顧客数・保証を言わない（「相談で確かめる」と返す）。',
    '- 事実に無いサービス・機能・名称を作らない。専門用語（AI の仕組み・技術の名前）を本文で使わない。',
    `- 次の語を使わない: ${BANNED.join('、')}。`,
    '- 相手を「ライバーさん」以外の愛称で呼ばない。敬体（です・ます）。',
    '',
    '# 出力の形（厳守。JSON 以外を書かない）',
    '{"reply":"<120文字以内。1〜3文。最後は問いか、相談への一言>","map":null または {"goal":"<60文字以内。。で終える>","place":"<同>","step":"<同>"},"consult":true または false}',
    '- map は、相手の発話で地図の点がより正確になったときだけ入れる。3 つすべてを返す（変えない点は現在の文のまま）。',
    '- reply は "" にしない。'
  ];
  if (lastErr) lines.push('', `# 前回の出力は次の理由で受け付けられなかった。直して出し直す: ${lastErr}`);
  return lines.join('\n');
}

async function callModel(deps, env, fields, lastErr) {
  const body = {
    model: env.MODEL || 'claude-haiku-5-5',
    max_tokens: Number(env.MAX_OUTPUT_TOKENS) || 600,
    temperature: 0.4,
    system: systemPrompt(fields, lastErr),
    messages: fields.messages
  };
  const res = await deps.fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'anthropic-version': API_VERSION, Authorization: `Bearer ${env.ANTHROPIC_API_KEY}` },
    body: JSON.stringify(body),
    signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(LIMITS.timeoutMs) : undefined
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`model ${res.status}: ${shortCode(JSON.stringify(j))}`);
  const text = Array.isArray(j.content) ? j.content.filter(b => b && b.type === 'text').map(b => b.text).join('') : '';
  const u = j.usage || {};
  return { text, usage: { in: Number(u.input_tokens) || 0, out: Number(u.output_tokens) || 0 } };
}

/* ---------- 応答の検査（契約の形・禁止語・断定） ---------- */

export function parseReply(text, currentMap) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const i = raw.indexOf('{'), k = raw.lastIndexOf('}');
  if (i < 0 || k < i) return { ok: false, error: 'JSON ではない' };
  let j;
  try { j = JSON.parse(raw.slice(i, k + 1)); } catch (err) { return { ok: false, error: 'JSON として読めない' }; }
  const reply = typeof j.reply === 'string' ? clean(j.reply, true) : '';
  if (!reply) return { ok: false, error: 'reply が空' };
  if ([...reply].length > LIMITS.replyChars) return { ok: false, error: `reply が長い（${LIMITS.replyChars} 文字以内）` };
  const bad = s => BANNED.find(w => s.includes(w));
  const b1 = bad(reply); if (b1) return { ok: false, error: `禁止語「${b1}」を含む` };
  if (PROMISE.test(reply)) return { ok: false, error: '約束・金額・期日・成果に当たる表現を含む' };
  let map = null;
  if (j.map && typeof j.map === 'object' && !Array.isArray(j.map)) {
    map = {};
    for (const key of ['goal', 'place', 'step']) {
      const v = typeof j.map[key] === 'string' ? clean(j.map[key], false) : '';
      if (!v) return { ok: false, error: `map.${key} が空` };
      if ([...v].length > LIMITS.mapOut) return { ok: false, error: `map.${key} が長い（${LIMITS.mapOut} 文字以内）` };
      const b2 = bad(v); if (b2) return { ok: false, error: `map.${key} に禁止語「${b2}」` };
      if (PROMISE.test(v)) return { ok: false, error: `map.${key} に約束・金額・期日・成果に当たる表現` };
      map[key] = v;
    }
    if (currentMap && map.goal === currentMap.goal && map.place === currentMap.place && map.step === currentMap.step) map = null;   // 変化なしは null
  }
  return { ok: true, value: { reply, map, consult: j.consult === true } };
}

/* ---------- 記録の連鎖 ---------- */

export async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
}
// chain_n = sha256( chain_{n-1} | sha256(入力) | sha256(出力) )。初回の chain_0 は 64 個の 0
export async function chainHash(prev, input, output) {
  const p = prev || '0'.repeat(64);
  return sha256hex(p + '|' + await sha256hex(input) + '|' + await sha256hex(output));
}

/* ---------- 小道具 ---------- */

// モデル側エラーの種別だけを短く返す。本文・秘密は含めない
export function shortCode(s) {
  const t = String(s || '');
  const m = /"type"\s*:\s*"([a-z_]+_error)"/.exec(t) || /"message"\s*:\s*"([^"]{1,80})"/.exec(t);
  if (m) return m[1].slice(0, 80);
  return t.replace(/[{}"\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function baseHeaders(extra = {}) {
  return { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra };
}
function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), { status, headers: baseHeaders({ 'Content-Type': 'application/json; charset=utf-8', ...extra }) });
}
function log(obj) { try { console.log(JSON.stringify(obj)); } catch (err) { /* ignore */ } }
