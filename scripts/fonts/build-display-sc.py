#!/usr/bin/env python3
"""
Build "Red Room Display SC" — a condensed (长体) heavy Chinese display cut that
pairs with Archivo ExtraCondensed ExtraBold (`font-stretch: 62%; font-weight: 800`).

Why a generated font instead of CSS:
  CSS cannot compress glyphs. `transform: scaleX()` leaves the layout box at the
  original width (gaps after headings, wrong line breaks), and there is no CJK
  family with a real width axis. Compressing the outlines once, offline, gives
  the browser a normal font whose advances are already narrow, so wrapping,
  selection and mixed Latin/CJK lines behave exactly like the English design.

What it does, for every unicode-range slice shipped by
@fontsource-variable/noto-sans-sc (so browsers still download only the slices
a page actually uses):
  1. pin the variable font at wght=900 (Black — matches the colour of Archivo
     800 at 62% width; compression thins vertical stems, Black compensates);
  2. scale outlines and advances horizontally by WIDTH (0.82);
  3. drop vertical-layout and GPOS tables (not used for horizontal display text),
     rename the family (SIL OFL 1.1 requires a modified font to be renamed);
  4. write WOFF2 plus the matching @font-face rules (with size-adjust so
     ideographs sit at Archivo's cap height) to public/fonts/display-sc/.
     The stylesheet is static and loaded without blocking rendering
     (ui/layouts/Base.astro), so English-only pages pay for ~30 KB of cached
     CSS and no font files at all.

Usage (needs fontTools + brotli; Noto Sans SC comes from the devDependency
@fontsource-variable/noto-sans-sc — run after npm install):
    pip install fonttools brotli
    python3 scripts/fonts/build-display-sc.py

Source font: Noto Sans SC, © Google Inc., SIL Open Font License 1.1.
The output is licensed under the same terms (public/fonts/display-sc/OFL.txt).
"""
from __future__ import annotations

import pathlib
import re
import shutil
import sys

from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

WIDTH = 0.82          # horizontal compression (Archivo 62% ≈ 0.78–0.84 of normal width)
WEIGHT = 900          # Black
SIZE_ADJUST = '88%'   # ideograph height ≈ Archivo cap height + a little optical lift
FAMILY = 'Red Room Display SC'
PS_NAME = 'RedRoomDisplaySC-Black'

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'node_modules/@fontsource-variable/noto-sans-sc'
OUT_DIR = ROOT / 'public/fonts/display-sc'
CSS_OUT = OUT_DIR / 'display-sc.css'
DROP_TABLES = ('GPOS', 'vhea', 'vmtx', 'VORG', 'BASE', 'STAT', 'HVAR', 'MVAR')


EMOJI_START = 0x1F000  # emoji & pictographs: leave them to the system colour-emoji font


def without_emoji(unicode_range: str) -> str:
    """Drop U+1F000 and above from a unicode-range list, so a title's emoji keep their colour."""
    kept = []
    for part in (p.strip() for p in unicode_range.split(',')):
        start = int(part[2:].split('-')[0].replace('?', '0'), 16)
        if start < EMOJI_START:
            kept.append(part)
    return ','.join(kept)


def condense(font: TTFont) -> None:
    glyph_set = font.getGlyphSet()
    glyf, hmtx = font['glyf'], font['hmtx']
    rebuilt = {}
    for name in font.getGlyphOrder():
        recording = DecomposingRecordingPen(glyph_set)
        glyph_set[name].draw(recording)
        pen = TTGlyphPen(None)
        recording.replay(TransformPen(pen, (WIDTH, 0, 0, 1, 0, 0)))
        rebuilt[name] = pen.glyph()
    for name, glyph in rebuilt.items():
        glyf[name] = glyph
        glyph.recalcBounds(glyf)
        advance, _ = hmtx[name]
        hmtx[name] = (round(advance * WIDTH), getattr(glyph, 'xMin', 0) if glyph.numberOfContours else 0)
    os2 = font['OS/2']
    os2.xAvgCharWidth = round(os2.xAvgCharWidth * WIDTH)
    os2.usWidthClass = 3  # condensed
    os2.usWeightClass = WEIGHT


def rename(font: TTFont) -> None:
    names = font['name']
    names.names = [record for record in names.names if record.nameID not in {1, 2, 3, 4, 6, 16, 17, 18, 21, 22, 25}]
    for name_id, value in {1: FAMILY, 2: 'Regular', 3: f'{PS_NAME};generated', 4: f'{FAMILY} Black', 6: PS_NAME}.items():
        names.setName(value, name_id, 3, 1, 0x409)


def build_slice(source: pathlib.Path, target: pathlib.Path) -> int:
    font = instancer.instantiateVariableFont(TTFont(source), {'wght': WEIGHT})
    for tag in DROP_TABLES:
        if tag in font:
            del font[tag]
    condense(font)
    rename(font)
    font.flavor = 'woff2'
    font.save(target)
    return target.stat().st_size


def main() -> int:
    css_source = SOURCE / 'wght.css'
    if not css_source.exists():
        print(f'missing {css_source} — run `npm install` first', file=sys.stderr)
        return 1
    faces = re.findall(r'src: url\(\./files/([^)]+)\)[^;]*;\s*unicode-range: ([^;]+);', css_source.read_text())
    if not faces:
        print('could not parse @font-face rules from the Fontsource CSS', file=sys.stderr)
        return 1

    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    OUT_DIR.mkdir(parents=True)
    shutil.copy(SOURCE / 'LICENSE', OUT_DIR / 'OFL.txt')

    # Only the numbered CJK slices: Latin, Cyrillic and Vietnamese are left to
    # Archivo (first in the font stack) and the regular Noto Sans SC.
    faces = [(name, without_emoji(ranges)) for name, ranges in faces if re.search(r'noto-sans-sc-\d+-wght', name)]
    faces = [(name, ranges) for name, ranges in faces if ranges]
    rules, total = [], 0
    for index, (file_name, unicode_range) in enumerate(faces):
        slice_id = re.search(r'noto-sans-sc-(\d+)-wght', file_name).group(1)
        out_name = f'display-sc-{slice_id}.woff2'
        total += build_slice(SOURCE / 'files' / file_name, OUT_DIR / out_name)
        rules.append(
            '@font-face {\n'
            f"  font-family: '{FAMILY}';\n"
            '  font-style: normal;\n'
            '  font-weight: 700 900;\n'
            '  font-display: swap;\n'
            f'  size-adjust: {SIZE_ADJUST};\n'
            f"  src: url('./{out_name}') format('woff2');\n"
            f'  unicode-range: {unicode_range.strip()};\n'
            '}\n'
        )

    header = (
        f'/* GENERATED by scripts/fonts/build-display-sc.py — do not edit by hand.\n'
        f' * {FAMILY}: Noto Sans SC (SIL OFL 1.1) pinned at wght {WEIGHT}, compressed to {WIDTH:.0%} width.\n'
        f' * {len(rules)} unicode-range slices, {total / 1e6:.1f} MB in total; a page downloads only the slices it uses. */\n'
    )
    CSS_OUT.write_text(header + '\n'.join(rules))
    print(f'wrote {len(rules)} faces ({total / 1e6:.1f} MB) and {CSS_OUT.relative_to(ROOT)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
