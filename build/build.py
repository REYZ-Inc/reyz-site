# -*- coding: utf-8 -*-
"""REYZ Inc. corporate site v6 — static build (narrative + sticky particle stage).
Run: python3 build/build.py  → writes ./site/*.html"""
import os, re, html, json

ROOT = os.environ.get('SITE_OUT') or os.path.join(os.path.dirname(__file__), '..', 'site')   # SITE_OUT: 検証用の別出力先
SITE_URL = os.environ.get('SITE_URL', 'https://reyz.inc')   # 公開ドメイン（canonical / og:url / og:image / sitemap）。末尾スラッシュなし
NAV = [('creator.html', 'Creator'), ('creative.html', 'Creative'), ('ai.html', 'AI'), ('index.html#reyz', 'Company'), ('contact.html', 'Contact')]
ADDRESS = '東京都渋谷区恵比寿1丁目19-19 恵比寿ビジネスタワー10階'
ICON = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2064%2064'%3E%3Crect%20width='64'%20height='64'%20rx='14'%20fill='%23060609'/%3E%3Cpath%20d='M18%2032c0-6%204-9%208-9s6%203%208%209%204%209%208%209%208-3%208-9-4-9-8-9-6%203-8%209-4%209-8%209-8-3-8-9z'%20fill='none'%20stroke='%23F715AC'%20stroke-width='2.4'%20stroke-linecap='round'/%3E%3C/svg%3E"

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
  <meta property="og:url" content="{SITE_URL}/{'' if fname == 'index.html' else fname}">
  <meta property="og:image" content="{SITE_URL}/assets/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="canonical" href="{SITE_URL}/{'' if fname == 'index.html' else fname}">
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
    with open(os.path.join(ROOT, fname), 'w', encoding='utf-8') as f: f.write(doc)

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
def title_chapter(word, eyebrow, h1, lead, lead_cls='lead'):
    return f'''    <section class="chapter page-head" id="top">
      <div class="wrap chapter-stack">
        {slot(word, halo=True)}
        <div class="head copy"><p class="eyebrow">{eyebrow}</p><h1 class="page-title">{h1}</h1>{('<p class="' + lead_cls + '">' + lead + '</p>') if lead else ''}</div>
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
    '              <li><span class="k">エンタープライズ事業</span><span class="v">' + jp('''戦略・ブランド・マーケティングを、[AIとデータで|企業の成長設計へ統合する。]
表現と広告の適法性検証まで、|一貫して担う。''') + '</span></li>\n'
    '              <li><span class="k">AIプラットフォーム事業</span><span class="v">' + jp('''複数のAIエージェントを[クリエイターエコノミーと|統合運用する]
自社AI基盤「Z」の開発・提供。
業務の設計から実装、|検証・運用までを、|AIと共に。
複数のAIによる|相互検証と記録を標準とし、
監査可能なAI運用を|設計段階から組み込む。''') + '</span></li>\n'
    '            </ul>')
PROFILE = f'''<dl class="profile">
            <div class="row"><dt>社名</dt><dd>株式会社レイズ <span class="en">REYZ Inc.</span></dd></div>
            <div class="row"><dt>代表取締役</dt><dd>堀内智一</dd></div>
            <div class="row"><dt>創業</dt><dd>2022年1月</dd></div>
            <div class="row"><dt>資本金</dt><dd>1,000万円</dd></div>
            <div class="row wide"><dt>所在地</dt><dd><address>〒150-0013<br>東京都渋谷区恵比寿1丁目19-19<br>恵比寿ビジネスタワー10階</address><a class="maplink" href="https://www.google.com/maps/search/?api=1&amp;query=%E6%9D%B1%E4%BA%AC%E9%83%BD%E6%B8%8B%E8%B0%B7%E5%8C%BA%E6%81%B5%E6%AF%94%E5%AF%BF1%E4%B8%81%E7%9B%AE19-19%20%E6%81%B5%E6%AF%94%E5%AF%BF%E3%83%93%E3%82%B8%E3%83%8D%E3%82%B9%E3%82%BF%E3%83%AF%E3%83%BC" target="_blank" rel="noopener">地図で開く</a></dd></div>
            <div class="row wide"><dt>事業内容</dt><dd>{BIZ}</dd></div>
            <div class="row wide"><dt>許認可</dt><dd><span class="lic"><span>宅地建物取引業免許</span>東京都知事（1）第110185</span><span class="lic"><span>古物商許可</span>東京都公安委員会 第303312620413</span></dd></div>
          </dl>'''

# ------------------------------------------------------------------ HOME
home = f'''    <section class="chapter" id="infinity">
      <div class="wrap chapter-stack">
        {slot('infinity', halo=True)}
        <div class="head copy">
          <h1><span>無限の可能性を</span><span>かたちに</span></h1>
          <p class="hero-sub">From Japan, <em>beyond.</em></p>
        </div>
      </div>
    </section>
    <section class="chapter" id="origin">
      <div class="wrap chapter-stack">
        {slot('seed')}
        <div class="head copy">
          <h2>ひとつの意志から。</h2>
          <p class="lead">REYZは、クリエイターエコノミーとAIを接続し、<br>クリエイター及び、企業の活動を支援します。</p>
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
        <a class="gate copy" href="ai.html">
          <p class="eyebrow">Z · AI Infrastructure</p>
          <h2>AIが支える。</h2>
          <p class="lead">考える人、つくる人、動かす人を。</p>
          <span class="go">AI</span>
        </a>
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
page('index.html', 'REYZ Inc. — 無限の可能性を かたちに', '株式会社レイズ（REYZ Inc.）— Creator Economy × AI。クリエイターと企業の活動を、AIとともに設計する会社です。', home, current='index.html')

