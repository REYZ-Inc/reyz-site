#!/usr/bin/env python3
"""cf_dns.py の差分・冪等性・DNSSEC 手順を、Cloudflare API の偽物（インメモリ）で検証する。
使い方: python3 infra/cloudflare/test_cf_dns.py  （ネットワーク不要）"""
import io
import json
import os
import re
import sys
import unittest
from contextlib import redirect_stdout

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cf_dns  # noqa: E402

ZONE_FILE = os.path.join(HERE, 'zones', 'reyz.inc.json')


class FakeCF:
    """Cloudflare API の最小再現。TXT は本物同様に "…" 付きで返す。"""
    state = None

    def __init__(self, token):
        assert token == 'test-token'
        self.s = FakeCF.state

    def call(self, method, path, body=None, params=None):
        s = self.s
        s['calls'].append((method, path))
        if path == '/user/tokens/verify':
            return {'success': True, 'result': {'status': 'active'}}
        if path == '/zones' and method == 'GET':
            z = [s['zone']] if s['zone'] and s['zone']['name'] == params['name'] else []
            return {'success': True, 'result': z}
        if path == '/zones' and method == 'POST':
            assert body['account']['id'] == 'acct-1' and body['type'] == 'full'
            s['zone'] = {'id': 'z1', 'name': body['name'], 'status': 'pending',
                         'plan': {'name': 'Free Website'}, 'name_servers': ['a.ns.cloudflare.com', 'b.ns.cloudflare.com']}
            return {'success': True, 'result': s['zone']}
        m = re.fullmatch(r'/zones/z1/dns_records(?:/(\w+))?', path)
        if m:
            rid = m.group(1)
            if method == 'POST':
                rec = dict(body); rec['id'] = f'r{len(s["records"]) + 1}'
                if rec['type'] == 'TXT':
                    rec['content'] = '"' + rec['content'] + '"'
                s['records'].append(rec)
                return {'success': True, 'result': rec}
            if method == 'PATCH':
                rec = next(r for r in s['records'] if r['id'] == rid); rec.update(body)
                return {'success': True, 'result': rec}
            if method == 'DELETE':
                s['records'] = [r for r in s['records'] if r['id'] != rid]
                return {'success': True, 'result': {'id': rid}}
        if path == '/zones/z1/dnssec':
            if method == 'PATCH':
                assert body == {'status': 'active'}
                s['dnssec'] = {'status': 'pending', 'ds': '12345 13 2 abcd', 'key_tag': 12345,
                               'algorithm': '13', 'digest_type': '2', 'digest': 'abcd'}
            return {'success': True, 'result': s['dnssec']}
        raise AssertionError(f'unexpected call {method} {path}')

    def get_all(self, path, params=None):
        assert path == '/zones/z1/dns_records'
        return list(self.s['records'])


def run(*argv, actions=False):
    FakeCF.state.setdefault('calls', [])
    os.environ['CLOUDFLARE_API_TOKEN'] = 'test-token'
    os.environ['CLOUDFLARE_ACCOUNT_ID'] = 'acct-1'
    # GitHub Actions 上で走るときも、テストは Actions 固有の出力（summary/output/annotation）を使わない
    for k in ('GITHUB_STEP_SUMMARY', 'GITHUB_OUTPUT', 'GITHUB_ACTIONS'):
        os.environ.pop(k, None)
    if actions:
        os.environ['GITHUB_ACTIONS'] = 'true'
    sys.argv = ['cf_dns.py', '--zone-file', ZONE_FILE] + list(argv)
    buf = io.StringIO()
    with redirect_stdout(buf):
        cf_dns.main()
    return buf.getvalue()


