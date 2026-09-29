#!/usr/bin/env python3
"""問い合わせ Worker（reyz-contact）の記録を Cloudflare Workers Logs API から取り出して一覧にする（読み取りのみ）。

使い方: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID を環境変数に置いて
  python3 infra/check/contact_logs.py --hours 24 [--service reyz-contact]

Worker が console.log した JSON（{"event":"contact", ...}）だけを拾い、時刻（JST）・結果・検証状態・Gmail の受理 ID などを表にする。
本文・メールアドレス・氏名は Worker が記録していないので、ここにも出ない。
GitHub Actions 上では ::notice annotation と Step Summary にも出す（AI が API 経由で読める）。
API: POST /accounts/{account_id}/workers/observability/telemetry/query（token 権限: Workers の可観測性 › 編集）
"""
import argparse, json, os, sys, time, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone

API = 'https://api.cloudflare.com/client/v4'
JST = timezone(timedelta(hours=9))


def query(token, account, service, hours, limit):
    now = int(time.time() * 1000)
    body = {
        'queryId': f'contact-logs-{now}',
        'timeframe': {'from': now - hours * 3600 * 1000, 'to': now},
        'view': 'events', 'limit': limit,
        'parameters': {
            'datasets': ['cloudflare-workers'],
            'filters': [{'key': '$metadata.service', 'operation': 'eq', 'type': 'string', 'value': service}],
        },
    }
    req = urllib.request.Request(f'{API}/accounts/{account}/workers/observability/telemetry/query', data=json.dumps(body).encode(), method='POST',
                                 headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            payload = json.load(r)
    except urllib.error.HTTPError as e:
        raise SystemExit(f'API {e.code}: {e.read().decode()[:600]}')
    if not payload.get('success', True):
        raise SystemExit('API error: ' + json.dumps(payload.get('errors'), ensure_ascii=False))
    res = payload.get('result') or {}
    ev = (res.get('events') or {})
    return ev.get('events') or [], ev.get('count')


def parse_event(e):
    """Worker の console.log は $metadata.message（文字列）か source（構造化）に入る。JSON なら dict にする。"""
    meta = e.get('$metadata') or {}
    msg = meta.get('message')
    src = e.get('source')
    for cand in (src, msg):
        if isinstance(cand, dict) and cand.get('event') == 'contact':
            return cand
        if isinstance(cand, str) and cand.startswith('{'):
            try:
                d = json.loads(cand)
                if isinstance(d, dict) and d.get('event') == 'contact':
                    return d
            except ValueError:
                pass
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--hours', type=int, default=24)
    ap.add_argument('--service', default='reyz-contact')
    ap.add_argument('--limit', type=int, default=200)
    a = ap.parse_args()
    token, account = os.environ.get('CLOUDFLARE_API_TOKEN'), os.environ.get('CLOUDFLARE_ACCOUNT_ID')
    if not token or not account:
        raise SystemExit('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID がない')
    events, count = query(token, account, a.service, a.hours, a.limit)
    rows = []
    for e in events:
        d = parse_event(e)
        if not d:
            continue
        ts = e.get('timestamp') or 0
        t = datetime.fromtimestamp(ts / 1000, JST).strftime('%m-%d %H:%M:%S') if ts else '-'
        outcome = ('OK' if d.get('ok') else 'NG') + (':' + str(d.get('error')) if d.get('error') else '') + (' honeypot-dropped' if d.get('dropped') else '')
        rows.append((ts, f"{t} | {outcome} | verified={d.get('verified', '-')} client={d.get('client', '-')} codes={','.join(d.get('codes') or []) or '-'} "
                         f"| confirmation={d.get('confirmation', '-')} gmail_copy={d.get('gmail_copy', '-') or '-'} gmail_conf={d.get('gmail_confirmation', '-') or '-'} "
                         f"| type={d.get('type', '-')} country={d.get('country', '-')} ray={d.get('ray', '-')} stage={d.get('stage', '')}{d.get('detail', '')}"))
    rows.sort(key=lambda r: r[0])
    lines = [r[1] for r in rows]
    head = f'contact-logs {a.service} 直近 {a.hours} 時間: contact イベント {len(lines)} 件（取得イベント {len(events)} 件 / 一致総数 {count}）'
    print(head)
    for l in lines:
        print('  ' + l)
    if os.environ.get('GITHUB_ACTIONS'):
        esc = lambda s: s.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
        print(f"::notice title={a.service} logs::{esc(head + chr(10) + chr(10).join(lines[-40:]))}")
        summ = os.environ.get('GITHUB_STEP_SUMMARY')
        if summ:
            with open(summ, 'a', encoding='utf-8') as f:
                f.write(f'## {head}\n\n```\n' + '\n'.join(lines) + '\n```\n')


if __name__ == '__main__':
    main()
