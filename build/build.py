# -*- coding: utf-8 -*-
"""REYZ Inc. corporate site v6 — static build (narrative + sticky particle stage).
Run: python3 build/build.py  → writes ./site/*.html"""
import os, re, html, json

ROOT = os.environ.get('SITE_OUT') or os.path.join(os.path.dirname(__file__), '..', 'site')   # SITE_OUT: 検証用の別出力先
SITE_URL = os.environ.get('SITE_URL', 'https://reyz.inc')   # 公開ドメイン（canonical / og:url / og:image / sitemap）。末尾スラッシュなし
NAV = [('creator.html', 'Creator'), ('creative.html', 'Creative'), ('ai.html', 'AI'), ('index.html#reyz', 'Company'), ('contact.html', 'Contact')]
ADDRESS = '東京都渋谷区恵比寿1丁目19-19 恵比寿ビジネスタワー10階'
ICON = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2064%2064'%3E%3Crect%20width='64'%20height='64'%20rx='14'%20fill='%23060609'/%3E%3Cpath%20d='M18%2032c0-6%204-9%208-9s6%203%208%209%204%209%208%209%208-3%208-9-4-9-8-9-6%203-8%209-4%209-8%209-8-3-8-9z'%20fill='none'%20stroke='%23F715AC'%20stroke-width='2.4'%20stroke-linecap='round'/%3E%3C/svg%3E"

def clean(fname):
    """公開 URL の表記（2026-10-03 CEO 決定）: 拡張子 .html を付けない。index.html は ''（= /）。
    ファイル自体は x.html のまま出力する（GitHub Pages は /x で x.html を返す。旧 URL /x.html も引き続き開ける）。"""
    return '' if fname == 'index.html' else re.sub(r'\.html$', '', fname)
_PAGE_RE = r'(?:creator|creative|ai|consensus|contact|legal|works)'
def clean_links(doc):
    """ページ内リンクを .html なしの表記へ（index.html → ./ 、x.html → x。#以降は保つ）。本文は x.html で書き、出力時に一括変換する。"""
    doc = re.sub(r'href="index\.html(#[^"]*)?"', lambda m: 'href="./' + (m.group(1) or '') + '"', doc)
    return re.sub(r'href="(' + _PAGE_RE + r')\.html(#[^"]*)?"', lambda m: 'href="' + m.group(1) + (m.group(2) or '') + '"', doc)

def head(title, desc, fname='index.html'):
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
  <meta property="og:image" content="{SITE_URL}/assets/og-image.png">
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
  <link rel="stylesheet" href="assets/site.css">
</head>
'''

def header(current):
    cur = lambda h: ' aria-current="page"' if h == current else ''
    links = '\n'.join(f'      <a href="{h}"{cur(h)}>{t}</a>' for h, t in NAV)
    sheet = '\n'.join(f'    <a href="{h}"{cur(h)}>{t}</a>' for h, t in NAV)
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
          <a href="contact.html">Contact</a>
          <a href="legal.html">Privacy &amp; Legal</a>
        </nav>
      </div>
      <div class="foot-slot" data-word="loop" aria-hidden="true"></div>
      <p class="foot-contact" id="contactLine" hidden></p>
    </div>
  </footer>

  <script src="assets/site.js"></script>
</body>
</html>
'''


PAGES = []
def page(fname, title, desc, col_text, current=None):
    PAGES.append(fname)
    doc = head(title, desc, fname) + '<body>\n' + header(current or fname) + f'''
  <main id="main">
{col_text}  </main>

''' + FOOTER
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
def items_fold(lst, open_n):
    """先頭 open_n 件は開いたまま、残りはたたむ"""
    out = []
    for i, it in enumerate(lst):
        t, p = it[0], it[1]
        if i < open_n:
            link = f'<a class="go" href="{it[2]}">{it[3]}</a>' if len(it) > 3 else ''
            out.append(f'            <div class="item"><h3>{t}</h3><p>{p}</p>{link}</div>')
        else:
            out.append(fold(t, p, it[2] if len(it) > 3 else '', it[3] if len(it) > 3 else ''))
    return '<div class="items reveal">\n' + '\n'.join(out) + '\n          </div>'
def more(href, label):
    """セクション末尾の次の一歩（相談する →）"""
    return f'\n          <p class="more reveal"><a class="go" href="{href}">{label}</a></p>'
def steps(lst, cls=''):
    return f'<div class="steps{" " + cls if cls else ""} reveal">\n' + '\n'.join(f'            <div class="step"><span class="n">{n}</span><h3>{t}</h3><p>{p}</p></div>' for n, t, p in lst) + '\n          </div>'
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
def pains(lst):
    """こんな困りごとに — 読者の言葉で。番号つき。.item ではない（creator の受入検証は .item p の順序を固定しているため）"""
    return '<ol class="pains reveal">\n' + '\n'.join(f'            <li><span class="n">{n:02d}</span><p>{t}</p></li>' for n, t in enumerate(lst, 1)) + '\n          </ol>'
def stages(lst):
    """ページ冒頭の構成予告（01 誰のため … 04 任せ方）"""
    return '<ol class="stages reveal">\n' + '\n'.join(f'            <li><span class="n">{n:02d}</span><strong>{t}</strong><span>{p}</span></li>' for n, (t, p) in enumerate(lst, 1)) + '\n          </ol>'
def cycle(lst):
    """続け方（把握→設計→制作・投稿→記録で報告→目標が変わったら組み直す）。最後の項目は輪を閉じる"""
    out = []
    for n, (t, p) in enumerate(lst, 1):
        cls = ' class="loop"' if n == len(lst) else ''
        out.append(f'            <li{cls}><span class="n">{n:02d}</span><strong>{t}</strong><span>{p}</span></li>')
    return '<ol class="cycle reveal">\n' + '\n'.join(out) + '\n          </ol>'
def sub(h3, lead=''):
    """セクション内の小見出し＋導入文"""
    return f'\n          <h3 class="sub reveal">{h3}</h3>' + (f'\n          <p class="lead reveal">{lead}</p>' if lead else '')
