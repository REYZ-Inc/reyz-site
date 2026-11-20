#!/usr/bin/env python3
"""List how every section of the generated site is connected.

Usage: python3 qa/connection_audit.py [site] > report.json
For each <section id>, reports the in-body links that lead to it, the in-body
links that leave it and the media it shows. Header and footer links are listed
separately: they reach pages, not the reason for a section to exist.
Only static in-body links are counted: header and footer navigation, external links and
operations such as playing a film or sending the form are not. A section without them is
therefore a prompt to look, not a defect. This is an audit, not a gate (docs/site-coherence.md).
"""
import collections
from html.parser import HTMLParser
import json
from pathlib import Path
import sys

PAGES = ('index', 'creator', 'creative', 'ai', 'consensus', 'contact', 'manual', 'legal')


class Sections(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.order, self.current, self.links, self.media = [], None, [], []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'section' and attrs.get('id'):
            self.current = attrs['id']
            self.order.append(self.current)
        if tag == 'a' and attrs.get('href'):
            self.links.append((self.current, attrs['href']))
        source = attrs.get('data-src') or attrs.get('src')
        if tag in ('video', 'img') and source and self.current:
            self.media.append((self.current, source.rsplit('/', 1)[-1]))

    def handle_endtag(self, tag):
        if tag == 'section':
            self.current = None


def target(page, href):
    if href.startswith(('http:', 'https:', 'mailto:', 'tel:', 'assets/')):
        return None
    href = href.replace('.html', '')
    if href.startswith('#'):
        return page + href
    return 'index' + href[2:] if href.startswith('./') else (href or 'index')


def main():
    site = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / 'site')
    parsed, inbound, chrome = {}, collections.Counter(), set()
    for page in PAGES:
        parser = Sections()
        parser.feed((site / f'{page}.html').read_text(encoding='utf-8'))
        parsed[page] = parser
        for section, href in parser.links:
            to = target(page, href)
            if to is None or to.endswith('#main') or to.endswith('#'):
                continue
            if section is None:
                chrome.add(to)
            else:
                inbound[to] += 1
    report = {'pages': {}, 'header_footer': sorted(chrome), 'findings': {'no_in_body_inbound': [], 'no_in_body_outbound': []}}
    for page, parser in parsed.items():
        sections = {}
        for section in parser.order:
            out = sorted({target(page, href) for at, href in parser.links if at == section} - {None, page + '#'})
            media = sorted({name for at, name in parser.media if at == section})
            key = f'{page}#{section}'
            sections[section] = {'in_body_inbound': inbound[key], 'outbound': out, 'media': media}
            first = section == parser.order[0]
            if not inbound[key] and not first:
                report['findings']['no_in_body_inbound'].append(key)
            if not out and page not in ('contact', 'manual', 'legal'):
                report['findings']['no_in_body_outbound'].append(key)
        report['pages'][page] = {'in_body_inbound': inbound[page], 'sections': sections}
    json.dump(report, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
