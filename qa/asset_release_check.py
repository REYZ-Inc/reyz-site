#!/usr/bin/env python3
"""Check the six immutable entry URLs, independently of the builder.

Usage: python3 qa/asset_release_check.py [site] [--require-tracked]
The supplied release is read only. Repeat-build, changed-source and corruption
probes run in a temporary copy. This is not a transitive module-graph audit.
"""
import argparse
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import unquote, urlsplit


ENTRIES = ('site.css', 'site.js', 'experience.js', 'manual.css', 'manual.js')
COMMON = ('site.css', 'site.js', 'experience.js')
PAGES = {'index', 'creator', 'creative', 'ai', 'consensus', 'contact', 'legal', 'manual', 'livers', '404'}
REPO = Path(__file__).resolve().parents[1]


def digest(content):
    return hashlib.sha256(content).hexdigest()


def logical_name(filename):
    for source in ENTRIES:
        stem, suffix = source.rsplit('.', 1)
        if filename == source or re.fullmatch(re.escape(stem) + r'\.[^.]+\.' + suffix, filename):
            return source
    return None


def fingerprint(filename, source):
    stem, suffix = source.rsplit('.', 1)
    return re.fullmatch(re.escape(stem) + r'\.([a-f0-9]{16})\.' + suffix, filename)


class Report:
    def __init__(self):
        self.checks = 0
        self.fails = []

    def check(self, label, passed, detail=None):
        self.checks += 1
        if not passed:
            self.fails.append(label + (': ' + json.dumps(detail, ensure_ascii=False) if detail is not None else ''))
        return bool(passed)