class T(unittest.TestCase):
    def setUp(self):
        FakeCF.state = {'zone': None, 'records': [], 'dnssec': {'status': 'disabled'}, 'calls': []}
        cf_dns.CF = FakeCF

    def writes(self):
        return [c for c in FakeCF.state['calls'] if c[0] in ('POST', 'PATCH', 'DELETE')]

    def test_plan_on_missing_zone_writes_nothing(self):
        out = run('--mode', 'plan')
        self.assertIn('zone: MISSING', out)
        self.assertEqual(out.count('+ create'), 8)
        self.assertEqual(self.writes(), [])

    def test_apply_creates_zone_and_records_then_idempotent(self):
        out = run('--mode', 'apply')
        self.assertIn('zone: CREATED', out)
        self.assertIn('nameservers: a.ns.cloudflare.com, b.ns.cloudflare.com', out)
        self.assertEqual(out.count('+ create'), 8)
        self.assertIn('changes: 8 (applied)', out)
        recs = FakeCF.state['records']
        self.assertEqual(len(recs), 8)
        self.assertTrue(all(r.get('proxied') is False for r in recs if r['type'] in ('A', 'CNAME')))
        self.assertTrue(all('proxied' not in r for r in recs if r['type'] == 'TXT'))
        self.assertEqual({r['name'] for r in recs},
                         {'reyz.inc', 'www.reyz.inc', '_dmarc.reyz.inc', '_domainkey.reyz.inc'})
        FakeCF.state['calls'] = []
        out2 = run('--mode', 'apply')
        self.assertEqual(out2.count('= keep'), 8)
        self.assertIn('changes: 0', out2)
        self.assertEqual(self.writes(), [])          # TXT の "…" 差でも再作成しない

    def test_cname_drift_is_updated_and_proxied_drift_fixed(self):
        run('--mode', 'apply')
        www = next(r for r in FakeCF.state['records'] if r['type'] == 'CNAME')
        www['content'] = 'old.example.'; www['proxied'] = True
        FakeCF.state['calls'] = []
        out = run('--mode', 'plan')
        self.assertIn('~ update CNAME www.reyz.inc old.example (proxied)', out)
        self.assertEqual(self.writes(), [])
        out = run('--mode', 'apply')
        self.assertIn('changes: 1 (applied)', out)
        self.assertEqual(www['content'], 'reyz-inc.github.io'); self.assertFalse(www['proxied'])

    def test_extra_record_is_reported_not_deleted_unless_prune(self):
        run('--mode', 'apply')
        FakeCF.state['records'].append({'id': 'x', 'type': 'CNAME', 'name': '_domainconnect.reyz.inc',
                                        'content': '_domainconnect.domains.squarespace.com', 'proxied': False})
        out = run('--mode', 'apply')
        self.assertIn('! extra  CNAME _domainconnect.reyz.inc', out)
        self.assertEqual(len(FakeCF.state['records']), 9)
        out = run('--mode', 'apply', '--prune')
        self.assertIn('- delete CNAME _domainconnect.reyz.inc', out)
        self.assertEqual(len(FakeCF.state['records']), 8)

    def test_dnssec_on(self):
        run('--mode', 'apply')
        out = run('--mode', 'plan', '--dnssec', 'on')
        self.assertIn('dnssec: status=disabled → apply で有効化', out)
        self.assertEqual(FakeCF.state['dnssec']['status'], 'disabled')
        out = run('--mode', 'apply', '--dnssec', 'on')
        self.assertIn('dnssec: enabled → status=pending', out)
        self.assertIn('dnssec DS（レジストラに登録する値）: 12345 13 2 abcd', out)
        FakeCF.state['calls'] = []
        out = run('--mode', 'apply', '--dnssec', 'on')   # 2 回目は PATCH しない
        self.assertIn('dnssec: status=pending', out)
        self.assertEqual([c for c in FakeCF.state['calls'] if c == ('PATCH', '/zones/z1/dnssec')], [])

    def test_notice_annotation_under_actions(self):
        out = run('--mode', 'plan', actions=True)
        notice = [ln for ln in out.splitlines() if ln.startswith('::notice title=cloudflare-dns plan::')]
        self.assertEqual(len(notice), 1)
        self.assertIn('%0Azone: MISSING', notice[0])          # 改行は %0A にエスケープ
        self.assertNotIn('\n', notice[0])

    def test_helpers(self):
        self.assertEqual(cf_dns.fqdn('@', 'reyz.inc'), 'reyz.inc')
        self.assertEqual(cf_dns.fqdn('www', 'reyz.inc'), 'www.reyz.inc')
        self.assertEqual(cf_dns.fqdn('www.reyz.inc', 'reyz.inc'), 'www.reyz.inc')
        self.assertEqual(cf_dns.norm_content('TXT', '"v=spf1 -all"'), 'v=spf1 -all')
        self.assertEqual(cf_dns.norm_content('CNAME', 'Reyz-Inc.github.io.'), 'reyz-inc.github.io')
        spec = json.load(open(ZONE_FILE, encoding='utf-8'))
        self.assertEqual(spec['zone'], 'reyz.inc'); self.assertEqual(len(spec['records']), 8)


if __name__ == '__main__':
    unittest.main(verbosity=1)