# ------------------------------------------------------------------ CREATOR
# 本文の改行は本人指定（2026-09-27）。'|' は画面幅が足りない時だけ使う折返し点
TT_P1 = jp('''TikTok正規一次代理店として、
ライブ初心者から|収益化までを支援します。''')
TT_P2 = jp('''費用・ノルマ・ペナルティなどは|一切なく、
ギフト報酬は100%還元致します。''')
TT_NOTE = jp('''※私達は、TikTok社から委託を受けて|運営しているため、
ライバーさんの収益から|手数料を搾取する|モデルではありません。''')
VD_H3 = jp('動画・映像制作[（PR・PV・MV・|ドキュメンタリー・ドラマ）]')
VD_P = jp('''インフルエンス力向上、ブランド化、リブランディングなど、
それぞれが抱える|現状の課題や目的を明確にし、
その目的を実現させるための企画、撮影、編集までを、
自社ですべて行います。''')
creator = title_chapter('Creator', 'For Creators', '「生き方」を職業に。', 'あなたの活動を収入に変える設計を。') + \
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
        '          </div>') + \
section('how', 'How it works', 'はじめ方', '',
        steps([('01', '相談', jp('''まずは現在の状況を伺います。
その上で、その人に合った|活動方法を共に考えます。''')),
               ('02', '設計', jp('''活動方法が決まったら、
いつから、何を、どのように進めていくか。
様々な視点から、戦略や計画を設計します。''')),
               ('03', '伴走', jp('''状況や状態を確認しながら、
目的実現に向けて|共に進んでいきます。'''))], cls='list') + more('contact.html', '相談する'))
page('creator.html', 'Creator — REYZ Inc.', 'REYZのクリエイター向けサービス。TikTok LIVEエージェンシー、動画・映像制作。あなたの活動を収入に変える設計を。', creator)

# ------------------------------------------------------------------ CREATIVE（エンタープライズ事業）
# 事業内容: 戦略・ブランド・マーケティングを、AIとデータで企業の成長設計へ統合する。表現と広告の適法性検証まで、一貫して担う。
creative = title_chapter('Creative', 'For Enterprise', '「伝わる」を設計する。',
                         jp('戦略・ブランド・マーケティングを、|AIとデータで|ひとつの成長設計に。\n表現と広告の適法性検証まで、|一貫して担います。')) + \
section('services', 'Services', '提供すること', '',
        items([('成長設計', jp('事業・ブランド・マーケティングの戦略を、|AIとデータで統合し、|ひとつの成長設計として構築します。')),
               ('ブランドと制作', jp('ブランド戦略、|企業・専門家のブランディング、|サイト・映像・SNSの制作と運用。')),
               ('クリエイターとの販売設計', jp('クリエイターと連動した|販売の設計と運用。|国内からアジアへの越境販売まで。')),
               ('表現と広告の検証', jp('ステマ規制、景品表示法、|医療広告ガイドライン、薬機法に照らし、|公開前に表現を検証します。')),
               ('AI導入', jp('業務の設計から実装、|検証・運用までをAIと共に進める体制を、|自社AI基盤「Z」で構築します。'), 'ai.html', 'Zについて')])) + \
