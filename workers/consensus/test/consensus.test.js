// ネットワーク不要の自己テスト（node --test）。モデル API は fetch の差し替えで再現する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, validate, parseReply, systemPrompt, chainHash, sha256hex, shortCode, ready } from '../src/index.js';

const ORIGIN = 'https://reyz.inc';
const API_URL = 'https://api.anthropic.com/v1/messages';

const env = (extra = {}) => ({
  CONSENSUS_RL: { limit: async () => ({ success: true }) },
  ALLOWED_ORIGINS: 'https://reyz.inc,https://www.reyz.inc',
  ANTHROPIC_API_KEY: 'test-key',
  MODEL: 'claude-haiku-5-5',
  MAX_TURNS: '10',
  MAX_OUTPUT_TOKENS: '600',
  ...extra
});

const MAP = { goal: '言葉にできている目的を、活動の順番にする。', place: '場所は決まっている。費用ゼロのLIVE支援と、商品紹介・案件を重ねる段階。', step: '企画・撮影・編集をREYZと分け、目標が変わっても続く進め方を決める。' };
const good = (extra = {}) => ({ who: 'creator', map: MAP, messages: [{ role: 'user', content: '週3回の配信を半年続けたい。' }], chain: '', ...extra });

function req(body, { origin = ORIGIN, headers = {}, method = 'POST', path = '/api/consensus/turn' } = {}) {
  const h = { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.5', 'CF-IPCountry': 'JP', 'CF-Ray': 'ray1', ...headers };
  if (origin !== null) h.Origin = origin;
  return new Request('https://reyz.inc' + path, { method, headers: h, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
}

const modelText = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }], usage: { input_tokens: 100, output_tokens: 20 } });
function fakeFetch(responder) {
  const calls = [];
  const f = async (url, init = {}) => { calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null }); return responder(calls); };
  f.calls = calls; return f;
}
const deps = (fetch) => ({ fetch, now: () => 1_800_000_000_000 });
const silence = () => { const orig = console.log; console.log = () => {}; return () => { console.log = orig; }; };

test('health: ready は秘密の有無で決まる', async () => {
  const r1 = await handle(req(null, { method: 'GET', path: '/api/consensus/health', origin: null }), env(), deps(fakeFetch(() => Response.json({}))));
  assert.equal(r1.status, 200); assert.deepEqual(await r1.json(), { ok: true, ready: true });
  const r2 = await handle(req(null, { method: 'GET', path: '/api/consensus/health', origin: null }), env({ ANTHROPIC_API_KEY: '' }), deps(fakeFetch(() => Response.json({}))));
  assert.deepEqual(await r2.json(), { ok: true, ready: false });
  assert.equal(ready({}), false);
});

test('経路・メソッド・origin・設定なし', async () => {
  const d = deps(fakeFetch(() => Response.json({})));
  assert.equal((await handle(req(good(), { path: '/api/consensus/other' }), env(), d)).status, 404);
  assert.equal((await handle(req(null, { method: 'GET' }), env(), d)).status, 405);
  assert.equal((await handle(req(null, { method: 'OPTIONS' }), env(), d)).status, 204);
  assert.equal((await handle(req(good(), { origin: 'https://evil.example' }), env(), d)).status, 403);
  assert.equal((await handle(req(good(), { origin: null }), env(), d)).status, 403);
  const restore = silence();
  assert.equal((await handle(req(good()), env({ ANTHROPIC_API_KEY: '' }), d)).status, 503);
  restore();
  assert.equal((await handle(req(good(), { headers: { 'Content-Type': 'text/plain' } }), env(), d)).status, 415);
  assert.equal((await handle(req('{bad'), env(), d)).status, 400);
  assert.equal(d.fetch.calls.length, 0, 'モデルは呼ばれない');
});