def title_chapter(word, eyebrow, h1, lead, lead_cls='lead', lead2=''):
    """lead2: 既決の導入文（lead）を変えずに、その下へ加える 2 行目（2026-10-26 正本 §10: /creator の冒頭）"""
    return f'''    <section class="chapter page-head" id="top">
      <div class="wrap chapter-stack">
        {slot(word, halo=True)}
        <div class="head copy"><p class="eyebrow">{eyebrow}</p><h1 class="page-title">{h1}</h1>{('<p class="' + lead_cls + '">' + lead + '</p>') if lead else ''}{('<p class="lead lead2">' + lead2 + '</p>') if lead2 else ''}</div>
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
    ('goal',  'creator', '目的は',            [('yes', '言葉にできている'), ('no', 'まだ決まっていない')]),
    ('place', 'creator', '活動する場所は',    [('yes', '決まっている'), ('no', 'まだ')]),
    ('style', 'creator', 'やりたいのは',      [('live', 'ライブ配信'), ('post', '動画や投稿')]),
    ('make',  'creator', '制作は',            [('share', 'REYZと分けたい'), ('own', '自分の体制がある')]),
    ('value', 'creator', '大事にしたいのは',  [('last', '目標が変わっても続くこと'), ('start', 'まず始めること')]),
    ('goal',  'company', '目的は',            [('yes', '決まっている'), ('no', 'まだ整理できていない')]),
    ('focus', 'company', '力を入れたいのは',  [('media', '映像・SNS'), ('ops', '業務の効率化・AI'), ('abroad', '越境・販路')]),
    ('first', 'company', '最初に整えたいのは', [('law', '表現と法令の確認'), ('speed', '速さと省人化')]),
]
def mapper():
    qs = []
    for q, aud, prompt, opts in MAP_Q:
        qid = f'mq-{aud}-{q}'
        btns = ''.join(f'<button type="button" class="opt" data-v="{v}" aria-pressed="false">{html.escape(l)}</button>' for v, l in opts)
        qs.append(f'            <div class="mq" role="group" aria-labelledby="{qid}" data-q="{q}" data-for="{aud}"{"" if aud == "all" else " hidden"}><p class="q" id="{qid}">{prompt}</p><div class="opts">{btns}</div></div>')
    return ('          <div class="mapper reveal" id="mapper">\n' + '\n'.join(qs) + '\n'
            '            <div class="map-card" id="mapCard" hidden>\n'
            '              <div class="sheet-head"><p class="eyebrow">Your map · 設計上の見本</p><h3>あなたの地図</h3></div>\n'
            # 地図そのもの: 3 つの点（今いる場所 → 最初の一歩 → 目的）を 1 本の線が結ぶ。線は site.js が点の位置から引く（正本 §10・§13「3 つの点が線で結ばれる軌道」）
            '              <div class="route" id="mapRoute">\n'
            '                <svg class="route-svg" aria-hidden="true" focusable="false"><path id="routePath" class="route-line" d="M0 0"/><circle class="route-pulse" r="3"><animateMotion dur="6s" repeatCount="indefinite" calcMode="linear"><mpath href="#routePath"/></animateMotion></circle></svg>\n'
            '                <dl class="map-rows">\n'
            '                  <div class="node"><dt><span class="dot" aria-hidden="true"></span>今いる場所</dt><dd id="mapPlace"></dd></div>\n'
            '                  <div class="node"><dt><span class="dot" aria-hidden="true"></span>最初の一歩</dt><dd id="mapStep"></dd></div>\n'
            '                  <div class="node goal"><dt><span class="dot" aria-hidden="true"></span>目的</dt><dd id="mapGoal"></dd></div>\n'
            '                </dl>\n'
            '              </div>\n'
            '              <p class="map-note" id="mapNote" hidden>' + jp('費用はかからない。|REYZはクリエイターの報酬から|手数料を取らない。|やめるのも自由。') + '</p>\n'
            f'              <p class="map-note" id="mapNoteLive" hidden>{TT_NOTE}</p>\n'
            '              <p class="map-fine">' + jp('設計上の見本です。|相談で、あなたの言葉に合わせて|作り直します。') + '</p>\n'
            '              <div class="map-next" data-for="creator"><p class="map-next-head">この地図から、次へ。</p><ol><li><span class="n">01</span><strong>地図</strong><span>' + jp('目的と、最初の一歩。') + '</span></li><li><span class="n">02</span><strong>入口</strong><span>' + jp('確認を通った案件と商品だけが届く。') + '</span></li><li><span class="n">03</span><strong>明細</strong><span>' + jp('いつ、何で、いくら。|記録はあなたのもの。') + '</span></li></ol></div>\n'
            '              <div class="map-next" data-for="company"><p class="map-next-head">この地図から、次へ。</p><ol><li><span class="n">01</span><strong>地図</strong><span>' + jp('目的と、次の一手。|はい／いいえで決める。') + '</span></li><li><span class="n">02</span><strong>確認</strong><span>' + jp('公開前に、複数のAIが確かめ、|人が決める。') + '</span></li><li><span class="n">03</span><strong>記録</strong><span>' + jp('決定ごとに残る。|記録は企業のもの。') + '</span></li></ol></div>\n'
            '              <div class="ctas tight"><a class="btn primary" id="mapGo" href="contact.html">この内容で相談する</a><button type="button" class="btn" id="mapReset">最初から</button></div>\n'
            '            </div>\n'
            '          </div>')
MAPPER = mapper()

# ------------------------------------------------------------------ HOME 章「AI」: REYZ 自身がこの仕組みで動いている事実（企業正本 §11「REYZ 自身がこの仕組みで運営している（事実の範囲で）」。2026-10-26 CEO「表現で解決せよ」）
# 書くのは確認できる事実だけ: 公開リポジトリ REYZ-Inc/reyz-site（変更ごとの自動検査・人の承認。ブランチ保護＋必須チェック＋CEO の merge）、決定の通し番号つき記録（2026-09〜、2026-10-23 時点で 517 番）、設計書の版。人数・規模・「共生」は書かない（2026-09-26 除外文言）
PROOF = ('<div class="proof reveal">\n'
    '            <p class="proof-head">' + jp('REYZ自身が、|この仕組みで動いています。') + '</p>\n'
    '            <ol class="proof-list">\n'
    '              <li><strong>このサイト</strong><p>' + jp('変更は1件ごとに自動の検査を通り、|人が承認してから公開されます。\n変更の記録は、公開しています。') + '</p><a class="go" href="https://github.com/REYZ-Inc/reyz-site/pulls?q=is%3Apr+is%3Amerged" rel="noopener">変更の記録</a></li>\n'
    '              <li><strong>会社の決定</strong><p>' + jp('提供元の異なる複数のAIが互いに検証し、|人が決め、通し番号つきの記録に残します。\n2026年9月から続け、|通し番号は2026年10月23日時点で517。') + '</p></li>\n'
    '              <li><strong>事業の設計書</strong><p>' + jp('同じ流れで版を重ねています。\nどの版で、何を決めたかが残ります。') + '</p></li>\n'
    '            </ol>\n'
    '          </div>')

# ------------------------------------------------------------------ HOME 章「AI」の道具「確認」: 提供元の異なる複数の AI が確かめ → 人が はい／いいえ → 記録。一致しなければ止まる。
# 文で説明せず、仕組みそのものを目の前で動かす（2026-10-26 CEO「表現で解決せよ」）。数字は事実の範囲（通し番号 517・2026-10-23 時点）だけ。
def check_inst():
    lanes = ''.join('                <div class="lane"><span class="dot ai" aria-hidden="true"></span><span class="lbl">AI</span><span class="wire" aria-hidden="true"></span><span class="mark" aria-hidden="true"></span></div>\n' for _ in range(3))
    ticks = ''.join('<i></i>' for _ in range(48))
    return ('          <div class="check reveal" id="check" data-run="">\n'
            '            <div class="check-lanes">\n' + lanes +
            '              <p class="cap">' + jp('提供元の異なる複数のAIが、|それぞれ確かめる。') + '</p>\n'
            '            </div>\n'
            '            <div class="check-human">\n'
            '              <span class="dot human" aria-hidden="true"></span><span class="lbl">人が決める</span>\n'
            '              <span class="yn" aria-hidden="true"><span class="pill yes">はい</span><span class="pill">いいえ</span></span>\n'
            '              <p class="cap cap-go">' + jp('後戻りできない決定は、|人が決める。') + '</p><p class="cap cap-stop">' + jp('一致しないものは、|止まる。') + '</p>\n'
            '            </div>\n'
            '            <div class="check-rec">\n'
            '              <span class="lbl">記録</span><span class="ticks" aria-hidden="true">' + ticks + '</span>\n'
            '              <p class="cap">' + jp('決定ごとに、|あとから変えられない形で残る。') + '</p>\n'
            '            </div>\n'
            '          </div>')
CHECK = check_inst()
# ------------------------------------------------------------------ HOME 章「Continue」の道具: 線が折れても、続く
CONTINUE = ('          <div class="bend reveal" aria-hidden="true">\n'
            '            <svg viewBox="0 0 320 90" preserveAspectRatio="xMidYMid meet"><path id="bendPath" class="bend-line" d="M12 66 L146 40 Q150 38 154 39 L308 52"/><circle class="bend-dot" cx="12" cy="66" r="3.2"/><circle class="bend-dot" cx="150" cy="38.5" r="3.2"/><circle class="bend-dot goal" cx="308" cy="52" r="4"/><circle class="bend-pulse" r="2.6"><animateMotion dur="7s" repeatCount="indefinite" calcMode="linear"><mpath href="#bendPath"/></animateMotion></circle></svg>\n'
            '          </div>')

# ------------------------------------------------------------------ HOME
home = f'''    <section class="chapter" id="infinity">
      <div class="wrap chapter-stack">
        {slot('infinity', halo=True)}
        <div class="head copy">
          <h1><span>無限の可能性を</span><span>かたちに</span></h1>
          <p class="hero-sub">From Japan, <em>beyond.</em></p>
          <p class="lead hero-lead">{jp('クリエイターの収入と、|企業の「伝わる」を、|AIと人で設計する。')}</p>
        </div>
      </div>
    </section>
    <section class="chapter" id="origin">
      <div class="wrap chapter-stack">
        {slot('seed')}
        <div class="head copy">
          <h2>ひとつの意志から。</h2>
          <p class="lead">REYZは、クリエイターと企業の「やりたい」を、<br>かたちにします。</p>
          <p class="lead">映像制作、SNSアカウントの運用、<br>仕事の仕組みづくり、判断の支え。</p>
          <div class="ctas"><a class="btn primary" href="creative.html">企業の方へ</a><a class="btn" href="creator.html">クリエイターの方へ</a></div>
        </div>
      </div>
    </section>
    <section class="chapter" id="map">
      <div class="wrap chapter-stack">
        {slot('map')}
        <div class="copy wide">
          <div class="head"><p class="eyebrow">Your map</p><h2>あなたの地図を、<br>ここで。</h2><p class="lead">{jp('いくつか選ぶと、|目的・今いる場所・最初の一歩を、|地図にして返します。')}</p></div>
{MAPPER}
          <noscript><p class="lead">{jp('この体験はJavaScriptが有効な環境で動きます。')}<br><a href="creator.html">クリエイターの方へ</a>　<a href="creative.html">企業の方へ</a></p></noscript>
        </div>
      </div>
    </section>
    <section class="chapter" id="creator">
      <div class="wrap chapter-stack">
        {slot('Creator')}
        <a class="gate copy" href="creator.html">
          <p class="eyebrow">For Creators</p>
          <h2>「生き方」を職業に。</h2>
          <span class="go">Creator</span>
        </a>
      </div>
    </section>
    <section class="chapter" id="creative">
      <div class="wrap chapter-stack">
        {slot('Creative')}
        <a class="gate copy" href="creative.html">
          <p class="eyebrow">For Enterprise</p>
          <h2>「伝わる」を設計する。</h2>
          <span class="go">Creative</span>
        </a>
      </div>
    </section>
    <section class="chapter" id="ai">
      <div class="wrap chapter-stack">
        {slot('AI')}
        <div class="copy wide">
          <div class="head"><p class="eyebrow">REYZ PLATFORM · AI Infrastructure</p><h2>AIが支える。</h2><p class="lead">AIに任せた判断を、<br>あとから説明できる状態に。</p></div>
{CHECK}
{PROOF}
          <p class="more"><a class="go" href="ai.html">AI</a></p>
        </div>
      </div>
    </section>
    <section class="chapter" id="continue">
      <div class="wrap chapter-stack">
        {slot('Continue')}
        <div class="head copy">
          <h2>目的が変わっても、<br>続く。</h2>
{CONTINUE}
          <p class="lead">人の目的は変わります。<br>REYZは、変わる前提で進め方をつくり、<br>変わったら組み直して続けます。<br>やり直しではなく、続きから。<br>クリエイターにも、企業にも。</p>
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
# 本文の改行は本人指定（2026-09-27）。'|' は画面幅が足りない時だけ使う折返し点。TT_P1・TT_P2・TT_NOTE は HOME の前で定義
VD_H3 = jp('動画・映像制作[（PR・PV・MV・|ドキュメンタリー・ドラマ）]')
VD_P = jp('''インフルエンス力向上、ブランド化、リブランディングなど、
それぞれが抱える|現状の課題や目的を明確にし、
その目的を実現させるための企画、撮影、編集までを、
自社ですべて行います。''')
# 2026-10-23 CEO 指示: 読者はクリエイター本人。困りごと→提供すること→約束→はじめ方。既決の文（TikTok・映像制作・はじめ方 3 段）は変更しない
PROMISE = items([('目的を、先に言葉にします。', jp('最初の相談で、|あなたの目的と今いる場所、|最初の進め方を地図にして返します。\n合わなければ、始めません。')),
                 ('迷わない進め方を、渡します。', jp('どの場所で、いつ、何を、どうやるか。|次の一手が|いつも決まっている状態を|つくります。')),
                 ('目的が変わっても、続きます。', jp('目的は変わるものです。|変わったら、進め方を組み直して続けます。\nやり直しではなく、続きから。')),
                 ('決めるのは、あなたです。', jp('人が決めるべきことを、|AIに決めさせません。\n判断の材料を|「はい」か「いいえ」で|答えられる形にして出します。')),
                 ('任せきりにしません。', jp('進み具合と、なぜそうしたかを、|いつでも見られる形で残します。\n担当が変わっても、目標が変わっても、|続きから再開できます。'))])