section('how', 'How it works', '進め方', '',
        steps([('01', '診断', jp('事業・ブランド・表現の現状を、|データで確認します。')),
               ('02', '設計と検証', jp('戦略・チャネル・表現を設計し、|公開前に法令への適合を検証します。')),
               ('03', '運用と改善', jp('AIと共に運用し、|結果をもとに改善を続けます。'))], cls='list') + more('contact.html', '相談する'))
page('creative.html', 'Creative — REYZ Inc.', 'REYZの企業向けサービス。戦略・ブランド・マーケティングをAIとデータで成長設計へ統合し、表現と広告の適法性検証まで一貫して担います。', creative)

# ------------------------------------------------------------------ AI (Z)（AIプラットフォーム事業）
# 事業内容: 複数のAIエージェントをクリエイターエコノミーと統合運用する自社AI基盤「Z」の開発・提供。
#           業務の設計から実装、検証・運用までを、AIと共に。複数のAIによる相互検証と記録を標準とし、監査可能なAI運用を設計段階から組み込む。
ai_products = ('<div class="items reveal">\n'
    '            <div class="item"><span class="n">01</span><span class="kw">つなぐ<small>Z-PLATFORM</small></span><p>' + jp('複数のAIエージェントを、|事業の実行と統制のもとで|統合運用する基盤。\nクリエイターエコノミーの現場で、|日々稼働しています。') + '</p></div>\n'
    '            <div class="item"><span class="n">02</span><span class="kw">つくる<small>Z-DEVELOPER</small></span><p>' + jp('開発経験がなくても、|自分の言葉で伝えることから|本番公開と運用まで進められる開発OS。') + '</p></div>\n'
    '            <div class="item"><span class="n">03</span><span class="kw">確かめ、進める<small>Cross-AI Flow</small></span><p>' + jp('複数のAIが互いに検証し、|合意した事実だけを次へ進める|意思決定の流れ。\nすべての判断に、|確認できる記録が残ります。') + '</p></div>\n'
    '          </div>')
ai = title_chapter('AI', 'Z · AI Infrastructure', 'AIが支える。',
                   jp('複数のAIエージェントを統合運用する|AI基盤「Z」。')) + \
section('products', 'Products', 'Zの三つの柱', '', ai_products) + \
section('enterprise', 'For Enterprise', '企業向け提供', jp('業務の設計から実装、検証・運用までを、|AIと共に。'),
        steps([('01', '設計', jp('業務と判断の流れを、|AIと人の役割に分けて設計します。')),
               ('02', '実装', jp('Zの上にエージェントを構成し、|既存の業務・データと接続します。')),
               ('03', '検証・運用', jp('複数のAIによる相互検証と記録を標準に、|監査可能な状態で運用します。'))], cls='list') + more('contact.html', '相談する')) + \
section('principles', 'Principles', '原則', '',
        items([('Fail-Closed', jp('不確実なときは、|安全側で止まる。')), ('Fact-First', jp('事実・推論・仮説を|分けて扱う。')), ('Auditable', jp('すべての判断に、|確認できる記録を残す。|監査可能な運用を、|設計段階から。'))]))
page('ai.html', 'AI — REYZ Inc.', '複数のAIエージェントを統合運用する自社AI基盤「Z」。Z-PLATFORM、Z-DEVELOPER、Cross-AI Flow を柱に、監査可能なAI運用を企業向けに提供します。', ai)

