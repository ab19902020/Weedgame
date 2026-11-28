# The printed things in the cafe, takeaway and pub back walls (eateries.py): backlit menu boards with their food
# pictures, the cafe's chalkboard, beer pump clips and the pub's framed pictures. Generic: no chain's artwork.
#   python3 tools/blender/eaterylabels.py OUTDIR
import os, sys, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = sys.argv[1] if len(sys.argv) > 1 else 'eatery_labels'
os.makedirs(OUT, exist_ok=True)
R = random.Random(7)

def font(size, bold=True):
    for p in (['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'] if bold else []) + ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']:
        if os.path.exists(p): return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def serif(size):
    for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf']:
        if os.path.exists(p): return ImageFont.truetype(p, size)
    return font(size)

# ---------------------------------------------------------------------------------------------------- food pictures
def burger(d, cx, cy, s):
    d.ellipse([cx - s, cy - s * 0.95, cx + s, cy + s * 0.05], fill=(214, 150, 64))                      # top bun
    for k in range(7): x = cx - s * 0.6 + k * s * 0.2; d.ellipse([x, cy - s * 0.65, x + s * 0.06, cy - s * 0.6], fill=(246, 228, 180))
    d.rectangle([cx - s * 1.05, cy - s * 0.05, cx + s * 1.05, cy + s * 0.12], fill=(84, 160, 52))         # lettuce
    d.rectangle([cx - s * 0.98, cy + s * 0.12, cx + s * 0.98, cy + s * 0.22], fill=(236, 190, 40))         # cheese
    d.rounded_rectangle([cx - s, cy + s * 0.2, cx + s, cy + s * 0.5], 8, fill=(92, 52, 30))                # patty
    d.rounded_rectangle([cx - s, cy + s * 0.5, cx + s, cy + s * 0.78], 10, fill=(206, 140, 60))            # bottom bun

def fries(d, cx, cy, s):
    for k in range(9):
        x = cx - s * 0.5 + k * s * 0.12 + R.uniform(-3, 3); h = s * R.uniform(0.7, 1.0)
        d.rectangle([x, cy - h, x + s * 0.1, cy + s * 0.1], fill=(244, 196, 70), outline=(220, 160, 40))
    d.polygon([(cx - s * 0.62, cy - s * 0.15), (cx + s * 0.62, cy - s * 0.15), (cx + s * 0.5, cy + s * 0.9), (cx - s * 0.5, cy + s * 0.9)], fill=(206, 32, 38))

def drink(d, cx, cy, s, col=(206, 32, 38)):
    d.polygon([(cx - s * 0.45, cy - s * 0.7), (cx + s * 0.45, cy - s * 0.7), (cx + s * 0.36, cy + s * 0.9), (cx - s * 0.36, cy + s * 0.9)], fill=(245, 245, 242))
    d.rectangle([cx - s * 0.42, cy - s * 0.2, cx + s * 0.4, cy + s * 0.25], fill=col)
    d.rectangle([cx - s * 0.5, cy - s * 0.82, cx + s * 0.5, cy - s * 0.7], fill=(230, 230, 228))
    d.line([cx + s * 0.1, cy - s * 0.82, cx + s * 0.25, cy - s * 1.2], fill=(240, 240, 240), width=max(2, int(s * 0.08)))

def chicken(d, cx, cy, s):
    d.polygon([(cx - s * 0.75, cy + s * 0.9), (cx + s * 0.75, cy + s * 0.9), (cx + s * 0.9, cy - s * 0.4), (cx - s * 0.9, cy - s * 0.4)], fill=(196, 30, 36))
    d.rectangle([cx - s * 0.9, cy - s * 0.1, cx + s * 0.9, cy + s * 0.12], fill=(245, 245, 242))
    for k in range(5):
        x = cx - s * 0.7 + k * s * 0.35; d.ellipse([x - s * 0.25, cy - s * 0.9 - (k % 2) * s * 0.15, x + s * 0.25, cy - s * 0.3], fill=(176, 104, 40), outline=(140, 78, 30))

def wrap(d, cx, cy, s):
    d.polygon([(cx - s, cy + s * 0.4), (cx + s * 0.6, cy - s * 0.8), (cx + s, cy - s * 0.3), (cx - s * 0.5, cy + s * 0.8)], fill=(238, 214, 170))
    d.polygon([(cx + s * 0.3, cy - s * 0.55), (cx + s * 0.62, cy - s * 0.8), (cx + s * 0.95, cy - s * 0.35), (cx + s * 0.65, cy - s * 0.12)], fill=(90, 160, 60))

def sundae(d, cx, cy, s):
    d.polygon([(cx - s * 0.5, cy - s * 0.1), (cx + s * 0.5, cy - s * 0.1), (cx + s * 0.35, cy + s * 0.9), (cx - s * 0.35, cy + s * 0.9)], fill=(240, 240, 238))
    d.ellipse([cx - s * 0.6, cy - s * 0.7, cx + s * 0.6, cy + s * 0.05], fill=(250, 246, 236))
    d.ellipse([cx - s * 0.35, cy - s * 0.85, cx + s * 0.35, cy - s * 0.3], fill=(110, 60, 30))
    d.ellipse([cx - s * 0.08, cy - s * 1.0, cx + s * 0.08, cy - s * 0.82], fill=(200, 20, 40))

PICS = {'burger': burger, 'fries': fries, 'drink': drink, 'chicken': chicken, 'wrap': wrap, 'sundae': sundae}