test('validate: 形の検査', () => {
  assert.deepEqual(validate(good()).errors, []);
  assert.ok(validate(good({ who: 'other' })).errors.includes('who'));
  assert.ok(validate(good({ map: { goal: '', place: 'a', step: 'b' } })).errors.includes('map.goal'));
  assert.ok(validate(good({ messages: [] })).errors.includes('messages'));
  assert.ok(validate(good({ messages: [{ role: 'assistant', content: 'x' }] })).errors.includes('messages.0'));   // user から始まる
  assert.ok(validate(good({ messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] })).errors.includes('messages.last'));   // 最後は user
  assert.ok(validate(good({ messages: [{ role: 'user', content: 'x'.repeat(1001) }] })).errors.includes('messages.0'));
  assert.ok(validate(good({ chain: 'zz' })).errors.includes('chain'));
  assert.deepEqual(validate(good({ chain: 'A'.repeat(64) })).errors, []);
  const f = validate(good({ messages: [{ role: 'user', content: 'a\u0000b\r\nc' }] })).fields;
  assert.equal(f.messages[0].content, 'ab\nc', '制御文字は除き、改行は保つ');
});

test('turn: モデルの JSON を契約の形で返し、chain がつながる', async () => {
  const fetch = fakeFetch(() => Response.json(modelText({ reply: '半年続けるなら、まず配信の曜日を決めましょう。何曜日が続けやすいですか。', map: { goal: '週3回の配信を半年続ける。', place: MAP.place, step: MAP.step }, consult: false })));
  const restore = silence();
  const r = await handle(req(good()), env(), deps(fetch));
  restore();
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true); assert.equal(j.turn, 1); assert.equal(j.consult, false);
  assert.equal(j.map.goal, '週3回の配信を半年続ける。');
  assert.match(j.chain, /^[0-9a-f]{64}$/);
  const expected = await chainHash('', '週3回の配信を半年続けたい。', JSON.stringify({ reply: j.reply, map: j.map, consult: false }));
  assert.equal(j.chain, expected, 'chain = sha256(前 | sha256(入力) | sha256(出力))');
  // モデルへの要求の形
  const call = fetch.calls[0];
  assert.equal(call.url, API_URL);
  assert.equal(call.init.headers['anthropic-version'], '2026-10-21');
  assert.equal(call.init.headers.Authorization, 'Bearer test-key');
  assert.equal(call.body.model, 'claude-haiku-5-5');
  assert.deepEqual(call.body.messages, [{ role: 'user', content: '週3回の配信を半年続けたい。' }]);
  assert.ok(call.body.system.includes('目的: ' + MAP.goal), 'system に現在の地図');
  assert.ok(!call.body.system.includes('test-key'), 'secret は prompt に出ない');
});

test('turn: 禁止語・断定は 1 回だけ再生成し、2 回目も違反なら policy で返さない（Fail-Closed）', async () => {
  const fetch = fakeFetch((calls) => Response.json(modelText({ reply: calls.length === 1 ? 'この機能は開発中です。' : '必ず収益になります。', map: null, consult: false })));
  const restore = silence();
  const r = await handle(req(good()), env(), deps(fetch));
  restore();
  assert.equal(r.status, 502);
  assert.equal((await r.json()).error, 'policy');
  assert.equal(fetch.calls.length, 2);
  assert.ok(fetch.calls[1].body.system.includes('禁止語「開発中」'), '2 回目は違反理由を伝える');
});

test('turn: 1 回目が違反でも 2 回目が正しければ返す', async () => {
  const fetch = fakeFetch((calls) => Response.json(modelText(calls.length === 1 ? 'ただの文章' : { reply: '続けやすい曜日はありますか。', map: null, consult: false })));
  const restore = silence();
  const r = await handle(req(good()), env(), deps(fetch));
  restore();
  assert.equal(r.status, 200); assert.equal((await r.json()).reply, '続けやすい曜日はありますか。');
});