# 2026-10-26 正本 §10: 冒頭の 2 行目、困りごと 4 件目、仕組み（費用ゼロ・手数料ゼロ・やめるのも自由、お金の流れ、3 つの画面の見本）、提供することの追加 5 項目。
# 公開サイトでは「所属」「退所」を使わない（2026-09-26 CEO）ので、正本の文は「費用はかからない。やめるのも自由。」の形にする
MODEL = ('<div class="model reveal">\n'
    '            <ul class="vows"><li>費用ゼロ。</li><li>' + jp('報酬からの|手数料ゼロ。') + '</li><li>' + jp('やめるのも|自由。') + '</li></ul>\n'
    # お金の流れ（正本 §8「原資の図」）: 動くのは プラットフォーム・企業 → REYZ の線だけ。あなた → REYZ の線には何も流れない（0 円）
    '            <div class="fund flowmap">\n'
    '              <div class="flow"><span class="from">' + jp('プラットフォーム・|企業') + '</span><span class="fl-lane" aria-hidden="true"><i></i><i></i><i></i></span><span class="to">REYZ</span><span class="what">報酬・利用料</span></div>\n'
    '              <div class="flow zero"><span class="from">あなた</span><span class="fl-lane" aria-hidden="true"></span><span class="to">REYZ</span><span class="what">0円</span></div>\n'
    '              <p>' + jp('REYZの収入は、|プラットフォームと企業から。\nだから、あなたの報酬からは引きません。') + '</p>\n'
    '            </div>\n'
    '            <div class="terms">\n'
    '              <p class="terms-head">はっきり決めていること</p>\n'
    '              <ul>\n'
    '                <li>' + jp('活動が続く限り、無料。|休むときは、待ちます。') + '</li>\n'
    '                <li>' + jp('目標を課しません。') + '</li>\n'
    '                <li>' + jp('違約金なし。|他の仕事を制限しません。|やめた後の配信も制限しません。') + '</li>\n'
    '                <li>' + jp('あとから条件を悪くしません。') + '</li>\n'
    '                <li>' + jp('直販のクリエイター手数料は0%。|購入時の利用料は買う人に明示し、|使うかはあなたが選びます。|売上ゼロなら、課金ゼロ。') + '</li>\n'
    '                <li>' + jp('記録はあなたのもの。|いつでも持ち出せます。') + '</li>\n'
    '              </ul>\n'
    '            </div>\n'
    '          </div>')
