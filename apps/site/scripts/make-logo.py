"""Builds the Apensum logo as self-contained SVG files: the mark plus the wordmark "a" + "pensum"
with the letters as outlines (Inter, SIL OFL), matching the website header (apps/site):
wordmark 500 / 750 weight, letter-spacing -0.02em, mark:text size 30:21.6, gap 10px.
Output: static/brand/*.svg (committed; rerun only when the logo changes). Needs fonttools + brotli
and Inter's variable font (npm pack @fontsource-variable/inter, files/inter-latin-wght-normal.woff2):
  python3 scripts/make-logo.py <inter-latin-wght-normal.woff2> static/brand"""
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

src, out_dir = sys.argv[1], sys.argv[2]

MARK = 32.0
SCALE = MARK / 30.0
SIZE = 21.6 * SCALE
GAP = 10 * SCALE
TRACK = -0.02 * SIZE


def instance(weight):
    return instantiateVariableFont(TTFont(src), {'wght': weight})


light, bold = instance(500), instance(750)
upm = light['head'].unitsPerEm
s = SIZE / upm
hhea = light['hhea']
baseline = MARK / 2 + (hhea.ascent + hhea.descent) / 2 * s  # centered like the HTML line box


def run(font, text, x):
    cmap = font.getBestCmap()
    gs = font.getGlyphSet()
    pen = SVGPathPen(gs, ntos=lambda v: ('%.2f' % v).rstrip('0').rstrip('.'))
    for ch in text:
        name = cmap[ord(ch)]
        gs[name].draw(TransformPen(pen, (s, 0, 0, -s, x, baseline)))
        x += font['hmtx'][name][0] * s + TRACK
    return pen.getCommands(), x


x0 = MARK + GAP
a_path, x1 = run(light, 'a', x0)
p_path, x2 = run(bold, 'pensum', x1)
width = round(x2 - TRACK + 1, 2)

MARK_SVG = ('<rect width="32" height="32" rx="8" fill="{tile}"/>'
            '<circle cx="15" cy="17.5" r="6.5" fill="none" stroke="#fff" stroke-width="2.6"/>'
            '<path d="M21.5 11v13" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>'
            '<path d="M15 14.2v3.5l2.3 1.4" fill="none" stroke="{hand}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>')

VARIANTS = {
    # name: (tile, hand, "a", "pensum")
    'apensum-logo.svg': ('#1a56db', '#9ec0ff', '#5b6474', '#111a33'),       # on light backgrounds
    'apensum-logo-dark.svg': ('#1a56db', '#9ec0ff', '#94a0b8', '#f1f4fb'),  # on dark backgrounds
    'apensum-logo-white.svg': ('rgba(255,255,255,0.18)', 'rgba(255,255,255,0.7)', 'rgba(255,255,255,0.75)', '#fff'),  # on brand color
}
for name, (tile, hand, ca, cp) in VARIANTS.items():
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {MARK:g}" width="{width * 4:g}" height="{MARK * 4:g}" role="img" aria-label="Apensum">'
           f'<title>Apensum</title>{MARK_SVG.format(tile=tile, hand=hand)}'
           f'<path fill="{ca}" d="{a_path}"/><path fill="{cp}" d="{p_path}"/></svg>\n')
    open(f'{out_dir}/{name}', 'w').write(svg)

mark = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="512" height="512" role="img" aria-label="Apensum">'
        f'<title>Apensum</title>{MARK_SVG.format(tile="#1a56db", hand="#9ec0ff")}</svg>\n')
open(f'{out_dir}/apensum-mark.svg', 'w').write(mark)
print('width', width, 'baseline', round(baseline, 2))
