"""Build ParkPilot CRM brand assets. Run: python3 build.py <out_dir>

Lockup follows the ParkPilot CRM pattern: P/i mark + "ParkPilot" in Montserrat
ExtraBold (800) + a rounded product badge, here a rounded badge reading "CRM": red with white text on light
backgrounds, light grey (Silver) with Ink text on dark (Brand Profile, Logo).
Wordmark text is converted to outlines, so no web font is needed.
"""
import os
import subprocess
import sys

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

from gen import ASPECT, INK, RED, WHITE, mark

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
CHARCOAL = "#26282B"
SILVER = "#D4D4D8"
MONTSERRAT = "/usr/share/fonts/truetype/google-fonts/ofl/montserrat/Montserrat[wght].ttf"

_fonts = {}


def font(weight):
    if weight not in _fonts:
        _fonts[weight] = instantiateVariableFont(TTFont(MONTSERRAT), {"wght": weight})
    return _fonts[weight]


def text_path(text, weight, size, tracking=0.0):
    """SVG path data for `text` with its baseline at y=0, plus the advance width and ink bounds."""
    f = font(weight)
    gs, cmap, upm = f.getGlyphSet(), f.getBestCmap(), f["head"].unitsPerEm
    s = size / upm
    pen, bounds = SVGPathPen(gs), BoundsPen(gs)
    x = 0.0
    for ch in text:
        g = cmap[ord(ch)]
        gs[g].draw(TransformPen(pen, (s, 0, 0, -s, x, 0)))
        gs[g].draw(TransformPen(bounds, (s, 0, 0, -s, x, 0)))
        x += gs[g].width * s + tracking * size
    return pen.getCommands(), x - tracking * size, bounds.bounds


H = 48.0          # lockup height
MARK_H = 34.0     # mark height inside it
WORD = 27.0       # "ParkPilot" size
BASELINE = 34.5
PILL_H = 22.0
PILL_TEXT = 15.5


def lockup(stroke, dot, word, pill_fill, pill_text):
    mark_w = MARK_H * ASPECT
    gap = 10.0
    d_word, w_word, _ = text_path("ParkPilot", 800, WORD, tracking=-0.01)
    x_word = mark_w + gap
    d_pill, w_pill_text, b = text_path("CRM", 600, PILL_TEXT, tracking=0.04)
    pad = 9.0
    pill_w = w_pill_text + pad * 2
    x_pill = x_word + w_word + 7.0
    # Centre the pill on the x-height of "ParkPilot"; centre "CRM" optically in the pill.
    y_pill = BASELINE - 18.5
    ink_mid = (b[1] + b[3]) / 2  # bounds are in the flipped space: y up is negative
    text_y = y_pill + PILL_H / 2 - ink_mid
    width = x_pill + pill_w + 1
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.1f} {H:g}" role="img" aria-label="ParkPilot CRM">'
        f'{mark(stroke=stroke, dot=dot, height=MARK_H, x=0, y=(H - MARK_H) / 2, standalone=False)}'
        f'<path transform="translate({x_word:.2f} {BASELINE})" fill="{word}" d="{d_word}"/>'
        f'<rect x="{x_pill:.2f}" y="{y_pill:.2f}" width="{pill_w:.2f}" height="{PILL_H}" rx="{PILL_H / 2}" fill="{pill_fill}"/>'
        f'<path transform="translate({x_pill + pad:.2f} {text_y:.2f})" fill="{pill_text}" d="{d_pill}"/></svg>'
    ), width


files = {}
files["logo.svg"], LOGO_W = lockup(INK, RED, INK, RED, WHITE)
files["logo-dark.svg"], _ = lockup(WHITE, RED, WHITE, SILVER, INK)
files["logo-mono.svg"], _ = lockup(INK, INK, INK, INK, WHITE)
files["logo-mono-white.svg"], _ = lockup(WHITE, WHITE, WHITE, WHITE, INK)
files["logo-mark.svg"] = mark(INK, RED, height=56)
files["logo-mark-dark.svg"] = mark(WHITE, RED, height=56)
files["logo-mark-mono.svg"] = mark(INK, INK, height=56)
files["logo-mark-mono-white.svg"] = mark(WHITE, WHITE, height=56)

# App icon: white mark, red dot, on a Charcoal tile.
ICON_H = 30.0
icon_w = ICON_H * ASPECT
files["icon.svg"] = (
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="{CHARCOAL}"/>'
    f'{mark(WHITE, RED, height=ICON_H, x=(64 - icon_w) / 2, y=(64 - ICON_H) / 2, standalone=False, extra=6)}</svg>'
)
for n, c in files.items():
    with open(os.path.join(OUT, n), "w") as fh:
        fh.write(c + "\n")


def render(src, dst, w, h=None):
    subprocess.run(["rsvg-convert", "-w", str(w)] + (["-h", str(h)] if h else []) + [os.path.join(OUT, src), "-o", dst], check=True)


tmp = "/tmp/crm-icons"
os.makedirs(tmp, exist_ok=True)
for s in (16, 32, 48):
    render("icon.svg", f"{tmp}/i{s}.png", s, s)
subprocess.run(["convert", f"{tmp}/i16.png", f"{tmp}/i32.png", f"{tmp}/i48.png", os.path.join(OUT, "favicon.ico")], check=True)
with open(f"{tmp}/apple.svg", "w") as fh:
    fh.write(files["icon.svg"].replace('rx="14" ', ""))
subprocess.run(["rsvg-convert", "-w", "180", "-h", "180", f"{tmp}/apple.svg", "-o", os.path.join(OUT, "apple-touch-icon.png")], check=True)
# PNGs for email (most clients don't render SVG).
render("logo.svg", os.path.join(OUT, "logo-email.png"), 360)
render("logo-mono.svg", os.path.join(OUT, "logo-mono-email.png"), 360)
print(f"ok · logo aspect {LOGO_W / H:.4f} · mark aspect {ASPECT:.4f}")
