# -*- coding: utf-8 -*-
"""REYZ Inc. corporate site v6 — static build (narrative + sticky particle stage).
Run: python3 build/build.py → writes ./site/*.html and content-fingerprinted entry assets."""
import os, re, html, json, hashlib, tempfile

ROOT = os.environ.get('SITE_OUT') or os.path.join(os.path.dirname(__file__), '..', 'site')   # SITE_OUT: 検証用の別出力先
SITE_URL = os.environ.get('SITE_URL', 'https://reyz.inc')   # 公開ドメイン（canonical / og:url / og:image / sitemap）。末尾スラッシュなし
SOURCE_ASSETS = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'site', 'assets'))
ENTRY_ASSET_NAMES = ('site.css', 'site.js', 'field-renderer.js', 'experience.js', 'manual.css', 'manual.js')

def build_entry_assets():
    """Keep editable canonical files; publish exact byte copies at content URLs.

    Copies stay in assets/ so CSS URLs, currentScript and relative ES imports keep
    the same base. This fingerprints the six entries only, not the manual module
    dependency graph. SITE_OUT still uses repository assets as the source.
    Old fingerprints deliberately remain: cached older HTML must keep working.
    """
    sources = {}
    for name in ENTRY_ASSET_NAMES:
        with open(os.path.join(SOURCE_ASSETS, name), 'rb') as source:
            sources[name] = source.read()
    target_dir = os.path.join(ROOT, 'assets')
    os.makedirs(target_dir, exist_ok=True)
    urls = {}
    for name, content in sources.items():
        stem, suffix = os.path.splitext(name)
        versioned = f'{stem}.{hashlib.sha256(content).hexdigest()[:16]}{suffix}'
        target = os.path.join(target_dir, versioned)
        if os.path.exists(target):
            with open(target, 'rb') as existing:
                if existing.read() != content:
                    raise RuntimeError(f'Fingerprint collision or corrupted generated asset: {target}')
        else:
            # Only our incomplete temporary file is cleaned up. Never prune a
            # previously published fingerprint, even when it is no longer current.
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(dir=target_dir, prefix=versioned + '.', suffix='.tmp', delete=False) as output:
                    temporary = output.name
                    output.write(content)
                os.chmod(temporary, 0o644)
                os.replace(temporary, target)
            finally:
                if temporary and os.path.exists(temporary):
                    os.unlink(temporary)
        urls['assets/' + name] = 'assets/' + versioned
    return urls

ENTRY_ASSETS = build_entry_assets()
def asset_url(path):
    return ENTRY_ASSETS.get(path, path)

NAV = [('creator.html', 'Creator'), ('creative.html', 'Creative'), ('ai.html', 'AI'), ('index.html#reyz', 'Company'), ('contact.html', 'Contact')]
ADDRESS = '東京都渋谷区恵比寿1丁目19-19 恵比寿ビジネスタワー10階'
ICON = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2064%2064'%3E%3Crect%20width='64'%20height='64'%20rx='14'%20fill='%23060609'/%3E%3Cpath%20d='M18%2032c0-6%204-9%208-9s6%203%208%209%204%209%208%209%208-3%208-9-4-9-8-9-6%203-8%209-4%209-8%209-8-3-8-9z'%20fill='none'%20stroke='%23F715AC'%20stroke-width='2.4'%20stroke-linecap='round'/%3E%3C/svg%3E"

def clean(fname):
    """公開 URL の表記（2026-10-03 CEO 決定）: 拡張子 .html を付けない。index.html は ''（= /）。
    ファイル自体は x.html のまま出力する（GitHub Pages は /x で x.html を返す。旧 URL /x.html も引き続き開ける）。"""
    return '' if fname == 'index.html' else re.sub(r'\.html$', '', fname)
_PAGE_RE = r'(?:creator|creative|ai|consensus|contact|legal|works|manual)'
def clean_links(doc):
    """ページ内リンクを .html なしの表記へ（index.html → ./ 、x.html → x。#以降は保つ）。本文は x.html で書き、出力時に一括変換する。
    KEEP_HTML_LINKS=1 は検証用（静的ファイルだけを配る試写では x.html のまま）。本番ビルドでは使わない。"""
    if os.environ.get('KEEP_HTML_LINKS') == '1': return doc
    doc = re.sub(r'href="index\.html(#[^"]*)?"', lambda m: 'href="./' + (m.group(1) or '') + '"', doc)
    return re.sub(r'href="(' + _PAGE_RE + r')\.html(#[^"]*)?"', lambda m: 'href="' + m.group(1) + (m.group(2) or '') + '"', doc)

def head(title, desc, fname='index.html', styles=()):
    extra_styles = ''.join(f'  <link rel="stylesheet" href="{html.escape(asset_url(path), quote=True)}">\n' for path in styles)
    return f'''<!DOCTYPE html>
<html lang="ja" class="no-js">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>{html.escape(title)}</title>
  <meta name="description" content="{html.escape(desc)}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="{html.escape(title)}">
  <meta property="og:description" content="{html.escape(desc)}">
  <meta property="og:site_name" content="REYZ Inc.">
  <meta property="og:locale" content="ja_JP">
  <meta property="og:url" content="{SITE_URL}/{clean(fname)}">
  <meta property="og:image" content="{SITE_URL}/assets/og-editorial.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="canonical" href="{SITE_URL}/{clean(fname)}">
  <meta name="theme-color" content="#060609">
  <link rel="icon" href="{ICON}">
  <link rel="icon" type="image/png" sizes="32x32" href="assets/favicon-32.png">
  <link rel="apple-touch-icon" sizes="180x180" href="assets/apple-touch-icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&family=Noto+Sans+JP:wght@300;400;500&display=swap">
  <link rel="stylesheet" href="{asset_url('assets/site.css')}">
{extra_styles}</head>
'''

def header(current):
    cur = lambda h: ' aria-current="page"' if h == current else ''
    links = '\n'.join(f'      <a href="{h}"{cur(h)}>{t}</a>' for h, t in NAV)
    # スマホのメニューだけ、CREATOR／CREATIVE に日本語の副題を添える（DEC-20261027-17。模擬ユーザー 3/4 が混同）。ナビ 5 項目と英語表記は不変
    SUB = {'creator.html': 'クリエイターの方へ', 'creative.html': '企業の方へ'}
    sheet = '\n'.join(f'    <a href="{h}"{cur(h)}><span class="l">{t}</span>' + (f'<small class="sub">{SUB[h]}</small>' if h in SUB else '') + '</a>' for h, t in NAV)
    return f'''  <a class="skip" href="#main">本文へ移動</a>
  <canvas id="field" aria-hidden="true"></canvas>
  <div class="grain" aria-hidden="true"></div>

  <header class="site-header" id="siteHeader">
    <a class="brand" href="index.html" aria-label="REYZ Inc. ホーム"><span>REY<span class="z">Z</span></span> <small>Inc.</small></a>
    <nav class="nav" aria-label="Main">
{links}
    </nav>
    <button class="menu-btn" id="menuBtn" type="button" aria-expanded="false" aria-controls="sheet" aria-label="メニューを開く"><span class="bar"></span><span class="bar"></span><span class="bar"></span></button>
  </header>
  <nav class="sheet" id="sheet" aria-label="Main (mobile)" hidden>
{sheet}
  </nav>
'''

FOOTER = f'''  <footer class="site-footer">
    <div class="wrap">
      <div class="foot-top">
        <a class="brand" href="index.html" aria-label="REYZ Inc. ホーム"><span>REY<span class="z">Z</span></span> <small>Inc.</small></a>
        <nav class="foot-nav" aria-label="Footer">
          <a href="manual.html">配信マニュアル</a>
          <a href="contact.html">Contact</a>
          <a href="legal.html">Privacy &amp; Legal</a>
        </nav>
      </div>
      <div class="foot-slot" data-word="loop" aria-hidden="true"></div>
      <p class="foot-contact" id="contactLine" hidden></p>
    </div>
  </footer>

  <script src="{asset_url('assets/field-renderer.js')}"></script>
  <script src="{asset_url('assets/site.js')}"></script>
  <script src="{asset_url('assets/experience.js')}"></script>
</body>
</html>
'''


PAGES = []
def page(fname, title, desc, col_text, current=None, styles=(), scripts=(), body_class=''):
    PAGES.append(fname)
    body = '<body data-page="' + html.escape(fname.removesuffix('.html'), quote=True) + '"' + (f' class="{html.escape(body_class, quote=True)}"' if body_class else '') + '>\n'
    footer = FOOTER
    if scripts:
        extra_scripts = ''.join(f'  <script type="module" src="{html.escape(asset_url(path), quote=True)}"></script>\n' for path in scripts)
        footer = footer.replace('</body>', extra_scripts + '</body>')
    doc = head(title, desc, fname, styles) + body + header(current or fname) + f'''
  <main id="main">
{col_text}  </main>

''' + footer
    with open(os.path.join(ROOT, fname), 'w', encoding='utf-8') as f: f.write(clean_links(doc))

def slot(word, halo=False):
    return f'<div class="slot" data-word="{word}" aria-hidden="true">' + ('<div class="halo"></div>' if halo else '') + '</div>'

def jp(text):
    """日本語本文の行組み。改行 = 指定どおりの改行（<br>）。各行は「、」「。」の直後と '|'（任意の折返し点）で文節に分け、
    inline-block の span.ph にする → 画面幅が足りない時も語の途中では折り返さず、文節の切れ目でだけ折り返す。
    [ … ] で囲んだ範囲は「まず丸ごと次行へ送り、それでも収まらない時だけ内側の切れ目で折る」まとまり（入れ子の span.ph）。"""
    def seg(x):
        return ''.join(f'<span class="ph">{t}</span>' for t in re.split(r'(?<=[、。])|\|', x) if t)
    out = []
    for ln in text.strip('\n').split('\n'):
        parts = re.split(r'\[([^\]]*)\]', ln)                      # 奇数番目 = [ ] の中身
        out.append(''.join(seg(pt) if i % 2 == 0 else f'<span class="ph">{seg(pt)}</span>' for i, pt in enumerate(parts)))
    return '<br>'.join(out)
def items(lst):
    """(title, text) または (title, text, href, label) — 4要素のときは項目の下にリンク（.go）を付ける"""
    out = []
    for it in lst:
        t, p = it[0], it[1]
        link = f'<a class="go" href="{it[2]}">{it[3]}</a>' if len(it) > 3 else ''
        out.append(f'            <div class="item"><h3>{t}</h3><p>{p}</p>{link}</div>')
    return '<div class="items reveal">\n' + '\n'.join(out) + '\n          </div>'
def fold(t, p, href='', label=''):
    """たたんだ項目（details）。見出しだけが並び、タップで本文が開く。固定文の項目には使わない（受入検証は .item p の描画文を読む）"""
    link = f'<a class="go" href="{href}">{label}</a>' if href else ''
    return f'            <details class="item fold"><summary><h3>{t}</h3></summary><div class="fold-body"><p>{p}</p>{link}</div></details>'
