#!/usr/bin/env python3
"""artifact.html と viewer 検証用フィクスチャを site4/index.html から派生させる。

- artifact.html      : claude.ai Artifact の本文（viewer 側が <!doctype>/<html>/<head>/<body> の骨格を付与するため、
                       <meta charset>/<meta viewport> と外側タグを外し、<title> を短名に、先頭で no-js クラスを付ける）
- qa/viewer_sim.html : 実 viewer の骨格（body{color:#141413} 等）で artifact.html を包んだ再現フィクスチャ。
                       typo_check.js が site4/__viewer_sim.html として読み込む（配布物には含めない）。
"""
import os, re
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, 'site', 'index.html')
html = open(SRC, encoding='utf-8').read()
m = re.search(r'<head>(.*?)</head>\s*<body[^>]*>(.*)</body>', html, re.S)
assert m, 'index.html: head/body not found'
head, body = m.group(1), m.group(2)
head = re.sub(r'\s*<meta charset="utf-8">', '', head)
head = re.sub(r'\s*<meta name="viewport"[^>]*>', '', head)
head = re.sub(r'<title>[^<]*</title>', '<title>REYZ かたちに</title>', head)
head = head.strip('\n')
body = body.rstrip() + '\n'
artifact = '<script>document.documentElement.classList.add("no-js");</script>\n' + head + '\n' + body
open(os.path.join(ROOT, 'artifact.html'), 'w', encoding='utf-8').write(artifact)

SKELETON = ('<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">'
            '<style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
            'html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#faf9f5;color:#141413}'
            'img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>\n')
open(os.path.join(ROOT, 'qa', 'viewer_sim.html'), 'w', encoding='utf-8').write(SKELETON + artifact + '</body></html>\n')
print('artifact.html', len(artifact.encode()), 'bytes; qa/viewer_sim.html regenerated')