# 3 つの画面の見本（正本 §3-1。「設計上の見本」と明記。架空の名前・金額は置かない）: 画面そのものを小さく動かす
def phone(kind, title, inner, text):
    return (f'              <figure class="phone" data-kind="{kind}"><div class="phone-screen"><div class="phone-bar" aria-hidden="true"><i></i><i></i></div>\n{inner}'
            f'              </div><figcaption><h4>{title}</h4><p>{text}</p></figcaption></figure>\n')
SCR_MAP = ('                <div class="scr-map" aria-hidden="true"><span class="scr-line"></span>'
           '<div class="scr-node"><i></i><b>今いる場所</b></div><div class="scr-node"><i></i><b>最初の一歩</b></div><div class="scr-node goal"><i></i><b>目的</b></div>'
           '<span class="scr-redo">目標が変わったら、引き直す</span></div>\n')
SCR_GATE = ('                <div class="scr-gate" aria-hidden="true"><span class="scr-gatebar"><b>確認</b></span>'
            '<div class="scr-card ok"><b>案件</b><i>✓</i></div><div class="scr-card ok"><b>商品の紹介</b><i>✓</i></div><div class="scr-card ok"><b>ファンへの直販</b><i>✓</i></div><div class="scr-card ng"><b>確認を通らない案件</b><i>×</i></div></div>\n')
SCR_STMT = ('                <div class="scr-stmt" aria-hidden="true">'
            '<div class="scr-row"><b>報酬</b><span class="scr-bar full"><i></i></span><em>あなたへ</em></div>'
            '<div class="scr-row"><b>手数料</b><span class="scr-bar"><i></i></span><em>0</em></div>'
            '<div class="scr-row"><b>費用</b><span class="scr-bar"><i></i></span><em>0</em></div>'
            '<div class="scr-foot"><b>記録</b><span>いつ・何で・いくら</span><em>持ち出せる</em></div></div>\n')
SCR_CHECK = ('                <div class="scr-check" aria-hidden="true">'
             '<div class="scr-ai"><i></i><b>AI</b><s></s><em>✓</em></div><div class="scr-ai"><i></i><b>AI</b><s></s><em>✓</em></div><div class="scr-ai"><i></i><b>AI</b><s></s><em>✓</em></div>'
             '<div class="scr-decide"><b>人が決める</b><span class="y">はい</span><span>いいえ</span></div></div>\n')
SCR_REC = ('                <div class="scr-rec" aria-hidden="true">'
           '<div class="scr-line2"><b>何を</b><span></span></div><div class="scr-line2"><b>どのきまりで</b><span></span></div><div class="scr-line2"><b>誰が・いつ</b><span></span></div><div class="scr-line2"><b>判定・承認</b><span></span></div>'
           '<div class="scr-foot"><b>記録</b><span>企業のもの</span><em>持ち出せる</em></div></div>\n')
SCREENS_CREATOR = ('<div class="screens3 reveal">\n'
    '            <div class="sheet-head"><p class="eyebrow">Three screens · 設計上の見本</p><h3>' + jp('地図・入口・明細。') + '</h3></div>\n'
    '            <div class="phones3">\n'
    + phone('map', '地図', SCR_MAP, jp('目的と今いる場所、最初の一歩。\n目標が変わったら、引き直す。'))
    + phone('gate', '入口', SCR_GATE, jp('確認を通った案件と商品だけが、|ここに届く。\n受けるかは、あなたが決める。'))
    + phone('stmt', '明細', SCR_STMT, jp('いつ、何で、いくら。\n記録はあなたのもの。|いつでも持ち出せる。')) +
    '            </div>\n'
    '          </div>')
creator = title_chapter('Creator', 'For Creators', '「生き方」を職業に。', 'あなたの活動を収入に変える設計を。',
                        lead2=jp('あなたの収益の、全部の入口に。\n費用はかからない。|やめるのも自由。')) + \
section('pain', 'For you', 'こんな困りごとに', '',
        pains([jp('自分に合うSNSはどれか。|いつ、何を、どう出せば|目標に近づくのか、迷う。'),
               jp('企画、撮影、編集、毎日の投稿。|ひとりで抱えきれず、|活動のペースと質が落ちる。'),
               jp('目指すものや暮らしが変わったとき、|活動を何から変えればいいか|分からない。'),
               jp('事務所に入ると報酬から引かれたり、|辞めるときに制限がかかるのが|不安。')])) + \
section('model', 'How it works for you', '仕組み', jp('あなたから、|一円も取らない。'), MODEL + SCREENS_CREATOR) + \
section('services', 'Services', '提供すること', '',
        '<div class="items reveal">\n'
        '            <div class="item">\n'
        '              <h3>TikTok LIVEエージェンシー</h3>\n'
        f'              <p>{TT_P1}</p>\n'
        f'              <p>{TT_P2}</p>\n'
        f'              <p class="note">{TT_NOTE}</p>\n'
        '            </div>\n'
        '            <div class="item">\n'
        f'              <h3>{VD_H3}</h3>\n'
        f'              <p>{VD_P}</p>\n'
        '              <a class="go" href="works.html">作品例</a>\n'
        '            </div>\n'
        + fold('あなたを知るところから', jp('''得意なこと、今のフォロワー、|生活のリズム、目指す収入。
まずあなたを正確に知り、|目的をあなたの言葉で確かめます。''')) + '\n'
        + fold('合う場所と、順番を決める', jp('''TikTok、YouTube、Instagram、ライブ配信。
あなたに合う場所と、|いつ、何を、どう出すかを決めて渡します。
迷う時間をなくします。''')) + '\n'
        + fold('目標が変わっても、続ける', jp('''伸びているかを一緒に見て、|次の一手を決めます。
目標が変わったら、|進め方を組み直して続けます。
これまでのファンと作品を活かして、|続きから。''')) + '\n'
        + fold('SNSアカウントの運用支援', jp('''投稿の計画、制作、分析、改善。
ライブ配信の企画と継続まで、|あなたの活動に合わせて、|続けられる形で支えます。''')) + '\n'
        + fold('表現と案件・広告の確認', jp('''発信の内容や、タイアップ・広告の表現に|問題がないかを公開前に確かめます。
長く安心して活動できる土台を守ります。''')) + '\n'
        + fold('AIと、最初の地図から', jp('''最初の相談で、|目的と今いる場所、最初の一歩を|地図にして返します。
毎日の次の一手も、AIが材料を揃え、|決めるのはあなたです。''')) + '\n'
        + fold('案件と商品の紹介', jp('''企業の案件や、商品の紹介。
表現の確認を通ったものだけを、|入口に届けます。''')) + '\n'
        + fold('ファンへの直販', jp('''知識、作品、会員権を、|あなたの価格で直接売れます。
クリエイターの手数料は0%。|購入時のシステム利用料は、|買う人に明示します。''')) + '\n'
        + fold('記録は、あなたのもの', jp('''収益、仕事、やり取りの記録は|あなたのものです。
いつでも持ち出せます。''')) + '\n'
        + fold('映像制作から、共同事業へ', jp('''映像をつくるところから始めて、
一緒に事業をつくるところまで。''')) + '\n'
        '          </div>') + \