def items_fold(lst, open_n, open_idx=()):
    """先頭 open_n 件（と open_idx の番号）は開いたまま、残りはたたむ"""
    out = []
    for i, it in enumerate(lst):
        t, p = it[0], it[1]
        if i < open_n or i in open_idx:
            link = f'<a class="go" href="{it[2]}">{it[3]}</a>' if len(it) > 3 else ''
            out.append(f'            <div class="item"><h3>{t}</h3><p>{p}</p>{link}</div>')
        else:
            out.append(fold(t, p, it[2] if len(it) > 3 else '', it[3] if len(it) > 3 else ''))
    return '<div class="items reveal">\n' + '\n'.join(out) + '\n          </div>'
def groups(lst):
    """提供パッケージごとに項目を束ねる。束の見出しと 1 行は常に見え、項目はたたむ（押すと本文）。lst: [(束の見出し, 1 行, [(h3, p[, href, label]), ...]), ...]"""
    out = []
    for title, line, items in lst:
        folds = '\n'.join(fold(it[0], it[1], it[2] if len(it) > 3 else '', it[3] if len(it) > 3 else '') for it in items)
        out.append(f'            <div class="group"><p class="g-head"><b>{title}</b><span>{line}</span></p>\n{folds}\n            </div>')
    return '<div class="groups reveal">\n' + '\n'.join(out) + '\n          </div>'
def more(href, label):
    """セクション末尾の次の一歩（相談する →）"""
    context = ' data-consult-page' if href == 'contact.html' else ''
    return f'\n          <p class="more reveal"><a class="go" href="{href}"{context}>{label}</a></p>'
def steps(lst, cls=''):
    return f'<div class="steps{" " + cls if cls else ""} reveal">\n' + '\n'.join(f'            <div class="step"><span class="n">{n}</span><h3>{t}</h3>{("<p>" + p + "</p>") if p else ""}</div>' for n, t, p in lst) + '\n          </div>'
def cta(text, href='contact.html', primary=True):
    return f'<div class="ctas reveal"><a class="btn{" primary" if primary else ""}" href="{href}">{text}</a></div>'
def section(id_, eyebrow, h2, lead, body):
    lead_html = f'<p class="lead">{lead}</p>' if lead else ''
    return f'''    <section class="section" id="{id_}">
      <div class="wrap"><div class="section-text">
          <div class="head reveal"><p class="eyebrow">{eyebrow}</p><h2>{h2}</h2>{lead_html}</div>
          {body}
      </div></div>
    </section>
'''
def title_chapter(word, eyebrow, h1, lead, lead_cls='lead', lead2=''):
    """lead2: 既決の導入文（lead）を変えずに、その下へ加える 2 行目（2026-10-26 正本 §10: /creator の冒頭）"""
    actions = {
        'Creator': [('index.html#map', '地図をつくる'), ('manual.html', 'マニュアルをつくる')],
        'Creative': [('#services', '依頼できること'), ('#guard', '仕事の流れを見る')],
        'AI': [('#products', '3つの製品を見る'), ('contact.html', '相談する')],
        'Consensus': [('#offer', '提供の形を見る'), ('contact.html', '相談する')],
    }.get(word, [])
    action_html = '<div class="hero-actions">' + ''.join(
        f'<a class="hero-action{" secondary" if n else ""}" href="{href}"'
        + (' data-consult-page' if href == 'contact.html' else ' data-open-check' if href == '#decide' else '')
        + f'>{label}<span aria-hidden="true"></span></a>' for n, (href, label) in enumerate(actions)
    ) + '</div>' if actions else ''
    return f'''    <section class="chapter page-head" id="top">
      <div class="wrap chapter-stack">
        {slot(word, halo=True)}
        <div class="head copy"><p class="eyebrow">{eyebrow}</p><h1 class="page-title">{h1}</h1>{('<p class="' + lead_cls + '">' + lead + '</p>') if lead else ''}{('<p class="lead lead2">' + lead2 + '</p>') if lead2 else ''}{action_html}</div>
      </div>
    </section>
'''

# 事業内容（2026-09-27 CEO 指示: クリエイターエコノミー市場・AI市場を中核とする事業者として。不動産・リユースは記載しない）
BIZ = (
    '<p class="biz-lead">' + jp('''クリエイターエコノミーとAIの交点に、
人とAIが共に価値を生む|事業基盤を築く。
国内から世界へ、|次の10年の標準をつくる。''') + '</p>\n'
    '            <ul class="biz">\n'
    '              <li><span class="k">クリエイターエコノミー事業</span><span class="v">' + jp('''個人の創造性と影響力を、|持続する経済価値へ。
発掘から育成、収益化までを|一体で設計・運営する。''') + '</span></li>\n'
    '              <li><span class="k">エンタープライズ事業</span><span class="v">' + jp('''企業のサイト、ブランド、映像、|SNSの発信と運用、|仕事の仕組みづくり。
伝え方の設計から、|表現と広告の確認まで|一貫して担う。''') + '</span></li>\n'
    '              <li><span class="k">AIプラットフォーム事業</span><span class="v">' + jp('''AIを安心して仕事に使うための|自社の仕組み「REYZ PLATFORM」を提供する。
複数のAIを組み合わせ、|確かめ、人が決め、
あとから見返せる形で|仕事を進める。''') + '</span></li>\n'
    '            </ul>')
ADDR_TOKYO = jp('〒150-0013\n東京都渋谷区|恵比寿1丁目19-19\n恵比寿ビジネスタワー10階')
ADDR_SAPPORO = jp('〒060-0042\n北海道札幌市中央区|大通西11丁目4番19号\n大通藤井ビル10F')
ADDR_FUKUOKA = jp('〒812-0018\n福岡県福岡市博多区|住吉2丁目16-28\nサヴィルロウ博多2F')
PROFILE = f'''<dl class="profile">
            <div class="row"><dt>社名</dt><dd>株式会社レイズ <span class="en">REYZ Inc.</span></dd></div>
            <div class="row"><dt>代表取締役</dt><dd>堀内智一</dd></div>
            <div class="row"><dt>創業</dt><dd>2022年1月</dd></div>
            <div class="row"><dt>資本金</dt><dd>1,000万円</dd></div>
            <div class="row wide"><dt>所在地</dt><dd><div class="offices">
              <div class="office is-hq"><span class="city"><span class="en">Tokyo</span><span class="jp">東京</span><span class="hq">本社</span></span><address>{ADDR_TOKYO}</address><a class="maplink" href="https://www.google.com/maps/search/?api=1&amp;query=%E6%9D%B1%E4%BA%AC%E9%83%BD%E6%B8%8B%E8%B0%B7%E5%8C%BA%E6%81%B5%E6%AF%94%E5%AF%BF1%E4%B8%81%E7%9B%AE19-19%20%E6%81%B5%E6%AF%94%E5%AF%BF%E3%83%93%E3%82%B8%E3%83%8D%E3%82%B9%E3%82%BF%E3%83%AF%E3%83%BC" target="_blank" rel="noopener">地図で開く</a></div>
              <div class="office"><span class="city"><span class="en">Sapporo</span><span class="jp">札幌</span></span><address>{ADDR_SAPPORO}</address><a class="maplink" href="https://www.google.com/maps/search/?api=1&amp;query=%E5%8C%97%E6%B5%B7%E9%81%93%E6%9C%AD%E5%B9%8C%E5%B8%82%E4%B8%AD%E5%A4%AE%E5%8C%BA%E5%A4%A7%E9%80%9A%E8%A5%BF11%E4%B8%81%E7%9B%AE4%E7%95%AA19%E5%8F%B7%20%E5%A4%A7%E9%80%9A%E8%97%A4%E4%BA%95%E3%83%93%E3%83%AB" target="_blank" rel="noopener">地図で開く</a></div>
              <div class="office"><span class="city"><span class="en">Fukuoka</span><span class="jp">福岡</span></span><address>{ADDR_FUKUOKA}</address><a class="maplink" href="https://www.google.com/maps/search/?api=1&amp;query=%E7%A6%8F%E5%B2%A1%E7%9C%8C%E7%A6%8F%E5%B2%A1%E5%B8%82%E5%8D%9A%E5%A4%9A%E5%8C%BA%E4%BD%8F%E5%90%892%E4%B8%81%E7%9B%AE16-28%20%E3%82%B5%E3%83%B4%E3%82%A3%E3%83%AB%E3%83%AD%E3%82%A6%E5%8D%9A%E5%A4%9A" target="_blank" rel="noopener">地図で開く</a></div>
            </div></dd></div>
            <div class="row wide"><dt>事業内容</dt><dd>{BIZ}</dd></div>
            <div class="row wide"><dt>許認可</dt><dd><span class="lic"><span>宅地建物取引業免許</span>東京都知事（1）第110185</span><span class="lic"><span>古物商許可</span>東京都公安委員会 第303312620413</span></dd></div>
          </dl>'''

# 既決の文（2026-09-27 CEO 指定。1 文字も変えない）。/creator と Home 章 3（LIVE を選んだときの注記）が共有する
TT_P1 = jp('''TikTok正規一次代理店として、
ライブ初心者から|収益化までを支援します。''')
TT_P2 = jp('''費用・ノルマ・ペナルティなどは|一切なく、
ギフト報酬は100%還元致します。''')
TT_NOTE = jp('''※私達は、TikTok社から委託を受けて|運営しているため、
ライバーさんの収益から|手数料を搾取する|モデルではありません。''')

