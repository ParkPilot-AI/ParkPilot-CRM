"""ParkPilot P/i mark, measured from the supplied artwork (parkpilot-logo.png).

Two round-capped strokes rising at ~51 degrees and a red dot whose diameter
matches the stroke width (Brand Foundation, section 03).
"""

STROKE = 70.0
PILLS = (((38.2, 217.0), (184.5, 36.7)), ((184.5, 217.0), (264.8, 118.0)))
DOT = ((330.9, 37.1), 37.6)
# Bounding box of the mark (stroke caps and dot included).
X0, Y0, X1, Y1 = 3.2, 1.7, 368.5, 252.0
W, H = X1 - X0, Y1 - Y0
ASPECT = W / H

INK, RED, WHITE = "#111111", "#E1140A", "#FFFFFF"


def mark(stroke=INK, dot=RED, height=56.0, x=0.0, y=0.0, standalone=True, extra=0.0):
    """The mark scaled to `height` with its top-left at (x, y). `extra` thickens strokes for tiny sizes."""
    s = height / H
    lines = "".join(
        f'<line x1="{a[0]}" y1="{a[1]}" x2="{b[0]}" y2="{b[1]}"/>' for a, b in PILLS
    )
    (cx, cy), r = DOT
    g = (
        f'<g transform="translate({x - X0 * s:.3f} {y - Y0 * s:.3f}) scale({s:.5f})">'
        f'<g stroke="{stroke}" stroke-width="{STROKE + extra}" stroke-linecap="round" fill="none">{lines}</g>'
        f'<circle cx="{cx}" cy="{cy}" r="{r + extra / 2}" fill="{dot}"/></g>'
    )
    if not standalone:
        return g
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W * s:.2f} {height:g}">{g}</svg>'


if __name__ == "__main__":
    print(mark())