test('turn: モデル API の失敗は 502 model（秘密・本文は出ない）', async () => {
  const fetch = fakeFetch(() => new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401 }));
  const restore = silence();
  const r = await handle(req(good()), env(), deps(fetch));
  restore();
  assert.equal(r.status, 502); assert.equal((await r.json()).error, 'model');
});

test('turn: 往復の上限を超えたら 409 turn_limit（consult=true）', async () => {
  const msgs = []; for (let i = 0; i < 11; i++) { msgs.push({ role: 'user', content: 'u' + i }); if (i < 10) msgs.push({ role: 'assistant', content: 'a' + i }); }
  const restore = silence();
  const r = await handle(req(good({ messages: msgs })), env(), deps(fakeFetch(() => Response.json({}))));
  restore();
  assert.equal(r.status, 409); const j = await r.json(); assert.equal(j.error, 'turn_limit'); assert.equal(j.consult, true);
});

test('turn: レート制限は 429、dry_run はモデルを呼ばない', async () => {
  const fetch = fakeFetch(() => Response.json({}));
  const restore = silence();
  const r = await handle(req(good()), env({ CONSENSUS_RL: { limit: async () => ({ success: false }) } }), deps(fetch));
  restore();
  assert.equal(r.status, 429); assert.equal(r.headers.get('Retry-After'), '60');
  const d = await handle(req(good({ dry_run: true })), env(), deps(fetch));
  assert.equal(d.status, 200); const j = await d.json(); assert.equal(j.dry_run, true); assert.equal(j.turn, 1);
  assert.equal(fetch.calls.length, 0);
});

test('parseReply: 形・長さ・禁止語・変化なしは null', () => {
  assert.equal(parseReply('```json\n{"reply":"はい。","map":null,"consult":true}\n```', MAP).value.consult, true);
  assert.equal(parseReply('前置き {"reply":"はい。","map":null,"consult":false} 後置き', MAP).ok, true);
  assert.equal(parseReply('{"reply":"","map":null}', MAP).ok, false);
  assert.equal(parseReply(JSON.stringify({ reply: 'あ'.repeat(221), map: null }), MAP).ok, false);
  assert.equal(parseReply(JSON.stringify({ reply: '10万円です。', map: null }), MAP).ok, false);
  assert.equal(parseReply(JSON.stringify({ reply: '3日以内に。', map: null }), MAP).ok, false);
  assert.equal(parseReply(JSON.stringify({ reply: 'ギフト報酬は100%還元です。', map: null }), MAP).ok, true, '決定済みの固定文は通る');
  assert.equal(parseReply(JSON.stringify({ reply: 'はい。', map: { goal: MAP.goal, place: MAP.place, step: MAP.step } }), MAP).value.map, null, '変化なしは null');
  assert.equal(parseReply(JSON.stringify({ reply: 'はい。', map: { goal: 'x', place: '' , step: 'y' } }), MAP).ok, false, 'map は 3 つすべて');
  assert.equal(parseReply(JSON.stringify({ reply: 'はい。', map: { goal: '所属して進める。', place: 'a', step: 'b' } }), MAP).ok, false, 'map の禁止語');
});

test('systemPrompt: 事実の範囲と禁止、企業の枝', () => {
  const s = systemPrompt({ who: 'company', map: MAP }, '');
  assert.ok(s.includes('地図・確認・記録')); assert.ok(s.includes('ステマ規制')); assert.ok(!s.includes('ライブ配信／商品の紹介・販売'));
  assert.ok(s.includes('開発中') && s.includes('話してみる'), '禁止語の列挙');
  assert.ok(!s.includes('前回の出力'));
  assert.ok(systemPrompt({ who: 'creator', map: MAP }, 'x').includes('前回の出力'));
});

test('小道具: sha256 / shortCode', async () => {
  assert.equal(await sha256hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(shortCode('{"type":"error","error":{"type":"rate_limit_error","message":"x"}}'), 'rate_limit_error');
  assert.equal(shortCode('plain "text" {x}'), 'plain text x');
});