# ------------------------------------------------------------------ HOME 章 3「あなたの地図」（正本 §10 クリエイターの枝・§13 企業の枝、2026-10-26）
# 選択肢は HTML、結果の文は site.js の MAP_TEXT（正本の文をそのまま）。この内容で相談する → contact.html（ご用件と内容を引き継ぐ）
MAP_Q = [
    ('who',   'all',     'あなたは',          [('creator', 'クリエイター'), ('company', '企業')]),
    ('goal',  'creator', 'やりたいことは',          [('yes', '決まっている'), ('no', 'まだ探している')]),
    ('place', 'creator', '配信や投稿をする場所は',  [('yes', '決まっている'), ('no', 'まだ')]),
    ('style', 'creator', '主にやりたいのは',        [('live', 'ライブ配信'), ('post', '動画や投稿')]),
    ('make',  'creator', '企画・撮影・編集は',      [('share', '手伝ってほしい'), ('own', '自分でできる')]),
    ('value', 'creator', '近いのは',                [('last', '目標が変わっても続けたい'), ('start', 'まず始めたい')]),
    ('goal',  'company', '目的は',                  [('yes', '決まっている'), ('no', 'まだ整理できていない')]),
    ('focus', 'company', '力を入れたいのは',        [('media', '映像・SNS'), ('ops', '業務の効率化・AI'), ('abroad', '海外への販売・発信')]),
    ('first', 'company', '最初に整えたいのは',       [('law', '公開前のチェック（表現・法令）'), ('speed', '速さと、少ない人数で回す体制')]),
]
def mapper():
    qs = []
    for q, aud, prompt, opts in MAP_Q:
        qid = f'mq-{aud}-{q}'
        btns = ''.join(f'<button type="button" class="opt" data-v="{v}" aria-pressed="false">{html.escape(l)}</button>' for v, l in opts)
        qs.append(f'            <div class="mq" role="group" aria-labelledby="{qid}" data-q="{q}" data-for="{aud}"{"" if aud == "all" else " hidden"}><p class="q" id="{qid}">{prompt}</p><div class="opts">{btns}</div></div>')
    return ('          <div class="mapper reveal" id="mapper">\n' + '\n'.join(qs) + '\n'
            '            <div class="map-card" id="mapCard" hidden>\n'
            '              <div class="sheet-head"><p class="eyebrow">Your map · 進め方の見本</p></div>\n'
            # 地図そのもの: 3 つの点（今いる場所 → 最初の一歩 → 目的）を 1 本の線が結ぶ。線は site.js が点の位置から引く（正本 §10・§13「3 つの点が線で結ばれる軌道」）
            '              <div class="route" id="mapRoute">\n'
            '                <svg class="route-svg" aria-hidden="true" focusable="false"><path id="routePath" class="route-line" d="M0 0"/><circle class="route-pulse" r="3"><animateMotion dur="6s" repeatCount="indefinite" calcMode="linear"><mpath href="#routePath"/></animateMotion></circle></svg>\n'
            '                <dl class="map-rows">\n'
            '                  <div class="node"><dt><span class="dot" aria-hidden="true"></span>今いる場所</dt><dd id="mapPlace"></dd></div>\n'
            '                  <div class="node"><dt><span class="dot" aria-hidden="true"></span>最初の一歩</dt><dd id="mapStep"></dd></div>\n'
            '                  <div class="node goal"><dt><span class="dot" aria-hidden="true"></span>目的</dt><dd id="mapGoal"></dd></div>\n'
            '                </dl>\n'
            '              </div>\n'
            f'              <p class="map-note" id="mapNoteLive" hidden>{TT_NOTE}</p>\n'
            # 地図を言葉で深める（REYZ CONSENSUS の入口。docs/consensus-entry.md）: 入口 Worker（/api/consensus）が応答できるときだけ site.js が表示する。
            # 応答がなければこのブロックは隠れたまま＝地図は選択だけで完結する（Fail-Closed）。AI は地図の言葉を整えて返すだけで、決めるのは本人。相談へ進むのも本人
            '              <div class="talk" id="mapTalk" hidden>\n'
            '                <p class="talk-lead">' + jp('この地図を、|あなたの言葉で。') + '</p>\n'
            '                <div class="talk-log" id="talkLog" role="log" aria-live="polite"></div>\n'
            '                <form class="talk-form" id="talkForm" novalidate>\n'
            '                  <label class="sr-only" for="talkInput">地図について、ひとこと</label>\n'
            '                  <input id="talkInput" type="text" maxlength="400" autocomplete="off" enterkeyhint="send" placeholder="例：週3回、半年は続けたい">\n'
            '                  <button type="submit" class="btn primary talk-send" id="talkSend">送る</button>\n'
            '                </form>\n'
            '                <p class="talk-note" id="talkNote" role="status" aria-live="polite" hidden></p>\n'
            '              </div>\n'
            # 地図 → 3 つの画面（その人の枝のページの見本へ。地図はそのまま 1 画面目に入る）→ 相談、とつながる
            '              <p class="more tight"><a class="go" id="mapScreens" href="creator.html#model">この地図で、3つの画面へ</a></p>\n'
            '              <div class="ctas tight"><a class="btn primary" id="mapGo" href="contact.html">この内容で相談する</a><button type="button" class="btn" id="mapReset">最初から</button></div>\n'
            '            </div>\n'
            '          </div>')
MAPPER = mapper()

# ------------------------------------------------------------------ HOME 章「AI」の道具「確認」: 提供元の異なる複数の AI が確かめ → 人が はい／いいえ → 記録。一致しなければ止まる。
# 文で説明せず、仕組みそのものを目の前で動かす（2026-10-26 CEO「表現で解決せよ」）。数字は事実の範囲（通し番号 517・2026-10-23 時点）だけ。
def check_inst():
    lanes = ''.join('                <div class="lane"><span class="dot ai" aria-hidden="true"></span><span class="lbl">AI</span><span class="wire" aria-hidden="true"></span><span class="mark" aria-hidden="true"></span></div>\n' for _ in range(3))
    ticks = ''.join('<i></i>' for _ in range(48))
    return ('          <div class="check reveal" data-run="">\n'
            '            <div class="check-lanes">\n' + lanes +
            '            </div>\n'
            '            <div class="check-human">\n'
            '              <span class="dot human" aria-hidden="true"></span><span class="lbl">人が決める</span>\n'
            '              <span class="yn" aria-hidden="true"><span class="pill yes">はい</span><span class="pill">いいえ</span></span>\n'
            '              <p class="cap cap-stop">' + jp('一致しないものは、|止まる。') + '</p>\n'
            '            </div>\n'
            '            <div class="check-rec">\n'
            '              <span class="lbl">記録</span><span class="ticks" aria-hidden="true">' + ticks + '</span>\n'
            '            </div>\n'
            '          </div>')
CHECK = check_inst()
# ------------------------------------------------------------------ HOME 章 2「ひとつの意志から。」: 決定済みの事業構造を 1 つの図で
# 事業内容 3 本柱（2026-09-27 CEO）＝ クリエイターエコノミー事業（クリエイター正本 §3-1: 地図・入口・明細）／AIプラットフォーム事業（REYZ PLATFORM: 複数の AI が確かめ、人が決め、記録）／
# エンタープライズ事業（企業正本 §3-1: 地図・確認・記録）。両者は裏表で、確認を通った案件と商品だけが企業からクリエイターへ届く（両正本 §0）。各段がその事業のページへの入口。
def structure():
    def node(cls, href, who, scr, what, go):
        return (f'            <a class="node {cls}" href="{href}"><span class="who">{who}</span><span class="scr">{scr}</span>'
                f'<span class="what">{what}</span><span class="go">{go}</span></a>\n')
    link = '            <span class="link" aria-hidden="true"><i class="pulse up"></i><i class="pulse down"></i></span>\n'
    return ('          <div class="structure reveal">\n'
            + node('creator', 'creator.html', 'クリエイター', '地図 ・ 入口 ・ 明細', jp('活動と収入を、|3つの画面で。'), 'クリエイターの方へ')
            + link
            + node('reyz', 'ai.html', 'REYZ PLATFORM', 'AI ・ 人が決める ・ 記録', jp('複数のAIが確かめ、|人が決め、記録が残る。'), 'AIについて')
            + link
            + node('company', 'creative.html', '企業', '地図 ・ 確認 ・ 記録', jp('発信と判断を、|3つの画面で。'), '企業の方へ')
            + '          </div>\n'
            '          <p class="structure-cap reveal">' + jp('確認を通った案件と商品だけが、|企業からクリエイターへ届く。') + '</p>')
STRUCTURE = structure()
# ------------------------------------------------------------------ HOME
# 初画面の一言: 事業内容 3 本柱（既決）を、クリエイター／企業／AI の順に同じ形で 1 行ずつ（2026-10-27 CEO「同じ形・同じ分量」「決定した事業構造を把握した上で」）
home = f'''    <section class="chapter" id="infinity">
      <div class="wrap chapter-stack">
        <div class="brand-film" data-brand-film><video id="brandFilm" data-brand-video data-src="assets/brand/infinity-motion.mp4" poster="assets/brand/infinity-motion.webp" width="1280" height="720" muted loop playsinline preload="none" aria-hidden="true"></video><button class="video-toggle" data-brand-toggle aria-controls="brandFilm" aria-pressed="false" hidden type="button">映像を再生</button></div>
        <div class="head copy">
          <h1><span>無限の可能性を</span><span>かたちに</span></h1>
          <p class="hero-sub">From Japan, <em>beyond.</em></p>
          <p class="lead hero-lead"><a class="hero-route" href="creator.html">{jp('クリエイターの創造性を、|続く収入に。')}</a><br><a class="hero-route" href="creative.html">{jp('企業の発信を、|設計から確認まで。')}</a><br><a class="hero-route" href="ai.html">{jp('AIを、|安心して仕事に使える形に。')}</a></p>
          <a class="cue" href="#origin" aria-label="下へ"><span class="cue-line"></span><span class="cue-dot"></span></a>
        </div>
      </div>
    </section>
    <section class="chapter" id="origin">
      <div class="wrap chapter-stack">
        {slot('seed')}
        <div class="copy wide">
          <div class="head"><h2>ひとつの意志から。</h2></div>
{STRUCTURE}
        </div>
      </div>
    </section>
    <section class="chapter" id="map">
      <div class="wrap chapter-stack">
        {slot('map')}
        <div class="copy wide">
          <div class="head"><p class="eyebrow">Your map</p><h2>あなたの地図を、<br>ここで。</h2><p class="lead">{jp('いくつかの問いに答えると、|あなたの地図ができます。')}</p></div>
{MAPPER}
          <noscript><p class="lead">{jp('この体験はJavaScriptが有効な環境で動きます。')}<br><a href="creator.html">クリエイターの方へ</a>　<a href="creative.html">企業の方へ</a></p></noscript>
        </div>
      </div>
    </section>
    <section class="chapter" id="reyz">
      <div class="wrap chapter-stack">
        {slot('REYZ')}
        <div class="copy">
          <div class="head">
            <p class="eyebrow">Company</p>
            <h2 class="sr-only">会社情報</h2>
          </div>
          {PROFILE}
        </div>
      </div>
    </section>
'''
page('index.html', 'REYZ Inc. — 無限の可能性を かたちに', '株式会社レイズ（REYZ Inc.）— Creator Economy × AI。クリエイターの活動と企業の成長を支え、AIを安心して仕事に使える仕組みを提供する会社です。', home, current='index.html')

# ------------------------------------------------------------------ CREATOR
def editorial_film(kind, headline, line):
    """One actual film, with its editorial copy and visible source beside it."""
    is_creator = kind == 'creator'
    prefix = 'creator' if is_creator else 'production'
    asset = 'creator-film' if is_creator else 'production-editorial-20261119'
    disclosure = 'イメージ映像' if is_creator else '制作のイメージ映像（AI生成）'
    credit = 'Footage: cottonbro studio / Pexels' if is_creator else 'REYZ / Original visual'
    label = 'CREATOR / YOUR OWN WAY' if is_creator else 'CREATIVE / FROM INTENT TO IMPACT'
    return f'''<figure class="editorial-visual is-{prefix} reveal" data-editorial>
      <div class="editorial-film">
        <video id="{prefix}Film" data-editorial-video data-src="assets/editorial/{asset}.mp4" poster="assets/editorial/{asset}.webp" width="1280" height="674" muted loop playsinline preload="none" aria-hidden="true"></video>
        <button class="video-toggle" type="button" data-editorial-toggle aria-controls="{prefix}Film" aria-pressed="false" hidden>映像を再生</button>
      </div>
      <div class="editorial-film-copy"><span class="tag">{label}</span><h3>{headline}</h3><p>{line}</p></div>
      <figcaption id="{prefix}Caption" class="editorial-caption"><span>{disclosure}</span><span>{credit}</span></figcaption>
    </figure>'''