section('promise', 'Our promise', 'REYZの約束', '', PROMISE) + \
section('how', 'How it works', 'はじめ方', '',
        steps([('01', '相談', jp('''まずは現在の状況を伺います。
その上で、その人に合った|活動方法を共に考えます。''')),
               ('02', '設計', jp('''活動方法が決まったら、
いつから、何を、どのように進めていくか。
様々な視点から、戦略や計画を設計します。''')),
               ('03', '伴走', jp('''状況や状態を確認しながら、
目的実現に向けて|共に進んでいきます。'''))], cls='list') + more('contact.html', '相談する'))
page('creator.html', 'Creator — REYZ Inc.', 'REYZのクリエイター向けサービス。あなたに合う場所と順番を決め、TikTok LIVEエージェンシー、動画・映像制作、SNSアカウントの運用支援で、活動を収入に変える。目標が変わっても、続きます。', creator)

# ------------------------------------------------------------------ CREATIVE（エンタープライズ事業）
# 2026-10-23 CEO 指示: 読者は開発者ではない。「誰のため／こんな困りごとに／REYZがすること／REYZの約束／進め方／やらないこと」の順。
# 映像制作・SNSアカウント運用支援・業務効率化・意思決定支援を統合（既決は変更せず追加）。実績・数字・顧客名は置かない。
SHOWCASE = ('<div class="showcase reveal">\n'
    '            <figure class="frame wide study"><div class="study-guides" aria-hidden="true"><span class="safe"></span><span class="thirds"></span><span class="att"></span><span class="cap-block"><b></b><b></b></span></div><figcaption><span class="tag">Brand movie · PR · Recruit</span><strong>' + jp('企業の目的を、|見る人の行動を変える映像に。') + '</strong><span>' + jp('企画、脚本、撮影、編集、|広告表現の確認まで、一貫して。') + '</span></figcaption></figure>\n'
    '            <div class="phones">\n'
    '              <figure class="frame tall study"><div class="study-guides" aria-hidden="true"><span class="safe"></span><span class="att a1"></span><span class="hook"><b></b></span></div><figcaption><span class="tag">認知</span><strong>企画型</strong><span>' + jp('最初の2秒で引き込み、|伝えたいことへつなぐ。') + '</span></figcaption></figure>\n'
    '              <figure class="frame tall study"><div class="study-guides" aria-hidden="true"><span class="safe"></span><span class="att a2"></span><span class="cap-block v"><b></b><b></b><b></b></span></div><figcaption><span class="tag">信頼</span><strong>裏側ドキュメント型</strong><span>' + jp('商品、サービス、働く人の魅力を、|事実のまま見せる。') + '</span></figcaption></figure>\n'
    '              <figure class="frame tall study"><div class="study-guides" aria-hidden="true"><span class="safe"></span><span class="att a3"></span><span class="cta-block"><b></b></span></div><figcaption><span class="tag">行動</span><strong>導線直結型</strong><span>' + jp('相談、購買、応募へ、|迷わず進める。') + '</span></figcaption></figure>\n'
    '            </div>\n'
    '          </div>')
# 2026-10-26 正本 §13: 「The first sheet（一枚）」の節を、企業の 3 つの画面「地図・確認・記録」に置き換える（設計上の見本と明記）
SCREENS_ENT = ('<div class="screens3 reveal">\n'
    '            <div class="sheet-head"><p class="eyebrow">Three screens · 設計上の見本</p><h3>' + jp('地図・確認・記録。') + '</h3></div>\n'
    '            <div class="phones3">\n'
    + phone('map', '地図', SCR_MAP, jp('目的、今いる場所、次の一手、|確認の結果が、ひとつの画面に。\n「はい」か「いいえ」で決める。|目的が変わったら、引き直す。'))
    + phone('check', '確認', SCR_CHECK, jp('公開前に、表現と取引の条件を|きまりに照らす。\n提供元の異なる複数のAIが確かめ、|一致しないものは止まる。|最後は人が決める。'))
    + phone('rec', '記録', SCR_REC, jp('決定ごとに、何を、どのきまりで、|誰が、いつ決めたかを、|あとから変えられない形で残す。\n記録は企業のもの。|いつでも持ち出せる。')) +
    '            </div>\n'
    '            <div class="decide"><p>' + jp('決めるのは、あなたです。|会議でゼロから悩む必要はありません。') + '</p><span class="pill yes">はい：この内容で進める</span><span class="pill">いいえ：条件を変えて、組み直す</span></div>\n'
    '            <p class="gate-note">' + jp('確認を通った案件と商品だけが、|クリエイターの入口に届きます。') + '</p>\n'
    '            <div class="terms">\n'
    '              <p class="terms-head">はっきり言えること</p>\n'
    '              <ul>\n'
    '                <li>' + jp('公的なきまりと自主基準に照らして確かめ、|判断の材料を渡します。|法律の鑑定ではありません。') + '</li>\n'
    '                <li>' + jp('提供元の異なる複数のAIが確かめ、|一致しないものは止まります。|後戻りできない決定は、|人が「はい」か「いいえ」で決めます。') + '</li>\n'
    '                <li>' + jp('決定ごとの記録を残し、|企業が持ち出せます。') + '</li>\n'
    '                <li>' + jp('クリエイターの報酬から取りません。|報酬はREYZの口座を通しません。') + '</li>\n'
    '                <li>' + jp('自社ブランドでの提供も、|いまの仕組みへの組み込みもできます。') + '</li>\n'
    '              </ul>\n'
    '            </div>\n'
    '          </div>')
SHIFT = ('<div class="shift reveal">\n'
    '            <div class="row"><span class="k">今</span><div class="bars"><span class="bar">調査</span><span class="bar">台本</span><span class="bar">編集</span><span class="bar">確認</span><span class="bar">集計</span><span class="bar">進行管理</span><span class="bar">決める・伝える</span></div></div>\n'
    '            <div class="row"><span class="k">REYZと</span><div class="bars"><span class="bar ai">' + jp('人がやらなくていい仕事は、|AIと仕組みへ') + '</span><span class="bar human">' + jp('人は、|決めることと伝えることに') + '</span></div></div>\n'
    '          </div>')
creative = title_chapter('Creative', 'For Enterprise', '「伝わる」を設計する。',
                         jp('何をつくるか。その前に、誰に、何を届けるか。\n事業の目的から、一緒に考えます。')) + \
section('pain', 'For you', 'こんな困りごとに', '',
        stages([('誰のため', '目的を最短で実現し、利益を増やしたい企業の方へ'),
                ('こんな困りごとに', '映像、SNS、仕事の流れ、判断の迷い'),
                ('REYZがすること', '進め方の設計、映像制作、SNS運用、仕組みづくり、判断の支え'),
                ('任せ方', '最初の相談で、地図を返します')]) +
        pains([jp('映像制作やSNSの運用を始めたい、見直したい。|でも、いつ、何を、どう進めれば|目的につながるのか、迷っている。'),
               jp('人を増やさずに、利益を増やしたい。|でも、制作、確認、運用に時間を取られ、|本来の仕事に集中できていない。'),
               jp('提案や選択肢が多すぎて、|会議のたびに「結局どちらに進むか」を|決めきれず、速度が落ちている。')])) + \
