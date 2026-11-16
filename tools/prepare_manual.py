#!/usr/bin/env python3
"""Prepare the reviewed 42-page manual for local browser personalization.

Offline authoring tool, not a deployment requirement. Tested with PyMuPDF 1.26.6
and fonttools 4.61.1. Supply the reviewed PDF and the licensed fonts;
the original source is deliberately not duplicated in the published asset set.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

import fitz
from fontTools.ttLib import TTFont

SOURCE_SHA256 = "9a8757d14f089921a3f1d3ad8c550a340893cb9d1f9f12af7421f556cd0d20b1"
MANIFEST_FILES = (
    "cover.svg",
    "fonts/NotoSansJP-Bold.woff",
    "fonts/OFL-notosansjp.txt",
    "fonts/OFL-poppins.txt",
    "fonts/Poppins-Bold.woff",
    "layout.json",
    "name-coverage.js",
    "template.pdf",
    "vendor/fontkit-1.1.1.umd.min.js",
    "vendor/fontkit-LICENSE.txt",
    "vendor/pdf-lib-1.17.1.min.js",
    "vendor/pdf-lib-LICENSE.txt",
)
NAME = "REYZ STUDIO"
ROLE_RGB = {
    (247, 21, 172): "accent",
    (249, 198, 217): "blush",
    (252, 236, 243): "soft",
    (233, 227, 231): "line",
    (51, 17, 33): "deep",
    (37, 20, 31): "chip",
}
NAME_BLOCK = re.compile(rb"BT[^\n]*\(REY\) Tj[^\n]*\(Z\) Tj[^\n]*\( STUDIO\) Tj ET")
RGB = re.compile(rb"(?<!\S)([-.\d]+) ([-.\d]+) ([-.\d]+) (rg|RG)\b")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def ranges(values: list[int]) -> list[list[int]]:
    result: list[list[int]] = []
    for point in sorted(set(values)):
        if result and point == result[-1][1] + 1:
            result[-1][1] = point
        else:
            result.append([point, point])
    return result


def prepare(source: Path, latin: Path, japanese: Path, output: Path) -> None:
    if sha256(source) != SOURCE_SHA256:
        raise ValueError("Source changed: review it before updating SOURCE_SHA256.")
    output.mkdir(parents=True, exist_ok=True)
    fonts = output / "fonts"
    fonts.mkdir(exist_ok=True)
    document = fitz.open(source)
    if len(document) != 42:
        raise ValueError("The reviewed manual must have exactly 42 pages.")
    streams: list[str] = []
    slots: list[dict] = []
    removed = 0

    for index, page in enumerate(document):
        if tuple(page.rect) != (0, 0, 540, 960):
            raise ValueError("Unexpected page geometry.")
        page_slots = []
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                spans = line["spans"]
                for pos in range(len(spans) - 2):
                    if [s["text"] for s in spans[pos:pos + 3]] == ["REY", "Z", " STUDIO"]:
                        first, _, last = spans[pos:pos + 3]
                        x, top_baseline = first["origin"]
                        size = first["size"]
                        width = last["bbox"][2] - first["bbox"][0]
                        normal_header = abs(x - 40) < .01 and abs(top_baseline - 49) < .01
                        page_slots.append({
                            "page": index, "x": x, "y": 960 - top_baseline,
                            "size": size, "maxWidth": 350 if normal_header else width,
                        })
        raw = page.read_contents()
        raw, count = NAME_BLOCK.subn(b"", raw)
        if count != len(page_slots):
            raise ValueError(f"Name extraction mismatch on page {index + 1}.")
        removed += count
        slots.extend(page_slots)

        def tokenize(match: re.Match) -> bytes:
            rgb = tuple(round(float(v) * 255) for v in match.groups()[:3])
            role = ROLE_RGB.get(rgb)
            return ("{{" + role + "}} " + match.group(4).decode()).encode() if role else match.group(0)

        streams.append(RGB.sub(tokenize, raw).decode("ascii"))
        content_refs = page.get_contents()
        if len(content_refs) != 1:
            raise ValueError("Expected one reviewed content stream per page.")
        document.update_stream(content_refs[0], raw, compress=True)

    if removed != 47:
        raise ValueError(f"Expected 47 name slots, got {removed}.")

    # Remove ASCII85 wrapping losslessly. Pixel values and font programs remain
    # byte-for-byte unchanged after filter decoding.
    for xref in range(1, document.xref_length()):
        if document.xref_is_stream(xref) and "ASCII85Decode" in document.xref_get_key(xref, "Filter")[1]:
            document.update_stream(xref, document.xref_stream(xref), compress=True)
    document.set_metadata({**document.metadata, "title": "配信マニュアル テンプレート", "author": "", "keywords": "TikTok LIVE, 配信マニュアル"})
    template = output / "template.pdf"
    document.save(template, garbage=4, deflate=True, deflate_images=True, deflate_fonts=True, no_new_id=True)
    manifest = {
        "schema": 1, "width": 540, "height": 960, "pageCount": 42,
        "sourceSha256": SOURCE_SHA256, "slots": slots, "streams": streams,
    }
    (output / "layout.json").write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    svg = document[0].get_svg_image(text_as_path=True)
    for rgb, role in ROLE_RGB.items():
        color = "#" + "".join(f"{part:02x}" for part in rgb)
        svg = svg.replace('"' + color + '"', '"var(--manual-' + role + ', ' + color + ')"')
    svg = svg.replace("</svg>", """
