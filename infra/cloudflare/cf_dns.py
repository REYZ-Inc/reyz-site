#!/usr/bin/env python3
"""Cloudflare DNS as code（reyz-site）。

宣言ファイル infra/cloudflare/zones/<zone>.json の内容に、Cloudflare 上のゾーンとレコードを合わせる。

- 標準ライブラリのみ。secret は環境変数 CLOUDFLARE_API_TOKEN から読み、出力しない。
- plan  : 差分を表示するだけ（何も変えない）
- apply : ゾーン作成・レコード作成/更新を行う。宣言にないレコードの削除は --prune を付けたときだけ
- --dnssec on : ゾーンの DNSSEC を有効化し、レジストラへ登録する DS レコードを表示する
- 既存レコードは削除しない限り触らない。CNAME は宣言と内容が違えば更新する。

使い方:
  CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
  python3 infra/cloudflare/cf_dns.py --zone-file infra/cloudflare/zones/reyz.inc.json --mode plan
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

API = 'https://api.cloudflare.com/client/v4'
PROXIABLE = {'A', 'AAAA', 'CNAME'}
MULTI = {'A', 'AAAA', 'TXT', 'MX', 'NS', 'CAA', 'SRV'}   # 同名で複数値を持てる型（値ごとに照合）


class CF:
    """最小の Cloudflare API クライアント。"""

    def __init__(self, token):
        self.token = token

    def call(self, method, path, body=None, params=None, raise_on_error=True):
        url = API + path + ('?' + urllib.parse.urlencode(params) if params else '')
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers={
            'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                payload = json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            try:
                payload = json.loads(e.read().decode())
            except Exception:
                payload = {'success': False, 'errors': [{'code': e.code, 'message': str(e)}]}
        if not payload.get('success') and raise_on_error:
            raise SystemExit(f'Cloudflare API error: {method} {path}: ' + errs(payload))
        return payload

    def get_all(self, path, params=None):
        out, page = [], 1
        while True:
            p = dict(params or {})
            p.update({'page': page, 'per_page': 100})
            r = self.call('GET', path, params=p)
            out += r['result']
            info = r.get('result_info') or {}
            if page >= (info.get('total_pages') or 1):
                return out
            page += 1


def errs(payload):
    return json.dumps(payload.get('errors'), ensure_ascii=False)


def fqdn(name, zone):
    name = (name or '@').strip().lower()
    if name in ('@', '', zone):
        return zone
    return name if name.endswith('.' + zone) else f'{name}.{zone}'


def norm_content(rtype, content):
    c = (content or '').strip()
    if rtype == 'TXT' and len(c) >= 2 and c[0] == '"' and c[-1] == '"':
        c = c[1:-1]                      # Cloudflare は TXT を "…" 付きで返す
    if rtype in ('CNAME', 'NS', 'MX'):
        c = c.rstrip('.').lower()
    return c


def desired_records(spec):
    zone = spec['zone'].lower()
    out = []
    for r in spec['records']:
        t = r['type'].upper()
        d = {'type': t, 'name': fqdn(r.get('name'), zone), 'content': str(r['content']),
             'ttl': int(r.get('ttl', 1))}
        if t in PROXIABLE:
            d['proxied'] = bool(r.get('proxied', False))
        if t == 'MX':
            d['priority'] = int(r.get('priority', 10))
        out.append(d)
    return zone, out


def diff(existing, desired, prune):
    """既存と宣言を突き合わせて操作一覧を返す。"""
    ops = []
    used = set()
    by_name = {}
    for e in existing:
        by_name.setdefault((e['type'].upper(), e['name'].lower()), []).append(e)
    for d in desired:
        cands = by_name.get((d['type'], d['name']), [])
        if d['type'] in MULTI:
            hit = next((e for e in cands if e['id'] not in used
                        and norm_content(d['type'], e['content']) == norm_content(d['type'], d['content'])), None)
        else:
            hit = next((e for e in cands if e['id'] not in used), None)
        if hit is None:
            ops.append(('create', d, None))
            continue
        used.add(hit['id'])
        changes = {}
        if norm_content(d['type'], hit['content']) != norm_content(d['type'], d['content']):
            changes['content'] = d['content']
        if d['type'] in PROXIABLE and bool(hit.get('proxied')) != d['proxied']:
            changes['proxied'] = d['proxied']
        if d['type'] == 'MX' and int(hit.get('priority', 0)) != d['priority']:
            changes['priority'] = d['priority']
        ops.append(('update', d, hit) if changes else ('keep', d, hit))
    for e in existing:
        if e['id'] not in used:
            ops.append(('delete' if prune else 'extra', None, e))
    return ops


def fmt(rec):
    px = ''
    if rec.get('type', '').upper() in PROXIABLE:
        px = ' (proxied)' if rec.get('proxied') else ' (DNS only)'
    return f"{rec['type']} {rec['name']} {norm_content(rec['type'], rec['content'])}{px}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--zone-file', required=True)
    ap.add_argument('--mode', choices=['plan', 'apply'], default='plan')
    ap.add_argument('--dnssec', choices=['keep', 'on'], default='keep')
    ap.add_argument('--prune', action='store_true', help='宣言にないレコードを削除する（apply 時のみ有効）')
    a = ap.parse_args()

    token = os.environ.get('CLOUDFLARE_API_TOKEN')
    account = os.environ.get('CLOUDFLARE_ACCOUNT_ID', '')
    if not token:
        raise SystemExit('CLOUDFLARE_API_TOKEN が未設定です（GitHub Actions Secrets に置く）')
    with open(a.zone_file, encoding='utf-8') as f:
        spec = json.load(f)
    zone, desired = desired_records(spec)
    cf = CF(token)
    lines = [f'# cloudflare-dns: {zone} ({a.mode})']

    v = cf.call('GET', '/user/tokens/verify')['result']
    lines.append(f"token: {v.get('status')}")

    zones = cf.call('GET', '/zones', params={'name': zone})['result']
    if zones:
        z = zones[0]
        lines.append(f"zone: exists (status={z.get('status')}, plan={(z.get('plan') or {}).get('name')})")
    elif a.mode == 'plan':
        lines.append('zone: MISSING → apply で作成（type=full, Free）')
        lines.append('records: ゾーン未作成のため、以下はすべて create 予定')
        for d in desired:
            lines.append('  + create ' + fmt(d))
        return report(lines, a)
    else:
        if not account:
            raise SystemExit('CLOUDFLARE_ACCOUNT_ID が未設定です（ゾーン作成に必要。GitHub Actions Variables に置く）')
        z = cf.call('POST', '/zones', body={'name': zone, 'account': {'id': account}, 'type': 'full'})['result']
        lines.append(f"zone: CREATED (status={z.get('status')})")
    zid = z['id']
    lines.append('nameservers: ' + ', '.join(z.get('name_servers') or []))

    existing = cf.get_all(f'/zones/{zid}/dns_records')
    ops = diff(existing, desired, a.prune)
    n_change = 0
    lines.append('records:')
    for op, d, e in ops:
        if op == 'keep':
            lines.append('  = keep   ' + fmt(e))
        elif op == 'create':
            n_change += 1
            lines.append('  + create ' + fmt(d))
            if a.mode == 'apply':
                cf.call('POST', f'/zones/{zid}/dns_records', body=d)
        elif op == 'update':
            n_change += 1
            lines.append('  ~ update ' + fmt(e) + '  →  ' + fmt(d))
            if a.mode == 'apply':
                cf.call('PATCH', f'/zones/{zid}/dns_records/{e["id"]}', body=d)
        elif op == 'delete':
            n_change += 1
            lines.append('  - delete ' + fmt(e))
            if a.mode == 'apply':
                cf.call('DELETE', f'/zones/{zid}/dns_records/{e["id"]}')
        else:
            lines.append('  ! extra  ' + fmt(e) + '  （宣言にない。削除は --prune）')
    # ゾーン設定（宣言ファイルの "settings"）。proxied 運用に必要な SSL モード等をここで固定する。
    failed = []
    settings = spec.get('settings') or {}
    if settings:
        lines.append('settings:')
        for k, want in settings.items():
            cur = cf.call('GET', f'/zones/{zid}/settings/{k}', raise_on_error=False)
            if not cur.get('success'):
                lines.append(f'  ! FAIL   {k}: 読取不可 ' + errs(cur))
                failed.append(k)
                continue
            val = (cur.get('result') or {}).get('value')
            if val == want:
                lines.append(f'  = keep   {k}={val}')
                continue
            n_change += 1
            if a.mode == 'apply':
                r = cf.call('PATCH', f'/zones/{zid}/settings/{k}', body={'value': want}, raise_on_error=False)
                if r.get('success'):
                    lines.append(f'  ~ set    {k}: {val} → {want}')
                else:
                    lines.append(f'  ! FAIL   {k}: {val} → {want} ' + errs(r))
                    failed.append(k)
            else:
                lines.append(f'  ~ set    {k}: {val} → {want}')
        if failed:
            lines.append('settings: 失敗あり → トークンに「Zone › Zone Settings › Edit」を追加するか、'
                         'Cloudflare の画面（SSL/TLS）で同じ値に設定する')
    lines.append(f'changes: {n_change}' + (' (applied)' if a.mode == 'apply' else ' (plan only)'))

    # ネームサーバー切替後、Cloudflare に「今すぐ確認」を頼む（pending → active を早める）
    if a.mode == 'apply' and z.get('status') == 'pending':
        r = cf.call('PUT', f'/zones/{zid}/activation_check', raise_on_error=False)
        lines.append('activation check: ' + ('requested' if r.get('success') else 'not now ' + errs(r)))

    ds = cf.call('GET', f'/zones/{zid}/dnssec')['result']
    st = ds.get('status')
    if a.dnssec == 'on' and st not in ('active', 'pending'):
        if a.mode == 'apply':
            ds = cf.call('PATCH', f'/zones/{zid}/dnssec', body={'status': 'active'})['result']
            st = ds.get('status')
            lines.append(f'dnssec: enabled → status={st}')
        else:
            lines.append(f'dnssec: status={st} → apply で有効化')
    else:
        lines.append(f'dnssec: status={st}')
    if ds.get('ds'):
        lines.append('dnssec DS（レジストラに登録する値）: ' + ds['ds'])
        lines.append(f"  key_tag={ds.get('key_tag')} algorithm={ds.get('algorithm')} "
                     f"digest_type={ds.get('digest_type')} digest={ds.get('digest')}")
    report(lines, a, n_change)
    return 1 if failed else 0


def report(lines, a, n_change=0):
    text = '\n'.join(lines)
    print(text)
    if os.environ.get('GITHUB_ACTIONS'):
        # 結果を annotation（::notice）にも出す。Actions のログ本文が読めない環境でも、
        # check-run annotations API から同じ内容を機械的に読めるようにするため。
        esc = text.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
        print(f'::notice title=cloudflare-dns {a.mode}::{esc}')
    summ = os.environ.get('GITHUB_STEP_SUMMARY')
    if summ:
        with open(summ, 'a', encoding='utf-8') as f:
            f.write('```text\n' + text + '\n```\n')
    out = os.environ.get('GITHUB_OUTPUT')
    if out:
        with open(out, 'a', encoding='utf-8') as f:
            f.write(f'changes={n_change}\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