section('show', 'Video × SNS', '映像とSNSの、かたち。', jp('「きれい」で終わらせない。|誰に、何を届け、どう動いてもらうか。|目的から逆算してつくります。'),
        SHOWCASE +
        sub(jp('横の映像と、縦の映像を、|ひとつの設計で。'), jp('ブランド映像、商品・サービスの紹介、採用の映像。|TikTok、Instagram Reels、YouTube Shorts向けの縦型まで。|SNSの3つの型は、見る人の段階に合わせて使い分けます。')) +
        sub(jp('つくって終わりにしない。|続け方。')) +
        cycle([('目的と相手を知る', '何のために、誰に。'),
               ('いつ、何を、どう', '進め方を決めて渡す。'),
               ('制作と投稿', '映像をつくり、出す。'),
               ('記録で報告', '何が効いたかを、事実で。'),
               ('目標が変わったら', '組み直して、続きから。')])) + \
section('services', 'Services', 'REYZがすること', '',
        items_fold([('目的を言葉にし、進め方を決める', jp('何のために、いつまでに、何を。|目的を正確に汲み取り、|いつ、何を、どう進めるかを決めて渡します。\n目的が変わったら、|進め方を組み直して続けます。')),
               ('最小の人数で、最大の利益を', jp('調査、台本、一次制作、進行管理、集計。|人がやらなくていい仕事を|AIと仕組みに移します。\n人は決めることと伝えることに集中し、|少ない人数で利益を生む体制をつくります。')),
               ('判断を、「はい」か「いいえ」で', jp('迷う原因は、材料が整っていないことです。\n目的への効き目、根拠、リスク、案を|地図にまとめて出します。|迷わず決められるところまで持っていきます。')),
               ('動画・映像制作', jp('会社、商品、採用、発信。|伝えたいことを、使われる映像に。\n企画から撮影、編集、公開後の運用まで、|自社で行います。')),
               ('SNSアカウントの運用支援', jp('立ち上げと見直し、企画と台本、撮影と編集、|毎日の投稿、数字の振り返り。\n感覚ではなく事実で確かめ、|会社の資産になるアカウントを育てます。')),
               ('ブランドと制作', jp('ブランドの方向づけ、|サイト・映像・SNSの制作と運用。\nこのサイトも、|自社で設計・制作しています。')),
               ('サイトと業務の仕組みづくり', jp('映像とSNSの受け皿になるサイトから、|社内で使う仕組みまで。\n使う人と仕事の流れから、|必要なものを整理してつくります。')),
               ('クリエイターとの販売設計', jp('クリエイターと連動した|販売の設計と運用。|国内からアジアへの越境販売まで。')),
               ('公開前の確認', jp('ステマ規制、景品表示法、|医療広告ガイドライン、薬機法に照らし、|提供元の異なる複数のAIが確かめ、|人が決め、記録を残します。\n公的なきまりとの照合であり、|法律の鑑定ではありません。')),
               ('事務所・代理店の方へ', jp('クリエイター事務所、代理店、制作会社の方へ。\n3つの画面と、|費用ゼロでやめるのも自由な契約の型、|公開前の確認を、\n自社ブランドで提供したり、|いまの仕組みに組み込んだりできます。'), 'consensus.html', 'REYZ CONSENSUSについて'),
               ('AIを仕事に入れる', jp('仕事の流れの設計から|実際の運用までを、|自社の仕組み「REYZ PLATFORM」で。'), 'ai.html', 'REYZ PLATFORMについて')], 3)) + \
section('decide', 'Decide', '判断を、地図で。', jp('経営者も担当者も、|「はい」か「いいえ」を|選ぶだけにします。'),
        SCREENS_ENT +
        sub(jp('人がやらなくていい仕事を、|AIと仕組みへ。')) + SHIFT) + \
section('promise', 'Our promise', 'REYZの約束', jp('「任せたい」は、強い言葉からではなく、|守る仕組みから生まれます。'), PROMISE) + \
section('how', 'How it works', '任せ方', jp('いきなり大きな契約を結ぶ必要はありません。\n合わなければ、そこで終えて構いません。'),
        steps([('01', '相談する', jp('今の状況と、|やりたいことを聞かせてください。\nまだ言葉になっていなくても、|構いません。')),
               ('02', '地図を受け取る', jp('目的と今いる場所、|最初の進め方を地図にして返します。')),
               ('03', '「はい」か「いいえ」を決める', jp('合えば始める。合わなければ始めない。\n始めたあとに目標が変わっても、|組み直して続けます。'))], cls='list') +
        more('contact.html', '相談する'))
page('creative.html', 'Creative — REYZ Inc.', 'REYZの企業向けサービス。目的を言葉にして進め方を決め、動画・映像制作、SNSアカウントの運用支援、最小の人数で最大の利益を生む仕組みづくり、「はい」か「いいえ」で決められる判断の支えまで。目的が変わっても、続きます。', creative)

# ------------------------------------------------------------------ AI (Z)（AIプラットフォーム事業）
# 事業内容: 複数のAIエージェントをクリエイターエコノミーと統合運用する自社AI基盤「REYZ PLATFORM」の開発・提供。
#           業務の設計から実装、検証・運用までを、AIと共に。複数のAIによる相互検証と記録を標準とし、監査可能なAI運用を設計段階から組み込む。
# 名称（2026-10-03 CEO 決定）: AI 製品を集約するプラットフォームの名称であり、個別の柱の名前ではない。
# 改名（2026-10-15 CEO 決定 NAMING-001）: Z-PLATFORM→REYZ PLATFORM、Z-DEVELOPER→REYZ DEVELOPER、Cross-AI Flow→REYZ CONSENSUS。ブランド層は全大文字。
# 表示の規律（2026-10-23 CEO）: 開発中・準備中・順次・先行導入などの進行形の状態語は書かない。稼働・実績・顧客数を示す表現は、根拠を併記できるまで書かない（legal.html「表示に関する方針」）。
ai_products = ('<div class="items reveal">\n'
    '            <div class="item"><span class="n">01</span><span class="kw">つなぐ<small>AI Orchestration</small></span><p>' + jp('複数のAIエージェントを、|ひとつの統制のもとで運用するための層。\n提供元の異なるAIを組み合わせ、|特定のAIに依存しない構成にします。') + '</p></div>\n'
    '            <div class="item"><span class="n">02</span><span class="kw">つくる<small>REYZ DEVELOPER</small></span><p>' + jp('開発経験がなくても、|自分の言葉で伝えることから|始められる開発・運用システム。\n公開して終わりではなく、|その後の運用と改善までを|対象にします。') + '</p></div>\n'
    '            <div class="item"><span class="n">03</span><span class="kw">確かめ、進める<small>REYZ CONSENSUS</small></span><p>' + jp('提供元の異なる複数のAIが、|同じ内容を互いに検証し、|合意したものだけを次へ進めます。\n重要な変更には人の承認を必須とし、|すべての判断に、|確認できる記録を残します。') + '</p><a class="go" href="consensus.html">REYZ CONSENSUSについて</a></div>\n'
    '          </div>')
ai = title_chapter('AI', 'REYZ PLATFORM · AI Infrastructure', 'AIが支える。',
                   jp('複数のAIエージェントを統合運用する|AI基盤「REYZ PLATFORM」。')) + \
section('promise', 'Our promise', 'AIの3つの約束', jp('映像制作、SNS運用、仕事の仕組みづくり、判断の支え。|その裏側で動くREYZのAIは、|3つの約束で動きます。'),
        items([('止まる', jp('確認が取れていないこと、|人が決めるべき分かれ道では、|AIは勝手に先へ進めず、止まります。')),
               ('事実から', jp('確かめた事実とデータだけで、|案と判断の材料を組み立てます。\n不確かなことは、|「確認が必要」と正直に示します。')),
               ('見返せる', jp('何を確かめ、誰が、いつ、どの決まりで|進めたか、止めたかを、|あとから見返せる形で残します。\n担当が変わっても、目標が変わっても、|続きから再開できます。'))])) + \
