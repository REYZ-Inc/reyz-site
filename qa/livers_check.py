#!/usr/bin/env python3
"""/livers の検査: 名簿データ（data/livers/YYYY-MM.json）と公開ページ（site/livers.html）が一致すること。

使い方: python3 qa/livers_check.py [site]
終了コード 0 = 全件 PASS。1 件でも FAIL なら 1（Fail-Closed）。ビルドとは独立に、出力 HTML を読んで確かめる。
"""
import glob
import html
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(REPO, 'site')
fails = []
checks = 0


def check(label, ok, detail=''):
    global checks
    checks += 1
    if not ok:
        fails.append(label + (': ' + str(detail) if detail else ''))


files = sorted(glob.glob(os.path.join(REPO, 'data', 'livers', '[0-9][0-9][0-9][0-9]-[0-9][0-9].json')))
check('名簿データが 1 件以上ある', bool(files))
if not files:
    print(json.dumps({'checks': checks, 'fails': fails}, ensure_ascii=False)); sys.exit(1)

# すべての月のデータを同じ規則で検査する（過去の月を壊していないこと）
for f in files:
    d = json.load(open(f, encoding='utf-8')); m = d.get('month', ''); L = d.get('livers', []); th = d.get('threshold_hours')
    tag = os.path.basename(f)
    check(f'{tag}: ファイル名と month が一致', tag == m + '.json', m)
    check(f'{tag}: 基準は 100 時間', th == 100, th)
    check(f'{tag}: 1 人以上', len(L) >= 1)
    check(f'{tag}: 全員が基準時間以上', all(x['hours'] >= th for x in L), [x['id'] for x in L if x['hours'] < th])
    check(f'{tag}: ダイヤモンドの多い順', [x['diamonds'] for x in L] == sorted((x['diamonds'] for x in L), reverse=True))
    check(f'{tag}: id が重複しない', len({x['id'] for x in L}) == len(L))
    check(f'{tag}: id の形式', all(re.fullmatch(r'[A-Za-z0-9._]{2,24}', x['id']) for x in L))
    check(f'{tag}: 名前が空でない', all(x['name'].strip() for x in L))
    check(f'{tag}: 期間・取得日・出典がある', all(d.get(k) for k in ('period_utc', 'captured_on', 'source')))
    for x in L:
        p = os.path.join(SITE, 'assets', 'livers', m, x['avatar'])
        check(f'{tag}: アイコンがある {x["avatar"]}', os.path.exists(p) and os.path.getsize(p) > 2000)

# 公開ページは最新の月だけを載せる
d = json.load(open(files[-1], encoding='utf-8')); L = d['livers']; m = d['month']
y, mo = m.split('-'); label = f'{int(y)}年{int(mo)}月'
page = open(os.path.join(SITE, 'livers.html'), encoding='utf-8').read()
main = page[page.index('<main'):page.index('</main>')]
cards = re.findall(r'<li class="liver (t\d|ta|tb|tc)"><a href="https://www\.tiktok\.com/@([^"]+)"[^>]*>(.*?)</a></li>', main, flags=re.S)
check('見出しが年月', f'<h1 class="page-title">{label}</h1>' in main)
check('「先月」と書いていない', '先月' not in main)
check('人数がデータと一致', len(cards) == len(L), f'{len(cards)} != {len(L)}')
check('並び順とリンク先がデータと一致', [c[1] for c in cards] == [x['id'] for x in L])


def tier(r):
    return f't{r}' if r <= 3 else 'ta' if r <= 10 else 'tb' if r <= 20 else 'tc'


def man(n):
    return f'{round(n / 10000):,}万' if n >= 10000 else f'{n:,}'


for r, (x, (cls, _id, body)) in enumerate(zip(L, cards), 1):
    check(f'{r} 位: 大きさの段', cls == tier(r), cls)
    check(f'{r} 位: アカウント名', f'<span class="liver-name">{html.escape(x["name"])}</span>' in body)
    check(f'{r} 位: ダイヤモンド数と「ダイヤ」の表記', f'<span class="liver-dia"><b>{man(x["diamonds"])}</b>ダイヤ</span>' in body)
    check(f'{r} 位: 配信時間', f'<span class="liver-hours">配信 {round(x["hours"])}時間</span>' in body)
    check(f'{r} 位: アイコン', f'src="assets/livers/{m}/{x["avatar"]}"' in body)
    check(f'{r} 位: 順位の表示', f'<span class="liver-rank" aria-hidden="true">{r}</span>' in body)
    check(f'{r} 位: 押せる印', 'class="liver-go"' in body)
check('1〜3 位に「TikTokで見る」', sum('liver-cta' in c[2] for c in cards[:3]) == min(3, len(cards)) and not any('liver-cta' in c[2] for c in cards[3:]))
check('法定通貨に換算した金額を載せていない', not re.search(r'[0-9０-９][0-9０-９,，.]*\s*(円|ドル)|[¥￥$＄]\s*[0-9０-９]', re.sub(r'<[^>]+>', ' ', main)))
check('出典と期間の注記', 'TikTok LIVE Backstage' in main and label + '1日' in main)
check('取得日の注記', d['captured_on'].replace('-', '/') in main)
creator = open(os.path.join(SITE, 'creator.html'), encoding='utf-8').read()
check('Creator から /livers への導線', re.search(r'href="livers(\.html)?"', creator) is not None)
check('sitemap に /livers', '/livers</loc>' in open(os.path.join(SITE, 'sitemap.xml'), encoding='utf-8').read())

print(json.dumps({'month': m, 'livers': len(L), 'checks': checks, 'fails': fails}, ensure_ascii=False))
sys.exit(1 if fails else 0)