# 本文の改行は本人指定（2026-09-27）。'|' は画面幅が足りない時だけ使う折返し点。TT_P1・TT_P2・TT_NOTE は HOME の前で定義
VD_H3 = jp('動画・映像制作[（PR・PV・MV・|ドキュメンタリー・ドラマ）]')
VD_P = jp('''インフルエンス力向上、ブランド化、リブランディングなど、
それぞれが抱える|現状の課題や目的を明確にし、
その目的を実現させるための企画、撮影、編集までを、
自社ですべて行います。''')
# 2026-10-26 正本 §10: 冒頭の 2 行目、困りごと 4 件目、仕組み（費用ゼロ・手数料ゼロ・やめるのも自由、お金の流れ、3 つの画面の見本）、提供することの追加 5 項目。
# 公開サイトでは「所属」「退所」を使わない（2026-09-26 CEO）ので、正本の文は「費用はかからない。やめるのも自由。」の形にする
MODEL = ('<div class="model reveal">\n'
    '            <ul class="vows"><li>費用ゼロ。</li><li>' + jp('報酬からの|手数料ゼロ。') + '</li><li>' + jp('やめるのも|自由。') + '</li></ul>\n'
    # お金の流れ（正本 §8「原資の図」）: 動くのは プラットフォーム・企業 → REYZ の線だけ。あなた → REYZ の線には何も流れない（0 円）
    '            <div class="fund flowmap">\n'
    '              <div class="flow"><span class="from">' + jp('プラットフォーム・|企業') + '</span><span class="fl-lane" aria-hidden="true"><i></i><i></i><i></i></span><span class="to">REYZ</span><span class="what">報酬・利用料</span></div>\n'
    '              <div class="flow zero"><span class="from">あなた</span><span class="fl-lane" aria-hidden="true"></span><span class="to">REYZ</span><span class="what">0円</span></div>\n'
    '              <p class="fund-cap">' + jp('REYZの収入は、プラットフォームと企業から。|あなたからは、取らない。') + '</p>\n'
    '            </div>\n'
    '            <details class="terms">\n'
    '              <summary class="terms-head">はっきり決めていること</summary>\n'
    '              <ul>\n'
    '                <li>' + jp('活動が続く限り、無料。|休むときは、待ちます。') + '</li>\n'
    '                <li>' + jp('目標を課しません。') + '</li>\n'
    '                <li>' + jp('違約金なし。|他の仕事を制限しません。|やめた後の配信も制限しません。') + '</li>\n'
    '                <li>' + jp('あとから条件を悪くしません。') + '</li>\n'
    '                <li>' + jp('直販のクリエイター手数料は0%。|購入時の利用料は買う人に明示し、|使うかはあなたが選びます。|売上ゼロなら、課金ゼロ。') + '</li>\n'
    '                <li>' + jp('記録はあなたのもの。|いつでも持ち出せます。') + '</li>\n'
    '              </ul>\n'
    '            </details>\n'
    '          </div>')
# 3 つの画面を 1 台で触る見本（正本 §3-1。2026-10-27 CEO「体験イメージを持てるか」）: Home で作った地図がそのまま入り、入口で「受ける」と明細に並ぶ。
# 文は正本のまま（地図の見本文は MAP_TEXT と同じ）。架空の名前・社名・金額は置かない。JS なしでも 3 画面が縦に並んで読める
def demo_tabs(prefix, keys):
    return ('              <div class="tabs" role="tablist" aria-label="3つの画面">' +
            ''.join(f'<button class="tab" role="tab" type="button" id="{prefix}T{n}" aria-controls="{prefix}P{n}" aria-selected="{"true" if n == 1 else "false"}"{"" if n == 1 else " tabindex=\"-1\""} data-t="{k}"><span class="tl">{label}<i class="n" hidden></i></span></button>'
                    for n, (k, label) in enumerate(keys, 1)) + '</div>\n')
def demo_pane(prefix, n, key, inner):
    return (f'                <div class="pane{" is-on" if n == 1 else ""}" id="{prefix}P{n}" role="tabpanel" aria-labelledby="{prefix}T{n}" data-p="{key}" tabindex="-1"{"" if n == 1 else " hidden"}>\n{inner}'
            '                </div>\n')
def demo_map(prefix, place, step, goal, nxt, label, cap=''):
    return ((f'                  <p class="pane-cap">{cap}</p>\n' if cap else '') +
            '                  <div class="scr-map big"><span class="scr-line"></span>'
            f'<div class="scr-node"><i></i><b>今いる場所</b><span id="{prefix}Place">{place}</span></div>'
            f'<div class="scr-node"><i></i><b>最初の一歩</b><span id="{prefix}Step">{step}</span></div>'
            f'<div class="scr-node goal"><i></i><b>目的</b><span id="{prefix}Goal">{goal}</span></div></div>\n'
            f'                  <p class="pane-note" id="{prefix}From" hidden></p>\n'
            f'                  <a class="pane-link" id="{prefix}Home" href="index.html#map">ホームで、あなたの地図をつくる →</a>\n'
            f'                  <button class="go-btn" type="button" data-next="{nxt}">{label}</button>\n')
SCREENS_CREATOR = ('<div class="screens3 reveal">\n'
    '            <div class="sheet-head"><p class="eyebrow">地図・入口・明細</p><p class="echo" aria-hidden="true">地図から、始める。</p></div>\n'
    '            <p class="sample-disclosure">操作の見本です。受注・契約・支払いは行われません。</p>\n'
    '            <div class="demo" id="demoC" data-demo="creator">\n' + demo_tabs('dc', [('map', '地図'), ('gate', '入口'), ('stmt', '明細')]) +
    '              <div class="phone big"><div class="phone-screen"><div class="phone-bar" aria-hidden="true"><i></i><i></i></div>\n' +
    demo_pane('dc', 1, 'map', demo_map('dm', '場所は決まっている。費用ゼロのLIVE支援と、商品紹介・案件を重ねる段階。', 'どこで、何を、いつ出すかをAIと一緒に決める。', '言葉にできている目的を、活動の順番にする。',
                                      'gate', 'この地図で、入口へ', cap=jp('どこで、何を、どの順で。|目標が変われば、引き直す。'))) +
    demo_pane('dc', 2, 'gate',
              '                  <p class="pane-cap">確認を通ったものだけが、届く。</p>\n'
              '                  <ul class="offers">'
              '<li class="offer"><div><b>案件</b><details class="offer-terms"><summary>確認する項目を見る</summary><dl><div><dt>制作物</dt><dd>新商品の紹介動画</dd></div><div><dt>利用範囲</dt><dd>媒体と期間を確認して合意</dd></div><div><dt>報酬</dt><dd>金額・支払日を確認して合意</dd></div><div><dt>REYZ手数料</dt><dd>報酬からの控除なし</dd></div></dl></details></div><button class="take" type="button" aria-pressed="false" data-k="案件" data-v="full">受ける</button></li>'
              '<li class="offer"><b>商品の紹介</b><button class="take" type="button" aria-pressed="false" data-k="商品の紹介" data-v="full">受ける</button></li>'
              '<li class="offer"><b>LIVE支援</b><button class="take" type="button" aria-pressed="false" data-k="LIVE支援" data-v="zero">受ける</button></li>'
              '</ul>\n'
              '                  <button class="go-btn" type="button" data-next="stmt">明細を見る</button>\n') +
    demo_pane('dc', 3, 'stmt',
              '                  <p class="pane-cap">' + jp('すべての収益の確定額と、記録。|あなたのもの。') + '</p>\n'
              '                  <ul class="stmt-rows" id="dmRows"><li class="empty">' + jp('入口で「受ける」と、|ここに並ぶ。') + '</li></ul>\n'
              '                  <div class="stmt-sum" id="dmSum" hidden><div class="scr-row"><b>報酬</b><span class="scr-bar full"><i></i></span><em>あなたへ</em></div><div class="scr-row"><b>手数料</b><span class="scr-bar"><i></i></span><em>0</em></div><div class="scr-row"><b>費用</b><span class="scr-bar"><i></i></span><em>0</em></div></div>\n'
              '                  <a class="go-btn consult" href="contact.html" data-consult="creator">この地図で、相談する</a>\n'
              '                  <button class="go-btn ghost" type="button" data-next="map" data-reset="1">最初から</button>\n') +
    '              </div></div>\n'
    '            </div>\n'
    '          </div>')
# 入口（正本 §4 の 6 収益源。§8「今すぐ書いてよい」の範囲: 費用ゼロ／報酬から取らない／直販手数料 0%／6 収益源を一つの窓口で）。
# 「再生数・成果連動の案件」「TikTok Shop パートナー」「100% 還元」は揃ってから（T13・T10・T1）なので書かない
INCOMES = ('<div class="income-experience reveal" data-income-experience><ol class="incomes">\n' + '\n'.join(
    f'            <li><button type="button" class="income-choice" data-income="{("live", "product", "campaign", "direct", "media", "ip")[n - 1]}" aria-pressed="{"true" if n == 1 else "false"}"><span class="n">{n:02d}</span><b>{k}</b><span class="v">{v}</span></button></li>'
    for n, (k, v) in enumerate([
        ('ライブ配信', jp('費用ゼロで、立ち上げから。|報酬から引かない。')),
        ('商品の紹介・販売', jp('確認を通ったブランド商品の紹介と、|LIVEでの販売。')),
        ('企業の案件', jp('確認を通った案件だけが、|入口に届く。')),
        ('ファンへの直販', jp('知識、作品、会員権を、あなたの価格で。|手数料は0%。')),
        ('広告・再生の収益', jp('あなたへ直接。|REYZは見える化だけ。')),
        ('映像・共同IP', jp('一緒につくる。|共同でつくったものだけを、共同所有。')),
    ], 1)) + '\n          </ol><div class="income-stage"><canvas class="income-canvas" aria-hidden="true"></canvas><a class="income-next" href="#services">提供すること<span aria-hidden="true">↗</span></a></div></div>')
# ------------------------------------------------------------------ 目的から道を選ぶ（2026-11-18 CEO「様々な収益活動の選択肢があることを認識させ、自分の目的に合わせて迷わずに進んでいける」）
# 入口の語は DEC-20261027-12 の 6 つのまま。金額・月収・人数は置かない（DEC-20261023-01）。JS なしでは全ての道が縦に並ぶ
PATH_GOALS = [
    ('income', 'まず、収入をつくりたい',
     [('ライブ配信', jp('今日から始められる入口。|費用はゼロ。')), ('商品の紹介・販売', jp('配信に、|紹介できる商品を重ねる。')), ('企業の案件', jp('続けた記録が、|案件の入口を開く。'))],
     jp('合う場所と時間を決め、|立ち上げから一緒に。')),
    ('fans', 'ファンと、長くつながりたい',
     [('ライブ配信', jp('顔が見える場所で、|関係をつくる。')), ('ファンへの直販', jp('知識、作品、会員権を、|あなたの価格で。')), ('映像・共同IP', jp('続いているものを、|一緒に作品にする。'))],
     jp('直販の入口と表記の確認を、|用意します。')),
    ('reach', '動画や投稿を、伸ばしたい',
     [('広告・再生の収益', jp('まず、見られる量を育てる。|収益はあなたへ直接。')), ('企業の案件', jp('確認を通った案件だけが、|届く。')), ('商品の紹介・販売', jp('見てくれる人に、|合う商品を。'))],
     jp('企画・撮影・編集を分け、|投稿前の表現を確かめます。')),
    ('own', '自分の知識や作品を、売りたい',
     [('ファンへの直販', jp('講座、作品、予約、会員権。|手数料は0%。')), ('広告・再生の収益', jp('発信で、|知ってもらう入口を広げる。')), ('映像・共同IP', jp('売れているものを、|次のかたちへ。'))],
     jp('価格と見せ方を、|最初の地図で一緒に決めます。')),
    ('open', 'まだ、決まっていない',
     [('地図をつくる', jp('いくつかの質問で、|今いる場所が分かる。')), ('入口を、ひとつ', jp('合う入口から、|小さく始める。')), ('重ねていく', jp('目標が変われば、|地図を引き直す。'))],
     jp('決まっていなくて構いません。|言葉にするところから。')),
]
PATHS = ('<div class="paths reveal" data-paths>\n'
    '            <div class="path-goals" role="group" aria-label="目的">' +
    ''.join(f'<button type="button" class="path-goal" data-goal="{k}" aria-pressed="{"true" if n == 0 else "false"}">{html.escape(label)}</button>' for n, (k, label, _, _) in enumerate(PATH_GOALS)) + '</div>\n' +
    '\n'.join(
        f'            <div class="path-card{" is-on" if n == 0 else ""}" data-goal="{k}"><p class="path-title">{html.escape(label)}</p><ol class="path-steps">' +
        ''.join(f'<li><span class="when">{w}</span><b>{t}</b><span class="v">{v}</span></li>' for w, (t, v) in zip(('はじめに', '次に', 'その先'), steps_)) +
        f'</ol><p class="path-reyz"><b>REYZがすること</b><span>{reyz}</span></p></div>'
        for n, (k, label, steps_, reyz) in enumerate(PATH_GOALS)) + '\n'
    '            <p class="path-cap">' + jp('入口は6つ。|ひとつから始めて、重ねていける。') + '</p>\n'
    '          </div>')