def menu_board(name, title, items, bg, band, ink=(255, 255, 255)):
    """A backlit menu panel 1.0 x 0.55 m: a coloured band with the section's name, three pictures, names, prices."""
    W, H = 800, 440
    im = Image.new('RGB', (W, H), bg); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 62], fill=band)
    d.text((24, 12), title, font=font(36), fill=ink)
    for k, (pic, nm, pr) in enumerate(items):
        cx = 140 + k * 260
        d.ellipse([cx - 110, 92, cx + 110, 300], fill=tuple(min(255, int(c * 1.12) + 10) for c in bg))
        PICS[pic](d, cx, 200, 72)
        d.text((cx, 340), nm, font=font(26), fill=ink, anchor='mm')
        d.text((cx, 384), pr, font=font(30), fill=(255, 214, 64), anchor='mm')
    im.filter(ImageFilter.GaussianBlur(0.6)).save(os.path.join(OUT, name + '.png'))

menu_board('menu_0', 'BURGERS', [('burger', 'Classic', '£4.29'), ('burger', 'Double', '£5.49'), ('burger', 'Cheese', '£3.19')], (34, 30, 28), (200, 30, 36))
menu_board('menu_1', 'MEALS', [('burger', 'Burger meal', '£7.49'), ('fries', 'Large fries', '£2.49'), ('drink', 'Large drink', '£1.99')], (34, 30, 28), (200, 30, 36))
menu_board('menu_2', 'CHICKEN', [('chicken', 'Bucket', '£9.99'), ('wrap', 'Wrap', '£3.99'), ('chicken', 'Strips', '£4.49')], (34, 30, 28), (32, 110, 60))
menu_board('menu_3', 'DRINKS & DESSERTS', [('drink', 'Cola', '£1.49'), ('sundae', 'Sundae', '£1.79'), ('drink', 'Milkshake', '£2.29')], (34, 30, 28), (232, 150, 20))

# ---------------------------------------------------------------------------------------------------- the cafe's chalkboard
def chalkboard():
    W, H = 900, 640
    im = Image.new('RGB', (W, H), (36, 40, 38)); d = ImageDraw.Draw(im)
    for _ in range(4000):   # chalk dust
        x, y = R.randrange(W), R.randrange(H); c = R.randrange(40, 62); d.point((x, y), fill=(c, c + 3, c + 1))
    d.text((W // 2, 60), 'COFFEE', font=serif(64), fill=(236, 232, 220), anchor='mm')
    rows = [('Espresso', '2.20'), ('Americano', '2.90'), ('Flat white', '3.30'), ('Latte', '3.40'), ('Cappuccino', '3.40'), ('Hot chocolate', '3.50'), ('Tea', '2.40')]
    for i, (nm, pr) in enumerate(rows):
        y = 140 + i * 62
        d.text((60, y), nm, font=font(36, False), fill=(232, 228, 214))
        d.text((W - 60, y), pr, font=font(36, False), fill=(244, 210, 120), anchor='ra')
    d.line([60, 120, W - 60, 120], fill=(200, 196, 184), width=3)
    im.filter(ImageFilter.GaussianBlur(0.8)).save(os.path.join(OUT, 'chalkboard.png'))
chalkboard()

# ---------------------------------------------------------------------------------------------------- pump clips
CLIPS = [('BEST BITTER', (120, 30, 30), (240, 214, 150)), ('GOLDEN ALE', (230, 170, 40), (40, 30, 20)), ('IPA', (30, 80, 60), (240, 236, 220)),
         ('STOUT', (20, 20, 22), (230, 210, 160)), ('CIDER', (160, 200, 70), (40, 50, 20)), ('PORTER', (70, 40, 26), (240, 220, 170))]
for i, (nm, bg, fg) in enumerate(CLIPS):
    im = Image.new('RGB', (200, 300), bg); d = ImageDraw.Draw(im)
    d.ellipse([20, 40, 180, 200], outline=fg, width=8)
    d.text((100, 120), nm.split()[0][:6], font=font(30), fill=fg, anchor='mm')
    d.text((100, 250), nm.split()[-1][:7], font=font(28), fill=fg, anchor='mm')
    im.save(os.path.join(OUT, f'clip_{i}.png'))

# ---------------------------------------------------------------------------------------------------- framed pictures
def landscape(name, sky, hills, field):
    W, H = 400, 300
    im = Image.new('RGB', (W, H), sky); d = ImageDraw.Draw(im)
    pts = [(0, 170)] + [(x, 150 + int(25 * ((x * 7919) % 97) / 97)) for x in range(0, W + 1, 40)] + [(W, H), (0, H)]
    d.polygon(pts, fill=hills)
    d.rectangle([0, 220, W, H], fill=field)
    for _ in range(6): x = R.randrange(20, W - 20); d.ellipse([x - 14, 190, x + 14, 226], fill=tuple(max(0, c - 40) for c in hills))
    im.filter(ImageFilter.GaussianBlur(1.2)).save(os.path.join(OUT, name + '.png'))
landscape('picture_0', (176, 196, 214), (92, 120, 70), (140, 150, 70))
landscape('picture_1', (214, 180, 140), (110, 90, 60), (170, 140, 80))
landscape('picture_2', (150, 170, 190), (70, 90, 80), (110, 130, 70))
print('eatery labels in', OUT)
