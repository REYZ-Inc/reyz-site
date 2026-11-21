#!/usr/bin/env python3
"""/livers の月次更新: Backstage から読んだ 1 か月分の行から、名簿データ（data/livers/YYYY-MM.json）を作る。

手で並べ替えたり絞り込んだりしない。条件（100 時間以上）と並び順（ダイヤモンドの多い順）は、この道具が機械的に適用する。

使い方:
  python3 tools/livers_month.py 2026-11 raw.json avatars/ --captured-on 2026-12-01 --members 158

  raw.json   Backstage「クリエイターデータ」をその月の 1 日〜末日（UTC）で開いて読んだ全行。
             [{"id": "ユーザーID", "diamonds": 16450000, "hours": 158.3}, ...]
             （hours は「LIVE時間」を時間に直した小数。絞り込み前の全員分を入れる）
  avatars/   掲載対象者の TikTok プロフィール画像。ファイル名は <ユーザーID>.jpg。
             あわせて avatars/names.json に {"ユーザーID": "アカウント名", ...} を置く（プロフィールの表示名そのまま）。

出力:
  data/livers/YYYY-MM.json と site/assets/livers/YYYY-MM/<ユーザーID>.jpg
  そのあと python3 build/build.py と bash qa/run_all.sh を実行する（手順: docs/livers-monthly-update.md）。
"""
import argparse
import calendar
import json
import os
import re
import shutil
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THRESHOLD_HOURS = 100


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('month'); ap.add_argument('raw'); ap.add_argument('avatars')
    ap.add_argument('--captured-on', required=True, help='アカウント名とアイコンを取得した日（YYYY-MM-DD）')
    ap.add_argument('--members', type=int, required=True, help='Backstage の一覧に出た人数（その月の全員）')
    a = ap.parse_args()
    if not re.fullmatch(r'\d{4}-\d{2}', a.month): sys.exit('month は YYYY-MM')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', a.captured_on): sys.exit('--captured-on は YYYY-MM-DD')
    y, m = map(int, a.month.split('-'))
    raw = json.load(open(a.raw, encoding='utf-8'))
    if len(raw) > a.members: sys.exit(f'raw の行数 {len(raw)} が --members {a.members} を超えています')
    if len({r['id'] for r in raw}) != len(raw): sys.exit('raw に id の重複があります')
    names = json.load(open(os.path.join(a.avatars, 'names.json'), encoding='utf-8'))
    picked = sorted((r for r in raw if r['hours'] >= THRESHOLD_HOURS), key=lambda r: (-r['diamonds'], r['id']))
    if not picked: sys.exit('100 時間以上の人が 0 人です。raw を確認してください')
    out_dir = os.path.join(REPO, 'site', 'assets', 'livers', a.month); os.makedirs(out_dir, exist_ok=True)
    livers = []; missing = []
    for r in picked:
        src = os.path.join(a.avatars, r['id'] + '.jpg')
        if not os.path.exists(src): missing.append('アイコン ' + r['id'])
        if not str(names.get(r['id'], '')).strip(): missing.append('アカウント名 ' + r['id'])
    if missing: sys.exit('不足があります（1 人でも欠けたら作りません）: ' + ', '.join(missing))
    for r in picked:
        shutil.copyfile(os.path.join(a.avatars, r['id'] + '.jpg'), os.path.join(out_dir, r['id'] + '.jpg'))
        livers.append({'id': r['id'], 'name': names[r['id']], 'diamonds': int(r['diamonds']), 'hours': round(float(r['hours']), 1), 'avatar': r['id'] + '.jpg'})
    doc = {'month': a.month, 'source': 'TikTok LIVE Backstage（クリエイターデータ）',
           'period_utc': [f'{y:04d}-{m:02d}-01', f'{y:04d}-{m:02d}-{calendar.monthrange(y, m)[1]:02d}'],
           'captured_on': a.captured_on, 'threshold_hours': THRESHOLD_HOURS, 'members_listed_in_backstage': a.members,
           'note': 'diamonds は Backstage の表示値（上 3〜4 桁に丸められた値）。name と avatar は captured_on 時点の TikTok 公開プロフィール。',
           'livers': livers}
    path = os.path.join(REPO, 'data', 'livers', a.month + '.json')
    json.dump(doc, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'{a.month}: 全 {len(raw)} 行 → 100 時間以上 {len(livers)} 人 → {os.path.relpath(path, REPO)}')
    for i, x in enumerate(livers, 1): print(f'  {i:2d} {x["id"]:24s} {x["diamonds"]:>11,} {x["hours"]:6.1f}h  {x["name"]}')


if __name__ == '__main__':
    main()