# One choice journey: income routes and the reader's goal, then terms and support.
creator = title_chapter('Creator', 'For Creators', '「生き方」を職業に。', 'あなたの活動を収入に変える設計を。',
                        lead2='あなたの収益の、全部の入口に。') + \
section('income', 'Your income', jp('6つの収益を、|ひとつの入口に。'), '',
        editorial_film('creator', 'あなたらしさが、<br>仕事になっていく。', '配信も、映像も、作品も。<br>自分に合う入口から、次の可能性へ。') + INCOMES +
        '<div class="income-path" id="path"><div class="head reveal"><p class="eyebrow">Your path</p><h3>' + jp('目的から、|道を選ぶ。') + '</h3>' +
        more('contact.html', 'この道で、はじめる') + '</div>' + PATHS + '</div>') + \
section('model', 'Terms &amp; screens', '条件を、先に。', '', MODEL + SCREENS_CREATOR) + \
section('services', 'Services', '提供すること', '',
        '<div class="items reveal">\n'
        '            <div class="item">\n'
        '              <h3>TikTok LIVEエージェンシー</h3>\n'
        f'              <p>{TT_P1}</p>\n'
        f'              <p>{TT_P2}</p>\n'
        f'              <p class="note">{TT_NOTE}</p>\n'
        '            </div>\n'
        '            <aside class="manual-entry" aria-labelledby="manualEntryTitle">\n'
        '              <div class="manual-entry-art" aria-hidden="true"><img src="assets/manual/cover.svg" alt="" width="540" height="960" loading="lazy"></div>\n'
        '              <div class="manual-entry-copy"><p class="eyebrow">Your live guide</p><h3 id="manualEntryTitle">配信マニュアル</h3><p>全42ページ。あなたの名前と色で。</p><a class="manual-entry-link" href="manual.html">マニュアルをつくる<span aria-hidden="true"> →</span></a></div>\n'
        '            </aside>\n'
        + fold(VD_H3, VD_P) + '\n'
        + fold('SNSアカウントの運用支援', jp('''投稿の計画、制作、分析、改善。
ライブ配信の企画と継続まで。''')) + '\n'
        + fold('AIと、最初の地図から', jp('''最初の相談で、地図を返します。
毎日の次の一手も、AIが材料を揃え、|決めるのはあなたです。''')) + '\n'
        '          </div>') + \
section('how', 'How to start', 'はじめ方', '',
        steps([('01', '相談', jp('''まずは現在の状況を伺います。
その上で、その人に合った|活動方法を共に考えます。''')),
               ('02', '設計', jp('''活動方法が決まったら、
いつから、何を、どのように進めていくか。
様々な視点から、戦略や計画を設計します。''')),
               ('03', '伴走', jp('''状況や状態を確認しながら、
目的実現に向けて|共に進んでいきます。'''))], cls='list') + more('contact.html', '相談する'))
page('creator.html', 'Creator — REYZ Inc.', 'REYZのクリエイター向けサービス。あなたに合う場所と順番を決め、TikTok LIVEエージェンシー、動画・映像制作、SNSアカウントの運用支援で、活動を収入に変える。目標が変わっても、続きます。', creator, styles=('assets/manual.css',))

# ------------------------------------------------------------------ MANUAL（名称・配色を選ぶ配信ガイド）
# docs/manual-download.md / ADR-0012。PDF生成は端末内、共通ナビと既決本文は維持。
manual = '''    <div class="manual-shell" id="manualBuilder">
      <a class="manual-back" href="creator.html"><span aria-hidden="true">←</span> クリエイターの方へ</a>
      <div class="manual-workspace">
        <section class="manual-editor" aria-labelledby="manualEditorTitle">
          <h2 class="sr-only" id="manualEditorTitle">名称と配色を選ぶ</h2>
          <form class="manual-form" id="manualForm" novalidate>
            <fieldset class="manual-options" id="manualOptions" disabled>
              <legend class="sr-only">マニュアルの設定</legend>
              <div class="manual-layout">
              <div class="manual-intro">
                <p class="eyebrow">TikTok LIVE guide</p>
                <h1>配信マニュアルを、<br>あなたの名前で。</h1>
                <p class="manual-lead">名前と色を選んで、スマホで読めるPDFに。</p>
                <ul class="manual-facts" aria-label="マニュアルの仕様"><li>42ページ</li><li>縦9:16</li><li>PDF</li></ul>
              </div>
              <div class="manual-field">
                <label class="manual-label" for="manualName"><span class="manual-number" aria-hidden="true">01</span> PDFに載せる名称</label>
                <input id="manualName" type="text" placeholder="例：REYZ" maxlength="48" required autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="manualNameHint manualError">
                <p class="manual-hint" id="manualNameHint">日本語・英数字で24文字まで</p>
              </div>
              <fieldset class="manual-colors">
                <legend class="manual-label"><span class="manual-number" aria-hidden="true">02</span> 色合いを選ぶ</legend>
                <div class="manual-palettes" id="manualPalettes"></div>
              </fieldset>
              <figure class="manual-preview" id="manualPreview">
                <figcaption><span>表紙プレビュー</span><span id="manualThemeLabel">ピンク</span></figcaption>
                <div class="manual-book"><div class="manual-cover-stage" id="manualCover" aria-busy="true"><div class="manual-cover-loading"><span>LIVE GUIDE</span><span>表紙を読み込んでいます</span></div></div></div>
                <button class="manual-read" id="manualRead" type="button">中を見る<span aria-hidden="true">↗</span></button>
                <p class="manual-preview-note" id="manualPreviewNote">名称と配色が、全ページに反映されます。</p>
              </figure>
              <div class="manual-generate-area">
                <button class="manual-generate" id="manualGenerate" type="submit"><span>PDFをダウンロード</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 15v5h14v-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></svg></button>
                <p class="manual-hint manual-private">入力した名称は、この画面の中だけで使います。</p>
              </div>
              </div>
            </fieldset>
            <p class="manual-error" id="manualError" role="alert"></p>
            <div class="manual-progress-wrap">
              <progress id="manualProgress" max="100" value="0" aria-label="PDF生成の進行状況" hidden></progress>
              <p class="manual-status" id="manualStatus" role="status" aria-live="polite"></p>
            </div>
          </form>
          <section class="manual-result" id="manualResult" aria-labelledby="manualResultTitle" hidden>
            <h2 class="manual-result-title" id="manualResultTitle">PDFができました。</h2>
            <p class="manual-result-detail" id="manualResultDetail"></p>
            <div class="manual-result-actions">
              <a class="manual-save" id="manualDownload">PDFを保存</a>
              <a class="manual-open" id="manualOpen">PDFを開く<span aria-hidden="true"> ↗</span></a>
              <button class="manual-share" id="manualShare" type="button" hidden>共有・ファイルに保存</button>
            </div>
            <p class="manual-hint">保存が始まらないときは「PDFを保存」をタップ。iPhoneではPDFを開き、共有メニューから「ファイルに保存」も選べます。</p>
          </section>
          <noscript><p class="manual-nojs">このマニュアルをつくるには、ブラウザのJavaScriptを有効にしてください。</p></noscript>
          <div class="manual-contents">
            <h2>配信のはじめ方から、<br>次の目標まで。</h2>
            <p>機材・ファンとのつながり・ギフト・バトル・イベント。配信に役立つ内容を、ひとつのマニュアルに。</p>
          </div>
        </section>
      </div>
      <dialog class="manual-reader" id="manualReader" aria-labelledby="manualReaderTitle">
        <div class="manual-reader-head"><h2 id="manualReaderTitle">マニュアルの中を見る</h2><button id="manualReaderClose" type="button" aria-label="プレビューを閉じる">閉じる<span aria-hidden="true">×</span></button></div>
        <div class="manual-reader-canvas"><div id="manualReaderPage"></div></div>
        <div class="manual-reader-footer"><button id="manualReaderPrev" type="button" aria-label="前のサンプルページ">←</button><p id="manualReaderCount"></p><button id="manualReaderNext" type="button" aria-label="次のサンプルページ">→</button></div>
        <p id="manualReaderStatus" role="status" aria-live="polite"></p>
      </dialog>
    </div>
'''
page('manual.html', '配信マニュアルをカスタマイズ — REYZ Inc.', '名称と6つの配色から選んで、42ページのTikTok LIVE配信マニュアルをPDFでダウンロード。スマホで読みやすい縦9:16。', manual, current='creator.html', styles=('assets/manual.css',), scripts=('assets/manual.js',), body_class='manual-body')

