#!/usr/bin/env python3
"""Build lazy SVG samples from the exact shipped manual, without duplicating PDFs.

This authoring-only step uses the same PyMuPDF and fontTools dependencies as
prepare_manual.py. It preserves the page's actual vectors, text outlines and
images. Name slots and palette roles share the PDF metadata.
Run again whenever the reviewed template or layout changes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

import fitz

from prepare_manual import ROLE_RGB

SAMPLES = (
    (1, "表紙"),
    (3, "配信をはじめよう"),
    (14, "ギフトギャラリー"),
    (37, "イベント"),
)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def prepare(assets: Path) -> dict:
    template = assets / "template.pdf"
    layout_file = assets / "layout.json"
    layout = json.loads(layout_file.read_text(encoding="utf-8"))
    asset_manifest = json.loads((assets / "asset-manifest.json").read_text(encoding="utf-8"))
    verified = {entry["path"]: entry for entry in asset_manifest["files"]}
    for path in (template, layout_file):
        data = path.read_bytes()
        entry = verified[path.name]
        if digest(data) != entry["sha256"] or len(data) != entry["bytes"]:
            raise ValueError(f"Reviewed asset changed: {path.name}")
    if layout["sourceSha256"] != asset_manifest["sourceSha256"]:
        raise ValueError("The preview source and PDF manifest must match.")
    document = fitz.open(template)
    if len(document) != layout["pageCount"] or len(layout["slots"]) != 47:
        raise ValueError("Unexpected page count or name-slot inventory.")
    manifest = {
        "schema": 1,
        "sourceSha256": layout["sourceSha256"],
        "templateSha256": digest(template.read_bytes()),
        "layoutSha256": digest(layout_file.read_bytes()),
        "pageCount": layout["pageCount"],
        "pages": [],
    }
    for number, title in SAMPLES:
        page = document[number - 1]
        if (page.rect.width, page.rect.height) != (layout["width"], layout["height"]):
            raise ValueError(f"Unexpected dimensions on page {number}.")
        svg = page.get_svg_image(text_as_path=True)
        # Inline samples coexist with the live cover. Namespace every definition
        # and local reference so one page cannot accidentally use another's font.
        prefix = f"manual-sample-{number:02d}-"
        ids = re.findall(r'\bid="([^"]+)"', svg)
        for old in sorted(ids, key=len, reverse=True):
            new = prefix + old
            svg = svg.replace(f'id="{old}"', f'id="{new}"')
            svg = svg.replace(f'href="#{old}"', f'href="#{new}"')
            svg = svg.replace(f'url(#{old})', f'url(#{new})')
        for rgb, role in ROLE_RGB.items():
            color = "#" + "".join(f"{part:02x}" for part in rgb)
            svg = svg.replace(f'"{color}"', f'"var(--manual-{role}, {color})"')
        slots = [slot for slot in layout["slots"] if slot["page"] == number - 1]
        if not slots:
            raise ValueError(f"Name slot missing on page {number}.")
        names = []
        for index, slot in enumerate(slots):
            names.append(
                f'<text id="{prefix}name-{index}" data-manual-name="true" '
                f'x="{slot["x"]:.6f}" y="{layout["height"] - slot["y"]:.6f}" '
                f'font-size="{slot["size"]:.6f}" data-base-size="{slot["size"]:.6f}" '
                f'data-max-width="{slot["maxWidth"]:.6f}" '
                'fill="var(--manual-accent, #f715ac)" '
                'font-family="Manual Poppins, Poppins, sans-serif" font-weight="700">YOUR NAME</text>'
            )
        svg = svg.replace("</svg>", "\n" + "\n".join(names) + "\n</svg>")
        filename = f"preview-{number:02d}.svg"
        data = svg.encode("utf-8")
        (assets / filename).write_bytes(data)
        manifest["pages"].append({
            "page": number, "title": title, "file": filename,
            "description": " ".join(page.get_text().split()),
            "bytes": len(data), "sha256": digest(data), "nameSlots": len(slots),
        })
    (assets / "preview-index.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets", type=Path, default=Path("site/assets/manual"))
    args = parser.parse_args()
    result = prepare(args.assets)
    print(json.dumps({"pages": result["pages"]}, ensure_ascii=False))