section('products', 'Products', 'REYZ PLATFORM', jp('REYZのAI製品を、|ひとつに集約するプラットフォーム。'), ai_products) + \
section('enterprise', 'For Enterprise', '企業向け提供', jp('AIに任せた判断を、|あとから説明できる状態に。\n監査できるAI運用の基盤を、|企業向けに提供します。\n公開前の表現と広告の確認にも、|同じ仕組みを使います。'),
        items([('相互検証', jp('提供元の異なる複数のAIが、|同じ内容をそれぞれ検証します。\n一致しないものは、|先へ進めません。')),
               ('人の承認', jp('重要な変更は、|責任者の承認を経てから実行します。\nAIだけの判断で、|本番は変わりません。')),
               ('検証できる記録', jp('入力、根拠、判定、承認を記録し、|第三者があとから|同じ判断をたどれるようにします。')),
               ('特定のAIに依存しない構成', jp('複数の提供元を前提に構成します。\nモデルの世代交代や価格の変化に、|構成を変えて対応できます。'))])) + \
section('enterprise-how', 'How it works', '進め方', '',
        steps([('01', '現状の確認', jp('どの業務で、|AIが何を判断しているか。\n判断の重さと、|現在の確認方法を整理します。')),
               ('02', '統制の設計と導入', jp('検証の規則、|人が承認する範囲、|記録の形式を決め、\n既存の業務に組み込みます。')),
               ('03', '運用と報告', jp('AIと共に運用し、|判断の記録を定期的に報告します。\n結果をもとに、|規則を見直します。'))], cls='list') + more('contact.html', '相談する')) + \
section('principles', 'Principles', '原則', '',
        items([('Fail-Closed', jp('不確実なときは、|安全側で止まる。')), ('Fact-First', jp('事実・推論・仮説を|分けて扱う。')), ('Auditable', jp('すべての判断に、|確認できる記録を残す。|監査可能な運用を、|設計段階から。'))]))
page('ai.html', 'AI — REYZ Inc.', 'REYZのAI製品を集約するプラットフォーム「REYZ PLATFORM」。複数のAIによる相互検証、人の承認、検証できる記録を備えた、監査できるAI運用の基盤を企業向けに提供します。', ai)

# ------------------------------------------------------------------ REYZ CONSENSUS（REYZ PLATFORM の製品。2026-10-22 CEO 指示: ホームページから到達できるようにする）
# 表示の規律（2026-10-23 CEO）: 進行形の状態語は書かない。稼働・実績・顧客数を示す表現は、根拠を併記できるまで書かない。
# 到達経路: ai.html の製品 03 のリンク、sitemap。URL は /consensus（拡張子なし、clean()）。
consensus = title_chapter('Consensus', 'REYZ CONSENSUS', jp('確かめてから、|進める。'),
                          jp('提供元の異なる複数のAIが互いに検証し、|合意したものだけを次へ進める。\n後戻りできない決定は人が行い、|すべてに確認できる記録を残す。\nREYZ PLATFORMのAI運用の仕組みです。')) + \
section('what', 'What it is', '仕組み', jp('AIに任せた判断を、|あとから誰にでも説明できる状態に。'),
        items([('相互検証', jp('提供元の異なる複数のAIが、|同じ内容をそれぞれ検証します。\n一致しないものは、|先へ進めません。')),
               ('独立した検証', jp('作る側と確かめる側を分けます。\n記録の同一性と根拠を、|機械と、作る側から独立した検証者が確かめます。')),
               ('人の承認', jp('後戻りできない変更だけを、|責任者が「はい」「いいえ」で決めます。\n技術の知識を前提にしない設計です。')),
               ('検証できる記録', jp('入力、根拠、判定、承認を記録し、|第三者があとから|同じ判断をたどれるようにします。'))])) + \
section('how', 'How it works', '進め方', '',
        steps([('01', '伝える', jp('やりたいことを、|自分の言葉で伝えます。')),
               ('02', '作り、確かめる', jp('複数のAIが作り、互いに検証し、|記録を残します。\n不確実なときは、|安全側で止まります。')),
               ('03', '決めて、反映する', jp('責任者が決め、|承認を経たものだけが反映されます。\nAIだけの判断で、|本番は変わりません。'))], cls='list')) + \
section('offer', 'Offering', '提供の形', jp('ご相談を受け付けています。'),
        items([('企業向け', jp('自社のAI運用に、|検証と承認と記録の統制を組み込みます。')),
               ('自社ブランドでの提供', jp('表示名・配色・ロゴを変えて、|自社の製品として提供できます。\n判断の規則と記録の形式は、|変わりません。')),
               ('仕組みへの組み込み', jp('代理店や制作会社の仕事の流れ、|お使いのツールの中に、\n確認と記録を組み込めます。')),
               ('記録は、企業のもの', jp('確認と決定の記録は、|企業のものです。\nいつでも持ち出せます。')),
               ('特定のAIに依存しない構成', jp('複数の提供元を前提に構成します。\nモデルの世代交代や価格の変化に、|構成を変えて対応できます。'))]) +
        more('contact.html', '相談する') + more('ai.html', 'REYZ PLATFORMについて'))
page('consensus.html', 'REYZ CONSENSUS — REYZ Inc.', 'REYZ CONSENSUS — 提供元の異なる複数のAIが互いに検証し、合意したものだけを次へ進める。後戻りできない決定は人が行い、すべてに確認できる記録を残す、REYZ PLATFORMのAI運用の仕組み。', consensus)