# ------------------------------------------------------------------ CREATIVE（エンタープライズ事業）
# 2026-11-18: 提供範囲 → 一案件の流れ → 実写 → 費用 → 相談。
# 実績のない作品例や数字は置かず、操作の見本とイメージ映像を明示する。
# 2026-10-26 正本 §13: 「The first sheet（一枚）」の節を、企業の 3 つの画面「地図・確認・記録」に置き換える（設計上の見本と明記）
# 確認を実際に通す見本（正本 §3-1・§11）: 投稿の例を選ぶ → 提供元の異なる複数の AI が確かめる → 一致しないものは止まる → 直して再確認 → 人が はい／いいえ → 記録に 1 行。
# 公的ガイドラインと自主基準への照合の例であり、法律の鑑定ではない（正本 §11「今すぐ書いてよい」の添え書き）
SCREENS_ENT = ('<div class="screens3 reveal">\n'
    '            <div class="sheet-head"><p class="eyebrow">地図・確認・記録</p><p class="cap">' + jp('公的なきまりと自主基準への|照合の例。|法律の鑑定ではありません。') + '</p><p class="echo" aria-hidden="true">目的から、逆算。</p></div>\n'
    '            <p class="sample-disclosure">表現の確認を体験する見本です。実際の複数AIによる審査や、公開・契約・支払いは行いません。</p>\n'
    '            <div class="demo" id="demoE" data-demo="company" data-run="">\n' + demo_tabs('de', [('map', '地図'), ('check', '確認'), ('rec', '記録')]) +
    '              <div class="phone big"><div class="phone-screen"><div class="phone-bar" aria-hidden="true"><i></i><i></i></div>\n' +
    demo_pane('de', 1, 'map', demo_map('dn', '事業と表現をつなぐ段階。映像制作・SNS運用と、クリエイターとの販売設計を重ねる。', '公開前に広告表現のルールに照らして確認する流れを組み込み、判断の材料を揃える。', '決まっている目的から逆算し、最短で届く手段と順番を決める。',
                                      'check', 'この地図で、確認へ', cap=jp('目的から逆算した、進め方と判断の材料。|「はい」か「いいえ」で決める。'))) +
    demo_pane('de', 2, 'check',
              '                  <p class="pane-cap">' + jp('公開前に、表現を確かめる。|投稿の例を、ひとつ選ぶ。') + '</p>\n'
              '                  <div class="samples" role="group" aria-label="投稿の例">'
              '<button class="sample" type="button" aria-pressed="false" data-s="pr">#PR をつけた、新商品の紹介</button>'
              '<button class="sample" type="button" aria-pressed="false" data-s="no1">「業界No.1」と書いた紹介</button>'
              '<button class="sample" type="button" aria-pressed="false" data-s="cure">「必ず効く」と書いた紹介</button>'
              '</div>\n'
              '                  <div class="post" id="dePost" hidden><span class="pv" aria-hidden="true"></span><div class="pl"><b class="ph" id="dePhrase"></b><span class="pfix" id="deFixed" hidden></span><i aria-hidden="true"></i><i aria-hidden="true"></i></div></div>\n'
              '                  <div class="check-lanes" id="deLanes" hidden>' + ''.join('<div class="lane"><span class="dot ai" aria-hidden="true"></span><span class="lbl">AI</span><span class="wire" aria-hidden="true"></span><span class="mark" aria-hidden="true"></span></div>' for _ in range(3)) + '</div>\n'
              '                  <p class="verdict" id="deVerdict" aria-live="polite" hidden><b id="deV"></b><span id="deWhy"></span></p>\n'
              '                  <button class="go-btn" type="button" id="deFix" hidden>直して、もう一度確かめる</button>\n'
              '                  <div class="human" id="deHuman" hidden><span class="lbl">人が決める</span><button class="go-btn yes" type="button" data-d="はい">はい</button><button class="go-btn ghost" type="button" data-d="いいえ">いいえ</button></div>\n') +
    demo_pane('de', 3, 'rec',
              '                  <p class="pane-cap">' + jp('決定ごとの記録。|企業のもので、持ち出せる。') + '</p>\n'
              '                  <ol class="rec-rows" id="deRec"><li class="empty">' + jp('確認で「はい」か「いいえ」を押すと、|ここに残る。') + '</li></ol>\n'
              '                  <a class="go-btn consult" href="contact.html" data-consult="company">この地図で、相談する</a>\n'
              '                  <button class="go-btn ghost" type="button" data-next="check" data-reset="1">もう一つ、確かめる</button>\n') +
    '              </div></div>\n'
    '            </div>\n'
    '            <details class="terms">\n'
    '              <summary class="terms-head">はっきり言えること</summary>\n'
    '              <ul>\n'
    '                <li>' + jp('公的なきまりと自主基準に照らして確かめ、|判断の材料を渡します。') + '</li>\n'   # 「法律の鑑定ではありません」は直上の添え書き（cap）が言う
    '                <li>' + jp('提供元の異なる複数のAIが確かめ、|一致しないものは止まります。|後戻りできない決定は、|人が「はい」か「いいえ」で決めます。') + '</li>\n'
    '                <li>' + jp('決定ごとの記録を残し、|企業が持ち出せます。') + '</li>\n'
    '                <li>' + jp('クリエイターの報酬から取りません。|報酬はREYZの口座を通しません。') + '</li>\n'
    '                <li>' + jp('自社ブランドでの提供も、|いまの仕組みへの組み込みもできます。') + '</li>\n'
    '              </ul>\n'
    '            </details>\n'
    '          </div>')
# ------------------------------------------------------------------ 人を増やさずに、利益を残す（2026-11-18 CEO「コスパが良くなり、利益率が上がり…業務負担が軽減されることを直感的に」）
# 数字は読み手が自分で入れる。REYZ 側の数字は利用料だけ（月額 50,000 円・20 本まで／21 本目から 1 本 1,250 円／公開前の確認は月 30 件まで無料）。
# 短くなる時間は約束しない: 「1 本あたり何分短くなれば元が取れるか」を計算して見せる（損益分岐）。初期値 30 本・60 分・5,000 円 → 月 30 時間・150,000 円、利用料 62,500 円、25 分
GAIN = ('<div class="gain reveal" data-gain>\n'
    '            <div class="gain-in">\n'
    '              <div class="gain-f"><label for="gainN">月に出す本数</label><output id="gainNo" for="gainN">30本</output><input type="range" id="gainN" min="5" max="100" step="5" value="30"></div>\n'
    '              <div class="gain-f"><label for="gainM">1本あたりの確認と管理</label><output id="gainMo" for="gainM">60分</output><input type="range" id="gainM" min="10" max="120" step="5" value="60"></div>\n'
    '              <div class="gain-f"><label for="gainW">担当者の1時間あたりの費用</label><output id="gainWo" for="gainW">5,000円</output><input type="range" id="gainW" min="2000" max="10000" step="500" value="5000"></div>\n'
    '            </div>\n'
    '            <dl class="gain-out" aria-live="polite">\n'
    '              <div class="now"><dt>いま、確認と管理に</dt><dd id="gainNow">月30時間・150,000円</dd></div>\n'
    '              <div class="fee"><dt>この料金条件での月額</dt><dd id="gainFee">月62,500円</dd></div>\n'
    '              <div class="even"><dt>利用料に相当する削減時間</dt><dd id="gainEven">' + jp('1本あたり25分、|短くなったとき') + '</dd></div>\n'
    '            </dl>\n'
    '            <p class="gain-cap">' + jp('月額50,000円で、20本まで。|21本目からは、1本1,250円。\n公開前の確認は、|月30件まで無料です。') + '</p>\n'
    '            <p class="gain-disclosure">入力した時間・費用と上記の利用料を比べる試算です。実際の削減効果を示すものではありません。</p>\n'
    '            <details class="terms gain-terms"><summary class="terms-head">料金に含まれる範囲を、確認する</summary><div class="fold-body"><p>公開前の確認は月30件まで無料。継続利用の料金は月額50,000円・20本までです。</p><p>対象素材、無料確認と有料利用の範囲、1本・1件の数え方、修正や再確認、連携先を、契約前の見積もりに明記します。</p><p>制作・出演・広告・導入にかかる費用、税、契約期間・解約条件も、同じ見積もりで確認できます。この試算には、それらの費用とお客様に残る作業の費用を加えていません。</p><a class="go" href="contact.html" data-consult-page>対象と費用を相談する</a></div></details>\n'
    '            <div class="gain-split">\n'
    '              <div class="gs gs-auto"><p class="gs-h">仕組みに任せること</p><ul>' + ''.join(f'<li>{t}</li>' for t in (jp('広告表現のルールへの照合'), jp('複数のAIによる確認'), jp('条件が変わったときの、|承認の取り消し'), jp('利用期限と、|停止の追跡'), jp('決定ごとの記録'), jp('報酬の明細'))) + '</ul></div>\n'
    '              <div class="gs gs-human"><p class="gs-h">人が決めること</p><ul>' + ''.join(f'<li>{t}</li>' for t in (jp('条件への合意'), jp('最後の「はい」か「いいえ」'), jp('支払い'))) + '</ul></div>\n'
    '            </div>\n'
    '          </div>')
# ------------------------------------------------------------------ 起きたことに、自動で応える（2026-11-18 CEO「様々なリスク回避が人の手を介さずにできる」）
# 4 つの出来事を押すと、仕組みがすることが出る。文は仕組みの動作そのもの（承認の失効・停止の追跡・結果不明の保持）。架空の社名・金額・日付は置かない
GUARD = """<div class="cycle reveal" data-cycle data-state="brief">
  <div class="cycle-top"><div><span class="cycle-kicker">ONE PROJECT / FULL CYCLE</span><p class="cycle-id">ブランドの紹介動画 <small>体験用の案件</small></p></div><span class="cycle-status" id="cycleStatus" role="status">企画を整理</span></div>
  <p class="cycle-note">操作の見本です。この画面から公開・契約・支払いは実行されません。</p>
  <div class="cycle-track" role="group" aria-label="案件の工程">
    <button type="button" data-cycle-step="0" aria-pressed="true"><span>01</span>企画</button>
    <button type="button" data-cycle-step="1" aria-pressed="false"><span>02</span>制作・確認</button>
    <button type="button" data-cycle-step="2" aria-pressed="false"><span>03</span>公開</button>
    <button type="button" data-cycle-step="3" aria-pressed="false"><span>04</span>結果</button>
    <button type="button" data-cycle-step="4" aria-pressed="false"><span>05</span>明細</button>
  </div>
  <div class="cycle-body">
    <div class="cycle-art has-media" aria-hidden="true"><div class="cycle-preview"><img id="cyclePreview" src="assets/editorial/creator-film.webp" alt="" width="1280" height="674" loading="lazy" decoding="async"><span class="cycle-screen-state" id="cycleScreenVersion">v1</span></div><span class="cycle-art-caption" id="cycleMediaCaption">素材イメージ</span></div>
    <div class="cycle-detail" aria-live="polite" aria-atomic="true">
      <p class="cycle-kicker" id="cycleKicker">01 / PLAN</p><h3 class="cycle-title" id="cycleTitle">やることと、決めることを。</h3>
      <p class="cycle-copy" id="cycleCopy">目的、制作物、担当、使う場所。最初の地図で、仕事の全体をそろえます。</p>
      <dl class="cycle-facts"><div><dt>制作物</dt><dd>ブランドの紹介動画 1本</dd></div><div><dt>素材の版</dt><dd id="cycleVersion">v1</dd></div><div><dt>利用条件</dt><dd id="cycleTerms">30日・合意前</dd></div><div><dt>承認</dt><dd id="cycleApproval">未承認</dd></div><div><dt>公開</dt><dd id="cyclePublication">未実行</dd></div><div><dt>結果・明細</dt><dd id="cycleOutcome">未取得・未確定</dd></div></dl>
      <p class="cycle-owner" id="cycleOwner">REYZ：進め方と判断の材料を整理 ／ お客様：目的と条件を決める</p>
      <div class="cycle-actions"><button type="button" class="btn primary" data-cycle-action="next" id="cycleNext">制作・確認へ</button><button type="button" class="btn" data-cycle-action="reset">最初から</button></div>
    </div>
  </div>
  <div class="cycle-events"><p>途中で、変わったら。</p><div class="cycle-actions" role="group" aria-label="条件の変化を試す"><button type="button" data-cycle-action="asset">動画を差し替える</button><button type="button" data-cycle-action="terms">利用条件を変える</button><button type="button" data-cycle-action="expire">利用期限を迎える</button><button type="button" data-cycle-action="network">通信が途切れる</button></div></div>
  <p class="cycle-result" id="cycleResult" role="status">工程を選ぶと、その段階で任せることと、決めることが見えます。</p>
  <details class="cycle-history"><summary>この案件の記録を見る</summary><ol id="cycleHistory"><li>企画の整理から開始（見本）</li></ol></details>
  <p class="cycle-note">対象業務、連携先、REYZとお客様の担当範囲を、導入時に確認します。</p>
</div>"""