# ------------------------------------------------------------------ CONTACT
# ご用件は事業内容（3事業）と各ページの導線に対応: クリエイターの方（Creator）／企業の方（Creative・AI）／その他
form = '''<form class="panel reveal" id="contactForm" novalidate>
            <div class="step" id="stepForm">
              <label>お名前（個人名または会社名）<input id="cName" name="name" type="text" autocomplete="name" required></label>
              <label>ご担当者様<input id="cPerson" name="person" type="text" autocomplete="off" placeholder="法人の場合"></label>
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
                    <option>成長設計・マーケティング</option>
                    <option>ブランディング・制作</option>
                    <option>クリエイターとの販売設計</option>
                    <option>表現・広告の適法性検証</option>
                    <option>AI基盤「Z」・SaaS導入</option>
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
legal_grid = '''<div class="legal-grid reveal">
          <div class="legal-block">
            <h2>宅地建物取引業者</h2>
            <dl>
              <div><dt>商号</dt><dd>株式会社レイズ</dd></div>
              <div><dt>免許証番号</dt><dd>東京都知事（1）第110185</dd></div>
              <div><dt>代表者</dt><dd>堀内智一</dd></div>
              <div><dt>主たる事務所</dt><dd>''' + ADDRESS + '''</dd></div>
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
            <p>本サイトはフォント配信に Google Fonts を利用しており、閲覧時にIPアドレス等の接続情報が Google に送信されます。</p>
            <p>作品例ページでは YouTube の埋め込みプレイヤー（プライバシー強化モード）を利用しており、サムネイルの表示および再生時に接続情報が Google に送信されます。</p>
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
WORKS = [
]
if os.environ.get('WORKS_JSON'):                                     # 検証用: 一時的な作品リストで組む
    WORKS = json.load(open(os.environ['WORKS_JSON'], encoding='utf-8'))

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
    # 作品が 0 件のときは注記をビルド時点で表示（JS 不要）。1 件以上あるときは hidden にし、全動画が欠けた場合だけ JS が表示する
    empty_attr = '' if not WORKS else ' hidden'
    body = ('\n'.join(out) + '\n') if out else ''
    return '<div class="works reveal" id="works">\n' + body + f'          <p class="lead works-empty" id="worksEmpty"{empty_attr}>作品例は準備中です。</p>\n        </div>'
works = title_chapter('Works', 'Works', '作品例', '※個人情報の観点から一部のみ掲載', lead_cls='lead note') + \
section('list', 'Selected works', '映像', '', works_list())
page('works.html', 'Works — REYZ Inc.', 'REYZが企画・撮影・編集した映像作品の例。', works)

# ------------------------------------------------------------------ 公開用の付属ファイル
not_found = title_chapter('loop', 'Not found', 'ページが見つかりません。', jp('URL が変わったか、|存在しないページです。')) + \
    '    <section class="section" id="back"><div class="wrap"><div class="section-text"><h2 class="sr-only">戻る</h2><p class="more reveal"><a class="go" href="index.html">ホームへ</a></p></div></div></section>\n'
page('404.html', 'Not found — REYZ Inc.', 'ページが見つかりません。', not_found)
PAGES.remove('404.html')
# 404 はどの階層の URL でも配信されるため、相対パスを絶対パスに書き換える（assets／各ページへのリンク）
_p404 = os.path.join(ROOT, '404.html'); _d = open(_p404, encoding='utf-8').read()
_d = re.sub(r'(href|src)="assets/', r'\1="/assets/', _d)
_d = re.sub(r'href="index\.html(#[^"]*)?"', lambda m: 'href="/' + (m.group(1) or '') + '"', _d)
_d = re.sub(r'href="((?:creator|creative|ai|contact|legal|works)\.html)"', r'href="/\1"', _d)
open(_p404, 'w', encoding='utf-8').write(_d)
with open(os.path.join(ROOT, 'robots.txt'), 'w', encoding='utf-8') as f:
    f.write(f'User-agent: *\nAllow: /\nSitemap: {SITE_URL}/sitemap.xml\n')
with open(os.path.join(ROOT, 'sitemap.xml'), 'w', encoding='utf-8') as f:
    f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
            ''.join(f'  <url><loc>{SITE_URL}/{"" if p == "index.html" else p}</loc></url>\n' for p in PAGES) + '</urlset>\n')
# Cloudflare Pages / Netlify が読む付属設定（他のホスティングでは無視される）
host = SITE_URL.split('//', 1)[1]
with open(os.path.join(ROOT, '_headers'), 'w', encoding='utf-8') as f:
    f.write('/*\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: SAMEORIGIN\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Strict-Transport-Security: max-age=31536000\n/assets/*\n  Cache-Control: public, max-age=86400\n')
with open(os.path.join(ROOT, '_redirects'), 'w', encoding='utf-8') as f:
    f.write(f'https://www.{host}/* {SITE_URL}/:splat 301\n')
print('built', sorted(f for f in os.listdir(ROOT) if f.endswith('.html')), '+ robots.txt sitemap.xml _headers _redirects', 'SITE_URL =', SITE_URL)
