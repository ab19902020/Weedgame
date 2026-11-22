"""Draws the launcher icon (a green county roundel with a road and two figures) at all densities."""
import sys, os
from PIL import Image, ImageDraw
out = sys.argv[1]
for d, px in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
    S = 4 * px; im = Image.new('RGBA', (S, S), (0, 0, 0, 0)); g = ImageDraw.Draw(im)
    g.ellipse([0, 0, S - 1, S - 1], fill=(38, 92, 58, 255))
    g.polygon([(S * .38, S), (S * .62, S), (S * .54, S * .45), (S * .46, S * .45)], fill=(70, 72, 76, 255))
    g.ellipse([S * .2, S * .14, S * .8, S * .56], fill=(222, 210, 150, 255))
    for cx, col in ((.4, (49, 73, 88, 255)), (.6, (118, 87, 65, 255))):
        g.ellipse([S * (cx - .05), S * .2, S * (cx + .05), S * .3], fill=(230, 190, 160, 255))
        g.rounded_rectangle([S * (cx - .07), S * .31, S * (cx + .07), S * .52], radius=S * .03, fill=col)
    im.resize((px, px), Image.LANCZOS).save(os.path.join(out, f'mipmap-{d}', 'ic_launcher.png'))