creative = title_chapter('Creative', 'For Enterprise', '「伝わる」を設計する。',
                         jp('何をつくるか。その前に、誰に、何を届けるか。\n事業の目的から、一緒に考えます。')) + \
section('services', 'Services', 'REYZがすること', '',
        # 企業正本 §5 の提供パッケージ（EP1 確認して出す／EP5 つくる・入れる／EP2 クリエイターで売る／EP3・EP4 組み込み・自社ブランド）で 11 項目を束ねる。
        # 束の見出しと 1 行が常に見え、項目（既決 8 項目の本文は不変）は押すと開く
        groups([('確認して、出す', jp('公開前に複数のAIが確かめ、|人が決め、記録が残る。'),
                 [('公開前の確認', jp('ステマ規制、景品表示法、|医療広告ガイドライン、薬機法に照らし、|提供元の異なる複数のAIが確かめ、|人が決め、記録を残します。\n法律の鑑定ではありません。')),
                  ('判断を、「はい」か「いいえ」で', jp('迷う原因は、材料が整っていないことです。\n目的への効き目、根拠、リスク、案を|地図にまとめて出します。|迷わず決められるところまで持っていきます。')),
                  ('目的を言葉にし、進め方を決める', jp('何のために、いつまでに、何を。|目的を正確に汲み取り、|いつ、何を、どう進めるかを決めて渡します。\n目的が変わったら、|進め方を組み直して続けます。'))]),
                ('つくる・入れる', jp('映像、SNS、ブランド、サイト、仕組み、AI。'),
                 [('動画・映像制作', jp('会社、商品、採用、発信。|伝えたいことを、使われる映像に。\n企画から撮影、編集、公開後の運用まで、|自社で行います。'), '#show', '映像のイメージを見る'),
                  ('SNSアカウントの運用支援', jp('立ち上げと見直し、企画と台本、撮影と編集、|毎日の投稿、数字の振り返り。\n感覚ではなく事実で確かめ、|会社の資産になるアカウントを育てます。')),
                  ('ブランドと制作', jp('ブランドの方向づけ、|サイト・映像・SNSの制作と運用。\nこのサイトも、|自社で設計・制作しています。')),
                  ('サイトと業務の仕組みづくり', jp('映像とSNSの受け皿になるサイトから、|社内で使う仕組みまで。\n使う人と仕事の流れから、|必要なものを整理してつくります。')),
                  ('最小の人数で、最大の利益を', jp('調査、台本、一次制作、進行管理、集計。|人がやらなくていい仕事を|AIと仕組みに移します。\n人は決めることと伝えることに集中し、|少ない人数で利益を生む体制をつくります。')),
                  ('AIを仕事に入れる', jp('仕事の流れの設計から|実際の運用までを、|自社の仕組み「REYZ PLATFORM」で。'), 'ai.html', 'REYZ PLATFORMについて')]),
                ('クリエイターで、売る', jp('確認を通った案件と商品を、|クリエイターの入口へ。'),
                 [('クリエイターとの販売設計', jp('クリエイターと連動した|販売の設計と運用。|国内からアジアへの越境販売まで。'))]),
                ('仕組みに組み込む・自社ブランドで', jp('事務所、代理店、制作会社へ。'),
                 [('事務所・代理店の方へ', jp('3つの画面と、|費用ゼロでやめるのも自由な契約の型、|公開前の確認を、\n自社ブランドで提供したり、|いまの仕組みに組み込んだりできます。'), 'consensus.html', 'REYZ CONSENSUSについて')])])) + \
section('guard', 'Full cycle', jp('ひとつの依頼を、|最後まで。'), jp('つくる。確かめる。届けた結果を見る。|途中で変わっても、同じ案件の続きから。'),
        GUARD + '<details class="workflow-detail" id="decide"><summary>表現確認の補足体験を見る</summary><div class="workflow-detail-body">' + SCREENS_ENT + '</div></details>') + \
section('show', 'Video × SNS', '映像とSNSの、かたち。', '', editorial_film('production', '伝わる瞬間を、<br>設計する。', '誰に届けるか。何を感じてほしいか。<br>その目的から、映像のかたちを選ぶ。')) + \
section('gain', 'Cost &amp; scope', jp('確認と管理の費用を、|確かめる。'), jp('依頼する範囲と、|仕事の量から。'), GAIN) + \
section('how', 'How to start', '任せ方', jp('いきなり大きな契約を結ぶ必要はありません。\n合わなければ、そこで終えて構いません。'),
        steps([('01', '相談する', jp('今の状況と、やりたいことを。|言葉になっていなくても、構いません。')),
               ('02', '地図を受け取る', ''),
               ('03', '「はい」か「いいえ」を決める', '')], cls='list') +
        more('contact.html', '相談する'))
page('creative.html', 'Creative — REYZ Inc.', 'REYZの企業向けサービス。目的を言葉にして進め方を決め、動画・映像制作、SNSアカウントの運用支援、最小の人数で最大の利益を生む仕組みづくり、「はい」か「いいえ」で決められる判断の支えまで。目的が変わっても、続きます。', creative)

# ------------------------------------------------------------------ AI (Z)（AIプラットフォーム事業）
# 事業内容: 複数のAIエージェントをクリエイターエコノミーと統合運用する自社AI基盤「REYZ PLATFORM」の開発・提供。
#           業務の設計から実装、検証・運用までを、AIと共に。複数のAIによる相互検証と記録を標準とし、監査可能なAI運用を設計段階から組み込む。
# 名称（2026-10-03 CEO 決定）: AI 製品を集約するプラットフォームの名称であり、個別の柱の名前ではない。
# 改名（2026-10-15 CEO 決定 NAMING-001）: Z-PLATFORM→REYZ PLATFORM、Z-DEVELOPER→REYZ DEVELOPER、Cross-AI Flow→REYZ CONSENSUS。ブランド層は全大文字。
# 表示の規律（2026-10-23 CEO）: 開発中・準備中・順次・先行導入などの進行形の状態語は書かない。稼働・実績・顧客数を示す表現は、根拠を併記できるまで書かない（legal.html「表示に関する方針」）。
# 2026-11-18: 製品の役割 → 仕事を重ねる価値 → 導入。統制の説明は1か所に集約する。
ai_products = items_fold([('つなぐ — AI Orchestration', jp('複数のAIを、|ひとつの仕事の流れにまとめます。\n提供元を固定せず、|AIの更新や料金の変化に合わせて|組み合わせを見直せます。')),
                          ('つくる — REYZ DEVELOPER', jp('開発経験がなくても、|自分の言葉で伝えることから|始められる開発・運用システム。\n公開して終わりではなく、|その後の運用と改善までを|対象にします。')),
                          ('確かめ、進める — REYZ CONSENSUS', jp('提供元の異なる複数のAIが、|同じ内容を互いに検証し、|合意したものだけを次へ進めます。'), 'consensus.html', 'REYZ CONSENSUSについて')], 3)   # 3 つとも開いたまま（2026-10-27 CEO「限定的すぎる」: 製品群の幅が見えるように）
AI_REUSE = ('<div class="reuse-ledger reveal">' + ''.join(
    f'<div class="reuse-row"><span class="reuse-n">{n:02d}</span><h3>{title}</h3><p>{body}</p></div>'
    for n, (title, body) in enumerate([
        (jp('次の仕事でも、|使える形に。'), jp('仕事に合わせて作った機能を、|次の案件でも使える形に整えます。\n対象業務と連携先に合わせ、|必要な部分を組み合わせます。')),
        (jp('完了を、|確かめる。'), jp('何ができれば完了かを、|先に決めます。\n成果物と実行結果を確かめる手順を、|実行する機能と一緒に残します。')),
        (jp('変わったら、|必要なところから。'), jp('目的や条件の変更が、|どの成果物・承認・公開先に影響するかを追います。\n影響がある範囲を、|やり直して確かめます。')),
    ], 1)) + '</div>'
    '<details class="core-rules"><summary>判断と情報の扱い</summary><div class="core-rules-body">' +
    items([('確認と、人の承認', jp('確認が取れないとき、|AIの判定が一致しないときは止まります。\n重要な変更は、|責任者の承認を経てから実行します。')),
           ('判断をたどれる記録', jp('事実・推論・仮説を分け、|入力・根拠・判定・承認・実行結果を記録します。\n記録は企業のもので、|いつでも持ち出せます。')),
           ('再利用する範囲を、決める', jp('お客様の記録や秘密情報は、|共通の機能・確認手順から分けて扱います。\n他の案件での再利用は、|許諾された範囲に限ります。'))]) +
    '</div></details>')
ai = title_chapter('AI', 'REYZ PLATFORM · AI Infrastructure', 'AIが支える。',
                   jp('複数のAIエージェントを統合運用する|AI基盤「REYZ PLATFORM」。')) + \
section('products', 'Products', 'REYZ PLATFORM', '', ai_products) + \
section('enterprise', 'Built to continue', jp('つくった仕組みを、|次の仕事へ。'), jp('機能と確かめ方を、一緒に残す。|仕事を重ねるたびに、使える部分を活かして進めます。'), AI_REUSE) + \
section('enterprise-how', 'How it works', '進め方', '',
        steps([('01', '現状の確認', jp('どの業務で、|AIが何を判断しているか。\n判断の重さと、|現在の確認方法を整理します。')),
               ('02', '統制の設計と導入', jp('検証の規則、|人が承認する範囲、|記録の形式を決め、\n既存の業務に組み込みます。')),
               ('03', '運用と報告', jp('AIと共に運用し、|判断の記録を定期的に報告します。\n結果をもとに、|規則を見直します。'))], cls='list') + more('contact.html', '相談する'))
page('ai.html', 'AI — REYZ Inc.', 'REYZのAI基盤「REYZ PLATFORM」。仕事に合わせた実行機能と、完了を確かめる手順を次の案件へ。複数AIの検証、人の承認、持ち出せる記録を備え、業務の設計から運用までを支えます。', ai)

# ------------------------------------------------------------------ REYZ CONSENSUS（REYZ PLATFORM の製品。2026-10-22 CEO 指示: ホームページから到達できるようにする）
# 表示の規律（2026-10-23 CEO）: 進行形の状態語は書かない。稼働・実績・顧客数を示す表現は、根拠を併記できるまで書かない。
# 到達経路: ai.html の製品 03 のリンク、sitemap。URL は /consensus（拡張子なし、clean()）。
consensus = title_chapter('Consensus', 'REYZ CONSENSUS', jp('確かめてから、|進める。'),
                          jp('提供元の異なる複数のAIが互いに検証し、|合意したものだけを次へ進める。')) + \
section('what', 'What it is', '仕組み', '',
        CHECK + items([('独立した検証', jp('作る側と確かめる側を分けます。\n記録と根拠を、|機械と、作る側から独立した検証者が確かめます。'))])) + \