class EntryRefs(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.refs = []
        self.has_main = False
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.has_main |= tag == 'main'
        ref = attrs.get('src') if tag == 'script' else attrs.get('href') if tag == 'link' else None
        if ref and logical_name(Path(unquote(urlsplit(ref).path)).name):
            self.refs.append((tag, ref))


def inspect_release(root, report, label):
    """Check current HTML against real bytes, not a builder-provided manifest."""
    versions = {name: set() for name in ENTRIES}
    canonical = {}
    for name in ENTRIES:
        file = root / 'assets' / name
        if report.check(label + ': canonical exists ' + name, file.is_file()):
            canonical[name] = file.read_bytes()
    pages = {file.stem: file for file in root.glob('*.html') if not file.name.startswith('__')}
    report.check(label + ': all public pages are present', PAGES.issubset(pages), sorted(PAGES - pages.keys()))
    for name, file in sorted(pages.items()):
        parsed = EntryRefs(file.read_text(encoding='utf-8'))
        found = []
        for tag, ref in parsed.refs:
            url = urlsplit(ref)
            decoded = unquote(url.path)
            filename = Path(decoded).name
            source = logical_name(filename)
            found.append(source)
            mark = fingerprint(filename, source)
            if not report.check(label + ': content URL ' + name + ' → ' + source,
                                bool(mark) and not (url.scheme or url.netloc or url.query or url.fragment), ref):
                continue
            target = (root / decoded.lstrip('/')).resolve() if decoded.startswith('/') else (file.parent / decoded).resolve()
            if not report.check(label + ': entry stays in assets/ ' + ref, target.parent == (root / 'assets').resolve()):
                continue
            if not report.check(label + ': referenced file exists ' + ref, target.is_file()):
                continue
            content = target.read_bytes()
            report.check(label + ': filename hash matches bytes ' + ref, digest(content)[:16] == mark.group(1))
            report.check(label + ': current HTML uses canonical bytes ' + ref, source in canonical and content == canonical[source])
            report.check(label + ': entry uses its correct HTML tag ' + ref, tag == ('link' if source.endswith('.css') else 'script'))
            versions[source].add(target.relative_to(root).as_posix())
        if name in PAGES or parsed.has_main:
            expected = set(COMMON)
            if name in ('creator', 'manual'):
                expected.add('manual.css')
            if name == 'manual':
                expected.add('manual.js')
            report.check(label + ': page has each required entry once ' + name,
                         all(found.count(source) == 1 for source in expected), found)
        report.check(label + ': no duplicate entry references ' + name, len(found) == len(set(found)), found)
    for source, urls in versions.items():
        report.check(label + ': one current version for ' + source, len(urls) == 1, sorted(urls))
    # Retained older versions are also immutable; their names must remain true.
    for file in sorted((root / 'assets').iterdir()):
        source = logical_name(file.name)
        mark = fingerprint(file.name, source) if source else None
        if mark and file.is_file():
            report.check(label + ': retained fingerprint is valid ' + file.name, digest(file.read_bytes())[:16] == mark.group(1))
    return {source: next(iter(urls)) for source, urls in versions.items() if len(urls) == 1}


def require_tracked(root, versions, report):
    result = subprocess.run(['git', 'ls-files', '-z', '--', 'site/'], cwd=REPO, capture_output=True, check=True)
    tracked = set(result.stdout.decode('utf-8').split('\0'))
    for relative in sorted(set(versions.values())):
        target = root / relative
        try:
            key = target.relative_to(REPO).as_posix()
        except ValueError:
            key = ''
        report.check('referenced fingerprint is tracked in git: ' + relative, bool(key) and key in tracked)


def snapshot(root):
    return {file.relative_to(root).as_posix(): digest(file.read_bytes())
            for file in root.rglob('*') if file.is_file()}


def isolated_probes(release, report):
    with tempfile.TemporaryDirectory(prefix='reyz-asset-release-') as folder:
        project = Path(folder)
        shutil.copytree(REPO / 'build', project / 'build')
        shutil.copytree(REPO / 'data', project / 'data')   # /livers の名簿データ（build.py が読む）
        shutil.copytree(release / 'assets', project / 'site' / 'assets')
        site = project / 'site'
        env = dict(os.environ, SITE_OUT=str(site))

        def build():
            result = subprocess.run([sys.executable, 'build/build.py'], cwd=project, env=env,
                                    capture_output=True, text=True, timeout=30)
            if result.returncode:
                raise RuntimeError('isolated build failed: ' + result.stderr[-2000:])

        build()
        original = inspect_release(site, report, 'isolated initial')
        before = snapshot(site)
        build()
        report.check('rebuilding unchanged sources preserves every output path and byte', snapshot(site) == before)
        if len(original) != len(ENTRIES):
            return
        retained = {file.relative_to(site).as_posix(): file.read_bytes()
                    for file in (site / 'assets').iterdir()
                    if logical_name(file.name) and fingerprint(file.name, logical_name(file.name))}
        cached_html = {file.name: file.read_text(encoding='utf-8') for file in site.glob('*.html')}

        for source in ENTRIES:
            file = site / 'assets' / source
            file.write_bytes(file.read_bytes() + b'\n/* isolated asset-release content-change probe */\n')
        build()
        updated = inspect_release(site, report, 'isolated changed')
        for source in ENTRIES:
            report.check('changing canonical content changes its HTML URL: ' + source,
                         source in updated and updated[source] != original[source])
        for relative, content in retained.items():
            file = site / relative
            report.check('older immutable copy is retained unchanged: ' + relative,
                         file.is_file() and file.read_bytes() == content)
        for name, html in cached_html.items():
            for _, ref in EntryRefs(html).refs:
                file = site / unquote(urlsplit(ref).path).lstrip('/')
                report.check('cached HTML still resolves the original bytes: ' + name + ' → ' + file.name,
                             file.is_file() and retained.get(file.relative_to(site).as_posix()) == file.read_bytes())

        # A damaged copy must fail the checker and must not be silently repaired
        # at an already-published URL by the next build.
        damaged = site / updated['site.css']
        damaged.write_bytes(damaged.read_bytes() + b'\n/* simulated corrupt response */\n')
        negative = Report()
        inspect_release(site, negative, 'corruption probe')
        report.check('byte corruption is rejected independently of filename',
                     any('filename hash matches bytes' in error for error in negative.fails))
        rejected = subprocess.run([sys.executable, 'build/build.py'], cwd=project, env=env,
                                  capture_output=True, text=True, timeout=30)
        report.check('builder refuses to overwrite a corrupted immutable URL',
                     rejected.returncode != 0 and damaged.name in rejected.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('site', nargs='?', default='site')
    parser.add_argument('--require-tracked', action='store_true')
    args = parser.parse_args()
    report = Report()
    versions = {}
    try:
        root = Path(args.site).resolve()
        versions = inspect_release(root, report, 'release')
        if args.require_tracked:
            require_tracked(root, versions, report)
        if not report.fails:
            isolated_probes(root, report)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        report.fails.append(str(error))
    print(json.dumps({'checks': report.checks, 'fails': report.fails, 'entries': versions,
                      'scope': 'six entry assets; HTML/bytes, repeatability, changed URLs, retained cached-HTML dependencies'},
                     ensure_ascii=False, indent=2))
    return 1 if report.fails else 0


if __name__ == '__main__':
    sys.exit(main())