<text id="manual-cover-name-top" x="40" y="49" font-size="16" data-base-size="16" data-max-width="350" fill="var(--manual-accent, #f715ac)" font-family="Manual Poppins, Poppins, sans-serif" font-weight="700">YOUR NAME</text>
<text id="manual-cover-name-bottom" x="40" y="824" font-size="27" data-base-size="27" data-max-width="172.557" fill="var(--manual-accent, #f715ac)" font-family="Manual Poppins, Poppins, sans-serif" font-weight="700">YOUR NAME</text>
</svg>""")
    (output / "cover.svg").write_text(svg, encoding="utf-8")

    latin_font = TTFont(latin)
    japanese_font = TTFont(japanese)
    supported = ranges(list(japanese_font.getBestCmap()))
    (output / "name-coverage.js").write_text(
        "// Generated by tools/prepare_manual.py from the shipped font cmap tables.\n"
        + "export const supportedNameRanges = Object.freeze("
        + json.dumps(supported, separators=(",", ":")) + ");\n", encoding="utf-8"
    )
    latin_font.recalcTimestamp = False
    japanese_font.recalcTimestamp = False
    # The reviewed fontkit version corrupts subsets of transformed WOFF2 glyf
    # data. Keep the preview and PDF on the same normalized TrueType-in-WOFF
    # bytes; never embed a WOFF container directly as a full PDF font program.
    if "glyf" not in latin_font:
        raise ValueError("The reviewed Latin font must use TrueType glyf outlines.")
    latin_font["glyf"].padding = 2
    latin_font.flavor = "woff"
    latin_font.save(fonts / "Poppins-Bold.woff")
    (fonts / "Poppins-Bold.woff2").unlink(missing_ok=True)
    # fontkit 1.1.1 copies glyf records verbatim, then may choose a short loca
    # table for a small PDF subset. Short loca stores offsets divided by two;
    # without even-length records, odd offsets are truncated and later glyphs
    # become invalid although ToUnicode still extracts their text correctly.
    # Padding changes neither outlines, cmap nor metrics. Keep every glyf record
    # even-aligned before WOFF compression so every subset is representable.
    if "glyf" not in japanese_font:
        raise ValueError("The reviewed Japanese font must use TrueType glyf outlines.")
    japanese_font["glyf"].padding = 2
    # WOFF is intentional: fontkit 1.1.1's WOFF2 subset path bloats this Japanese
    # font to ~7 MB. Even-aligned WOFF yields a small, valid TrueType subset.
    japanese_font.flavor = "woff"
    japanese_font.save(fonts / "NotoSansJP-Bold.woff")
    normalized_font = TTFont(fonts / "NotoSansJP-Bold.woff")
    if any(offset % 2 for offset in normalized_font["loca"].locations):
        raise ValueError("Japanese glyph offsets are not safe for short loca subsets.")
    normalized_latin = TTFont(fonts / "Poppins-Bold.woff")
    if any(offset % 2 for offset in normalized_latin["loca"].locations):
        raise ValueError("Latin glyph offsets are not safe for short loca subsets.")
    metadata = {"sourceSha256": SOURCE_SHA256, "pageCount": 42, "nameSlots": 47, "files": []}
    # Dependency bytes and their licences belong to the same reviewed asset set.
    # Application code (manual-core/worker.js) is tracked by Git, not this manifest.
    # Fail if a dependency or licence is absent instead of emitting a partial list.
    for relative in MANIFEST_FILES:
        path = output / relative
        if not path.is_file():
            raise ValueError(f"Required manual asset is missing: {relative}")
        metadata["files"].append({"path": relative, "bytes": path.stat().st_size, "sha256": sha256(path)})
    (output / "asset-manifest.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"templateBytes": template.stat().st_size, "pages": 42, "nameSlots": 47}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--latin-font", type=Path, required=True)
    parser.add_argument("--japanese-font", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("site/assets/manual"))
    arguments = parser.parse_args()
    prepare(arguments.source, arguments.latin_font, arguments.japanese_font, arguments.output)