section('how', 'How it works', '進め方', '',
        steps([('01', '伝える', jp('やりたいことを、|自分の言葉で伝えます。')),
               ('02', '作り、確かめる', jp('複数のAIが作り、互いに検証し、|記録を残します。')),
               ('03', '決めて、反映する', jp('責任者が決め、|承認を経たものだけが反映されます。'))], cls='list')) + \
section('offer', 'Offering', '提供の形', '',
        items_fold([('企業向け', jp('自社のAI運用に、|検証と承認と記録の統制を組み込みます。')),
               ('自社ブランドでの提供', jp('表示名・配色・ロゴを変えて、|自社の製品として提供できます。\n判断の規則と記録の形式は、|変わりません。')),
               ('仕組みへの組み込み', jp('代理店や制作会社の仕事の流れ、|お使いのツールの中に、\n確認と記録を組み込めます。')),
               ('記録は、企業のもの', jp('いつでも持ち出せます。'))], 0) +
        more('contact.html', '相談する') + more('ai.html', 'REYZ PLATFORMについて'))
page('consensus.html', 'REYZ CONSENSUS — REYZ Inc.', 'REYZ CONSENSUS — 提供元の異なる複数のAIが互いに検証し、合意したものだけを次へ進める。後戻りできない決定は人が行い、すべてに確認できる記録を残す、REYZ PLATFORMのAI運用の仕組み。', consensus)

# ------------------------------------------------------------------ CONTACT
# ご用件は事業内容（3事業）と各ページの導線に対応: クリエイターの方（Creator）／企業の方（Creative・AI）／その他
form = '''<form class="panel reveal" id="contactForm" novalidate>
            <div class="step" id="stepForm">
              <label>お名前（個人名または会社名）<input id="cName" name="name" type="text" autocomplete="name" maxlength="100" required></label>
              <!-- メールは 1 欄（DEC-20261027-18。@ 以降の選択式は模擬ユーザー 4/4 が指摘） -->
              <label>メールアドレス<input id="cEmail" name="email" type="email" spellcheck="false" autocomplete="email" inputmode="email" maxlength="254" required></label>
              <label>ご用件
                <select id="cType" name="type" required>
                  <option value="">選択してください</option>
                  <optgroup label="クリエイターの方">
                    <option>活動・収益化の相談</option>
                    <option>映像制作の依頼</option>
                  </optgroup>
                  <optgroup label="企業の方">
                    <option>目的の整理と進め方の相談</option>
                    <option>動画・映像制作</option>
                    <option>SNSアカウントの運用支援</option>
                    <option>ブランドと制作</option>
                    <option>サイトと業務の仕組みづくり</option>
                    <option>クリエイターとの販売設計</option>
                    <option>公開前の確認と記録（REYZ CONSENSUS）</option>
                    <option>自社ブランドでの提供・仕組みへの組み込み</option>
                    <option>AIを仕事に入れる（REYZ PLATFORM）</option>
                  </optgroup>
                  <optgroup label="その他">
                    <option>取材・提携</option>
                    <option>その他</option>
                  </optgroup>
                </select>
              </label>
              <!-- ご担当者は企業の用件のときだけ表示（DEC-20261027-18） -->
              <label id="personLabel" hidden>ご担当者<input id="cPerson" name="person" type="text" autocomplete="off" maxlength="100"></label>
              <label>内容<textarea id="cMsg" name="message" maxlength="5000" required></textarea></label>
              <input id="cWebsite" name="website" type="text" tabindex="-1" autocomplete="off" hidden>
              <div class="ctas tight">
                <button class="btn primary" type="submit" id="confirmBtn">確認する</button>
              </div>
              <div class="status" id="status" role="status" aria-live="polite"></div>
              <noscript><p class="lead">このフォームはJavaScriptが有効な環境で動きます。</p></noscript>
            </div>
            <div class="step" id="stepConfirm" hidden>
              <div class="head"><p class="eyebrow">Confirm</p><h3 id="confirmTitle" tabindex="-1">入力内容の確認</h3></div>
              <dl class="confirm" id="confirmList"></dl>
              <div class="turnstile" id="turnstileBox" hidden></div>
              <div class="ctas tight">
                <button class="btn" type="button" id="backBtn">修正する</button>
                <button class="btn primary" type="button" id="sendBtn">送信</button>
              </div>
              <div class="status" id="sendStatus" role="status" aria-live="polite"></div>
              <label id="copyLabel" hidden>送信用の文面<textarea id="copyArea" readonly></textarea></label>
              <div class="ctas tight"><a class="btn" id="mailBtn" href="#" hidden>メールアプリで送る</a></div>
            </div>
            <div class="step" id="stepDone" hidden>
              <div class="head"><p class="eyebrow">Sent</p><h3 id="doneTitle" tabindex="-1">送信しました。</h3></div>
              <p class="lead">担当者より直接ご返信します。</p>
              <p class="lead" id="doneNote" hidden>確認メールの自動送信は行われませんでしたが、内容は届いています。</p>
            </div>
          </form>'''
contact = title_chapter('ripple', 'Contact', 'その先を、<br>一緒に。', '') + \
section('form', 'Message', 'お問い合わせ', '担当者より直接ご返信します。', form)
page('contact.html', 'Contact — REYZ Inc.', 'REYZ Inc. へのお問い合わせ。', contact)

# ------------------------------------------------------------------ LEGAL
# LEGAL（作品例ページは 2026-10-27 CEO「作品例を記載しない」により廃止。旧 URL /works は /creative への静的転送）
legal_grid = f'''<div class="legal-grid reveal">
          <div class="legal-block">
            <h2>宅地建物取引業者</h2>
            <dl>
              <div><dt>商号</dt><dd>株式会社レイズ</dd></div>
              <div><dt>免許証番号</dt><dd>東京都知事（1）第110185</dd></div>
              <div><dt>代表者</dt><dd>堀内智一</dd></div>
              <div><dt>主たる事務所</dt><dd>''' + ADDRESS + f'''</dd></div>
            </dl>
          </div>
          <div class="legal-block">
            <h2>古物営業法に基づく表記</h2>
            <dl>
              <div><dt>名称</dt><dd>株式会社レイズ</dd></div>
              <div><dt>許可をした公安委員会</dt><dd>東京都公安委員会</dd></div>
              <div><dt>許可証番号</dt><dd>第303312620413</dd></div>
            </dl>
          </div>
          <div class="legal-block">
            <h2>表示に関する方針</h2>
            <p>「No.1」「日本一」などの表現は目標としてのみ使用します。実績として示す場合は、指標・比較対象・期間・出典を併記します。</p>
          </div>
          <div class="legal-block">
            <h2>個人情報の取り扱い</h2>
            <p>お問い合わせで取得した個人情報は、その対応の目的にのみ利用し、法令に基づく場合を除き第三者に提供しません。</p>
            <p>お問い合わせの受付とメール送信には、Cloudflare と Google Workspace を利用します。確認画面のボット対策には Cloudflare Turnstile を使用します。</p>
            <p>ホームのAI対話を利用する場合、送信した会話と地図の内容は、回答を生成するために Cloudflare を経由して Anthropic のAPIに送られます。</p>
            <p>配信マニュアルの名称と配色は、お使いのブラウザ内で処理します。PDF生成のために入力内容をサーバーへ送信することはありません。</p>
            <p>本サイトはフォント配信に Google Fonts を利用しており、閲覧時にIPアドレス等の接続情報が Google に送信されます。</p>
          </div>
        </div>'''
legal = title_chapter('line', 'Privacy &amp; Legal', '法令に基づく表記', '') + f'''    <section class="section" id="notices">
      <div class="wrap"><div class="section-text">{legal_grid}</div></div>
    </section>
'''
page('legal.html', 'Privacy & Legal — REYZ Inc.', '株式会社レイズの法令に基づく表記。宅地建物取引業者、古物営業法に基づく表記、表示に関する方針、個人情報の取り扱い。', legal)

# ------------------------------------------------------------------ /works → /creative の静的転送（DEC-20261027-19）
# 旧 URL を 404 にせず、meta refresh と canonical で /creative へ送る。sitemap には載せない（PAGES に加えない）。検索には noindex
_works_to = 'creative.html' if os.environ.get('KEEP_HTML_LINKS') == '1' else '/creative'
with open(os.path.join(ROOT, 'works.html'), 'w', encoding='utf-8') as f:
    f.write(f'''<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <meta http-equiv="refresh" content="0; url={_works_to}">
  <link rel="canonical" href="{SITE_URL}/creative">
  <title>REYZ Inc.</title>
  <style>html{{background:#060609;color:#f4f4f6;font-family:system-ui,sans-serif}}body{{margin:0;min-height:100vh;display:grid;place-items:center}}a{{color:#f4f4f6}}</style>
</head>
<body><p><a href="{_works_to}">企業の方へ</a></p></body>
</html>
''')

# ------------------------------------------------------------------ 公開用の付属ファイル
not_found = title_chapter('loop', 'Not found', 'ページが見つかりません。', jp('URL が変わったか、|存在しないページです。')) + \
    '    <section class="section" id="back"><div class="wrap"><div class="section-text"><h2 class="sr-only">戻る</h2><p class="more reveal"><a class="go" href="index.html">ホームへ</a></p></div></div></section>\n'
page('404.html', 'Not found — REYZ Inc.', 'ページが見つかりません。', not_found)
PAGES.remove('404.html')
# 404 はどの階層の URL でも配信されるため、相対パスを絶対パスに書き換える（assets／各ページへのリンク）
_p404 = os.path.join(ROOT, '404.html'); _d = open(_p404, encoding='utf-8').read()
_d = re.sub(r'(href|src)="assets/', r'\1="/assets/', _d)
_d = re.sub(r'href="\./(#[^"]*)?"', lambda m: 'href="/' + (m.group(1) or '') + '"', _d)
_d = re.sub(r'href="(' + _PAGE_RE + r')"', r'href="/\1"', _d)
open(_p404, 'w', encoding='utf-8').write(_d)
with open(os.path.join(ROOT, 'robots.txt'), 'w', encoding='utf-8') as f:
    f.write(f'User-agent: *\nAllow: /\nSitemap: {SITE_URL}/sitemap.xml\n')
with open(os.path.join(ROOT, 'sitemap.xml'), 'w', encoding='utf-8') as f:
    f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
            ''.join(f'  <url><loc>{SITE_URL}/{clean(p)}</loc></url>\n' for p in PAGES) + '</urlset>\n')   # /works は 2026-10-27 CEO「作品例を記載しない」により導線・sitemap から外す（ファイルは旧 URL のために残す）
# Cloudflare Pages / Netlify が読む付属設定（他のホスティングでは無視される）
host = SITE_URL.split('//', 1)[1]
with open(os.path.join(ROOT, '_headers'), 'w', encoding='utf-8') as f:
    f.write('/*\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: SAMEORIGIN\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Strict-Transport-Security: max-age=31536000\n/assets/*\n  Cache-Control: public, max-age=86400\n')
with open(os.path.join(ROOT, '_redirects'), 'w', encoding='utf-8') as f:
    f.write(f'https://www.{host}/* {SITE_URL}/:splat 301\n')
print('built', sorted(f for f in os.listdir(ROOT) if f.endswith('.html')), '+ robots.txt sitemap.xml _headers _redirects', 'SITE_URL =', SITE_URL)