# ------------------------------------------------------------------ CONTACT
# ご用件は事業内容（3事業）と各ページの導線に対応: クリエイターの方（Creator）／企業の方（Creative・AI）／その他
form = '''<form class="panel reveal" id="contactForm" novalidate>
            <div class="step" id="stepForm">
              <label>お名前（個人名または会社名）<input id="cName" name="name" type="text" autocomplete="name" required></label>
              <label>ご担当者<input id="cPerson" name="person" type="text" autocomplete="off" placeholder="法人の場合"></label>
              <div class="field" role="group" aria-labelledby="emailLabel">
                <span class="field-label" id="emailLabel">メールアドレス</span>
                <div class="email-row">
                  <input id="cLocal" name="email_local" type="text" autocapitalize="off" spellcheck="false" autocomplete="off" aria-label="メールアドレス（@より前）" required>
                  <span class="at" aria-hidden="true">@</span>
                  <select id="cDomain" name="email_domain" aria-label="メールアドレスのドメイン" required>
                    <option value="">選択</option>
                    <option>gmail.com</option>
                    <option>icloud.com</option>
                    <option>yahoo.co.jp</option>
                    <option>outlook.jp</option>
                    <option>outlook.com</option>
                    <option>hotmail.com</option>
                    <option>docomo.ne.jp</option>
                    <option>au.com</option>
                    <option>ezweb.ne.jp</option>
                    <option>softbank.ne.jp</option>
                    <option>i.softbank.jp</option>
                    <option value="__other">その他（入力）</option>
                  </select>
                </div>
                <input id="cDomainOther" name="email_domain_other" type="text" autocapitalize="off" spellcheck="false" autocomplete="off" aria-label="ドメインを入力" placeholder="example.co.jp" hidden>
                <input id="cEmail" name="email" type="email" hidden tabindex="-1">
              </div>
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
                    <option>ブランディング・制作</option>
                    <option>サイト・業務の仕組みづくり</option>
                    <option>クリエイターとの販売設計</option>
                    <option>表現・広告の確認</option>
                    <option>公開前の確認と記録（REYZ CONSENSUS）</option>
                    <option>自社ブランドでの提供・仕組みへの組み込み</option>
                    <option>AIを仕事に使う（REYZ PLATFORM）</option>
                  </optgroup>
                  <optgroup label="その他">
                    <option>取材・提携</option>
                    <option>その他</option>
                  </optgroup>
                </select>
              </label>
              <label>内容（ご要望・質問・相談等）<textarea id="cMsg" name="message" required></textarea></label>
              <input id="cWebsite" name="website" type="text" tabindex="-1" autocomplete="off" hidden>
              <div class="ctas tight">
                <button class="btn primary" type="submit" id="confirmBtn">確認する</button>
              </div>
              <div class="status" id="status" role="status" aria-live="polite"></div>
              <noscript><p class="lead">JavaScriptが無効の環境では送信できません。フッター記載の連絡先へお問い合わせください。</p></noscript>
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
section('form', 'Message', 'お問い合わせ', '内容をお送りください。担当者より直接ご返信します。', form)
page('contact.html', 'Contact — REYZ Inc.', 'REYZ Inc. へのお問い合わせ。', contact)

# ------------------------------------------------------------------ LEGAL
# WORKS は作品例ページと、個人情報の取り扱い（YouTube 埋め込みの注記）の両方が参照する
WORKS = [
]
if os.environ.get('WORKS_JSON'):                                     # 検証用: 一時的な作品リストで組む
    WORKS = json.load(open(os.environ['WORKS_JSON'], encoding='utf-8'))
YT_NOTICE = '\n            <p>作品例ページでは YouTube の埋め込みプレイヤー（プライバシー強化モード）を利用しており、サムネイルの表示および再生時に接続情報が Google に送信されます。</p>' if any(w.get('yt') for w in WORKS) else ''
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
            <p>本サイトはフォント配信に Google Fonts を利用しており、閲覧時にIPアドレス等の接続情報が Google に送信されます。</p>{YT_NOTICE}
          </div>
        </div>'''
legal = title_chapter('line', 'Privacy &amp; Legal', '法令に基づく表記', '') + f'''    <section class="section" id="notices">
      <div class="wrap"><div class="section-text">{legal_grid}</div></div>
    </section>
'''
page('legal.html', 'Privacy & Legal — REYZ Inc.', '株式会社レイズの法令に基づく表記。宅地建物取引業者、古物営業法に基づく表記、表示に関する方針、個人情報の取り扱い。', legal)

# ------------------------------------------------------------------ WORKS（作品例）
# 作品は YouTube（推奨）または自社配信の mp4。ここに1行追加してビルドすると掲載される。
#   YouTube: { 'yt': '<動画URL または 11桁ID>', 'title': '作品名', 'note': 'PV／2026', 'poster': 'assets/works/xx.jpg'(任意) }
#            → クリックするまで YouTube の iframe は読み込まない（サムネイル＋再生マークだけ）。埋め込みは youtube-nocookie.com（プライバシー強化モード）。
#            YouTube 側の条件: 公開 or 限定公開（非公開は不可）、動画の「埋め込みを許可する」が ON。
#   mp4    : { 'src': 'assets/works/work-01.mp4', 'poster': 'assets/works/work-01.jpg', 'title': '作品名', 'note': 'PV／2026' }

YT_ID = re.compile(r'^[A-Za-z0-9_-]{11}$')
def yt_id(v):
    """YouTube の URL（watch / youtu.be / shorts / embed / live）または ID → 11桁の ID。解釈できなければビルドを止める。"""
    v = v.strip()
    if YT_ID.match(v): return v
    m = re.search(r'(?:youtu\.be/|[?&]v=|/shorts/|/embed/|/live/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])', v)
    if not m: raise SystemExit(f'WORKS: YouTube の URL/ID を解釈できません: {v!r}')
    return m.group(1)

def works_list():
    out = []
    for i, w in enumerate(WORKS, 1):
        title = w.get('title', '')
        cap = ''
        if title or w.get('note'):
            cap = f'<figcaption><span class="n">{i:02d}</span>'
            if title: cap += f'<span class="t">{html.escape(title)}</span>'
            if w.get('note'): cap += f'<span class="d">{html.escape(w["note"])}</span>'
            cap += '</figcaption>'
        cap_line = ('\n            ' + cap) if cap else ''
        if w.get('yt'):
            vid = yt_id(w['yt'])
            poster = html.escape(w['poster']) if w.get('poster') else f'https://i.ytimg.com/vi/{vid}/hqdefault.jpg'
            data_poster = (' data-poster="' + html.escape(w['poster']) + '"') if w.get('poster') else ''
            label = html.escape(f'再生: {title}' if title else '再生')
            out.append('          <figure class="work" data-yt="' + vid + '"' + data_poster + '>\n'
                       '            <a class="yt" href="https://www.youtube.com/watch?v=' + vid + '" target="_blank" rel="noopener" aria-label="' + label + '">'
                       '<img src="' + poster + '" alt="" width="1280" height="720" loading="lazy" decoding="async"><span class="play" aria-hidden="true"></span></a>'
                       + cap_line + '\n          </figure>')
        else:
            src = html.escape(w['src'])
            poster = (' poster="' + html.escape(w['poster']) + '"') if w.get('poster') else ''
            out.append('          <figure class="work" data-src="' + src + '">\n'
                       '            <video controls playsinline preload="metadata"' + poster + '><source src="' + src + '" type="video/mp4"></video>'
                       + cap_line + '\n          </figure>')
    # 2026-10-23 CEO: 「準備中」「ご相談の際に」等の注記は書かない。作品が 0 件のときは一覧セクションを出さない
    if not out: return ''
    return section('list', 'Selected works', '映像', '', '<div class="works reveal" id="works">\n' + '\n'.join(out) + '\n        </div>')
BACK = '    <section class="section" id="back"><div class="wrap"><div class="section-text"><h2 class="sr-only">戻る</h2><p class="more reveal"><a class="go" href="creator.html">クリエイターの方へ</a></p><p class="more reveal"><a class="go" href="creative.html">企業の方へ</a></p></div></div></section>\n'
works = title_chapter('Works', 'Works', '作品例', '※個人情報の観点から一部のみ掲載', lead_cls='lead note') + works_list() + BACK
page('works.html', 'Works — REYZ Inc.', 'REYZが企画・撮影・編集した映像作品の例。', works)

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
            ''.join(f'  <url><loc>{SITE_URL}/{clean(p)}</loc></url>\n' for p in PAGES) + '</urlset>\n')
# Cloudflare Pages / Netlify が読む付属設定（他のホスティングでは無視される）
host = SITE_URL.split('//', 1)[1]
with open(os.path.join(ROOT, '_headers'), 'w', encoding='utf-8') as f:
    f.write('/*\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: SAMEORIGIN\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Strict-Transport-Security: max-age=31536000\n/assets/*\n  Cache-Control: public, max-age=86400\n')
with open(os.path.join(ROOT, '_redirects'), 'w', encoding='utf-8') as f:
    f.write(f'https://www.{host}/* {SITE_URL}/:splat 301\n')
print('built', sorted(f for f in os.listdir(ROOT) if f.endswith('.html')), '+ robots.txt sitemap.xml _headers _redirects', 'SITE_URL =', SITE_URL)
