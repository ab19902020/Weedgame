# Draws the packaging for the shop stock in tools/blender/shopstock.py (Pillow), and the price tags and newspapers.
#   python3 tools/blender/labels.py OUTDIR
# Output: OUTDIR/<id>.png (the front of a box or bag, or the wrap of a can, tin or bottle label), OUTDIR/tag_<id>.png
# (its shelf-edge price tag), OUTDIR/paper_<n>.png (newspaper front pages). Read by shelves.py (run in Blender).
import os, sys, math, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shopstock import P

OUT = sys.argv[1] if len(sys.argv) > 1 else 'labels'
os.makedirs(OUT, exist_ok=True)
F = '/usr/share/fonts/truetype/'
FONTS = {'bold': F + 'dejavu/DejaVuSans-Bold.ttf', 'sans': F + 'dejavu/DejaVuSans.ttf', 'serif': F + 'dejavu/DejaVuSerif-Bold.ttf',
         'cond': F + 'liberation/LiberationSans-Bold.ttf', 'italic': F + 'liberation/LiberationSans-BoldItalic.ttf'}
PX = 1400          # pixels per metre of label
rnd = random.Random(7)

def font(kind, size): return ImageFont.truetype(FONTS[kind], max(6, int(size)))
def hexrgb(h): h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
def shade(c, k): return tuple(max(0, min(255, int(v * k))) for v in c)
def mix(a, b, t): return tuple(int(a[i] * (1 - t) + b[i] * t) for i in range(3))

def fit_text(d, text, kind, box_w, box_h, max_size):
    size = max_size
    while size > 6:
        f = font(kind, size); l, t, r, b = d.textbbox((0, 0), text, font=f)
        if r - l <= box_w and b - t <= box_h: return f, r - l, b - t
        size -= 1
    f = font(kind, 6); l, t, r, b = d.textbbox((0, 0), text, font=f); return f, r - l, b - t

def centred(d, text, kind, cx, cy, box_w, box_h, max_size, fill, stroke=0, stroke_fill=None):
    f, w, h = fit_text(d, text, kind, box_w, box_h, max_size)
    l, t, r, b = d.textbbox((0, 0), text, font=f)
    d.text((cx - w / 2 - l, cy - h / 2 - t), text, font=f, fill=fill, stroke_width=stroke, stroke_fill=stroke_fill)

def barcode(d, x, y, w, h):
    d.rectangle([x, y, x + w, y + h], fill=(255, 255, 255))
    xx = x + 2
    while xx < x + w - 2:
        bw = rnd.choice((1, 1, 2, 3))
        d.rectangle([xx, y + 2, xx + bw - 1, y + h - 4], fill=(20, 20, 20)); xx += bw + rnd.choice((1, 2))

def label(p):
    kind, style = p['kind'], p['style']
    wrap = kind in ('can', 'tin', 'tube', 'tub', 'jar', 'bottle2', 'bottle5', 'water', 'wine')
    if wrap:   # the label wraps right round: width = circumference
        r = p['w'] / 2; W = int(2 * math.pi * r * PX); H = int(p['h'] * PX * {'bottle2': 0.36, 'bottle5': 0.42, 'water': 0.36, 'wine': 0.32, 'jar': 0.5}.get(kind, 1.0))
    elif kind == 'pack':   # a biscuit roll on its side: drawn flat (its length by the half of it you see), then wrapped
        W, H = int(p['d'] * PX), int(math.pi * p['h'] / 2 * PX)
    else:
        W, H = int(p['w'] * PX), int(p['h'] * PX)
    W, H = max(W, 48), max(H, 48)
    bg, fg, ac = hexrgb(p['bg']), hexrgb(p['fg']), hexrgb(p['accent'])
    im = Image.new('RGB', (W, H), bg); d = ImageDraw.Draw(im)
    # the front of a wrap is its middle third (that's what faces you on the shelf)
    fx0, fx1 = (W / 3, 2 * W / 3) if wrap else (0, W)
    fw, cx = fx1 - fx0, (fx0 + fx1) / 2
    if style in ('band', 'roll', 'bread'):
        if style == 'bread':
            d.rectangle([0, int(H * 0.3), W, int(H * 0.72)], fill=ac); d.rectangle([0, int(H * 0.33), W, int(H * 0.69)], fill=bg)
        else:
            d.rectangle([0, int(H * 0.38), W, int(H * 0.68)], fill=ac)
            d.rectangle([0, int(H * 0.36), W, int(H * 0.38)], fill=shade(ac, 0.7)); d.rectangle([0, int(H * 0.68), W, int(H * 0.70)], fill=shade(ac, 0.7))
        name_col = fg if style == 'bread' else (bg if sum(ac) > 380 and sum(bg) < 380 else fg)
        if sum(ac) > 600 and sum(fg) > 600: name_col = bg
        centred(d, p['text'], 'bold', cx, H * 0.53, fw * 0.86, H * 0.22, H * 0.2, name_col)
        centred(d, p['sub'], 'sans', cx, H * 0.82, fw * 0.8, H * 0.1, H * 0.09, fg if style != 'bread' else shade(fg, 0.9))
        centred(d, 'GREEN COUNTY', 'italic', cx, H * 0.18, fw * 0.6, H * 0.09, H * 0.08, fg if style != 'bread' else ac)
    elif style == 'swoosh':
        for k in range(3):
            pts = [(x, H * (0.62 + 0.08 * math.sin(x / W * 6.28 * 1.5 + k * 0.6)) + k * H * 0.03) for x in range(0, W + 8, 8)]
            d.line(pts, fill=ac if k == 1 else shade(bg, 1.25), width=max(2, int(H * 0.025)))
        centred(d, p['text'], 'bold', cx, H * 0.38, fw * 0.9, H * 0.28, H * 0.26, fg, stroke=max(1, int(H * 0.008)), stroke_fill=shade(bg, 0.6))
        centred(d, p['sub'], 'italic', cx, H * 0.82, fw * 0.8, H * 0.1, H * 0.09, fg)
    elif style == 'crisps':
        # crimped ends, a window onto the crisps, the flavour big across the top
        for y0 in (0, H - int(H * 0.07)):
            d.rectangle([0, y0, W, y0 + int(H * 0.07)], fill=shade(bg, 0.75))
            for x in range(0, W, 6): d.line([(x, y0), (x, y0 + int(H * 0.07))], fill=shade(bg, 0.6), width=1)
        g = Image.new('L', (W, H), 0); gd = ImageDraw.Draw(g)
        for k in range(40): gd.ellipse([-W * 0.2 + k, -H * 0.3 + k, W * 0.6 - k, H * 0.4 - k], fill=int(k * 2.2))
        im.paste(Image.new('RGB', (W, H), (255, 255, 255)), (0, 0), g.filter(ImageFilter.GaussianBlur(W * 0.05)).point(lambda v: v // 3))
        d = ImageDraw.Draw(im)
        ex0, ey0, ex1, ey1 = W * 0.18, H * 0.48, W * 0.82, H * 0.86
        d.ellipse([ex0, ey0, ex1, ey1], fill=(222, 178, 82), outline=(255, 255, 255), width=max(2, int(W * 0.02)))
        for k in range(26):   # the crisps themselves
            x, y = rnd.uniform(ex0 + 10, ex1 - 10), rnd.uniform(ey0 + 8, ey1 - 8); rr = rnd.uniform(W * 0.04, W * 0.09)
            d.ellipse([x - rr, y - rr * 0.7, x + rr, y + rr * 0.7], fill=mix((236, 196, 98), (205, 150, 60), rnd.random()), outline=(190, 140, 55))
        logo = 'FROSTY' if p['id'] in ('peas', 'chips') else 'CRUNCH'
        d.ellipse([W * 0.25, H * 0.09, W * 0.75, H * 0.21], fill=(244, 208, 63) if logo == 'CRUNCH' else (230, 240, 255)); centred(d, logo, 'italic', W / 2, H * 0.15, W * 0.4, H * 0.08, H * 0.07, (200, 30, 30) if logo == 'CRUNCH' else (30, 70, 160))
        centred(d, p['text'], 'bold', W / 2, H * 0.33, W * 0.92, H * 0.15, H * 0.13, fg, stroke=max(1, int(H * 0.006)), stroke_fill=shade(bg, 0.55))
        centred(d, p['sub'], 'sans', W / 2, H * 0.43, W * 0.8, H * 0.05, H * 0.045, fg)
    elif style == 'bar':
        d.rectangle([0, 0, W, H], fill=bg); d.rectangle([int(W * 0.08), 0, int(W * 0.12), H], fill=ac)
        centred(d, p['text'], 'italic', W * 0.56, H * 0.48, W * 0.7, H * 0.6, H * 0.55, fg)
    elif style == 'cereal':
        d.rectangle([0, 0, W, int(H * 0.2)], fill=ac); centred(d, 'FARMHOUSE', 'italic', W / 2, H * 0.1, W * 0.7, H * 0.1, H * 0.09, (255, 255, 255))
        centred(d, p['text'], 'bold', W / 2, H * 0.32, W * 0.9, H * 0.14, H * 0.12, fg)
        d.ellipse([W * 0.15, H * 0.5, W * 0.85, H * 0.88], fill=(255, 255, 255), outline=shade(bg, 0.7), width=3)   # a bowl
        for k in range(30):
            x, y = rnd.uniform(W * 0.25, W * 0.75), rnd.uniform(H * 0.55, H * 0.72); rr = rnd.uniform(W * 0.025, W * 0.05)
            d.ellipse([x - rr, y - rr * 0.6, x + rr, y + rr * 0.6], fill=mix((222, 160, 60), (160, 100, 40) if 'CHOCO' in p['text'] else (236, 190, 90), rnd.random()))
        d.chord([W * 0.15, H * 0.5, W * 0.85, H * 0.88], 0, 180, fill=mix(bg, (255, 255, 255), 0.4))
        centred(d, p['sub'], 'sans', W / 2, H * 0.94, W * 0.8, H * 0.05, H * 0.045, fg)
    elif style == 'milk':
        d.rectangle([0, 0, W, H], fill=(250, 250, 248)); d.rectangle([0, int(H * 0.62), W, int(H * 0.72)], fill=ac)
        centred(d, p['text'], 'bold', cx, H * 0.4, fw * 0.9, H * 0.16, H * 0.14, ac)
        centred(d, 'MILK', 'bold', cx, H * 0.53, fw * 0.6, H * 0.1, H * 0.09, shade(ac, 0.8))
        centred(d, p['sub'] + ' · 2.272 litres', 'sans', cx, H * 0.67, fw * 0.8, H * 0.06, H * 0.05, (255, 255, 255))
        centred(d, 'BRITISH', 'italic', cx, H * 0.2, fw * 0.5, H * 0.08, H * 0.07, (200, 30, 40))
    elif style == 'wine':
        d.rectangle([0, 0, W, H], fill=(18, 18, 20)) if False else None
        d.rectangle([fx0 + fw * 0.05, H * 0.08, fx1 - fw * 0.05, H * 0.92], fill=bg, outline=shade(fg, 0.9), width=2)
        centred(d, p['text'], 'serif', cx, H * 0.45, fw * 0.8, H * 0.18, H * 0.16, fg)
        centred(d, p['sub'], 'italic', cx, H * 0.7, fw * 0.7, H * 0.08, H * 0.07, shade(fg, 0.85))
        d.ellipse([cx - fw * 0.1, H * 0.14, cx + fw * 0.1, H * 0.28], outline=fg, width=2)
    elif style == 'bolt':
        pts = [(cx - fw * 0.1, H * 0.08), (cx + fw * 0.18, H * 0.08), (cx + fw * 0.02, H * 0.42), (cx + fw * 0.2, H * 0.42), (cx - fw * 0.16, H * 0.92), (cx - fw * 0.02, H * 0.52), (cx - fw * 0.2, H * 0.52)]
        d.polygon(pts, fill=ac); centred(d, p['text'], 'bold', cx, H * 0.3, fw * 0.8, H * 0.14, H * 0.12, (255, 255, 255), stroke=1, stroke_fill=(0, 0, 0))
    elif style == 'fruit':
        for k in range(3):
            x, y, rr = cx + (k - 1) * fw * 0.26, H * 0.62, fw * 0.16
            d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(255, 140, 0), outline=(255, 220, 120), width=3)
            for a in range(8): d.line([(x, y), (x + rr * 0.85 * math.cos(a * 0.785), y + rr * 0.85 * math.sin(a * 0.785))], fill=(255, 200, 90), width=2)
        centred(d, p['text'], 'bold', cx, H * 0.25, fw * 0.9, H * 0.14, H * 0.12, (255, 255, 255))
        centred(d, p['sub'], 'sans', cx, H * 0.88, fw * 0.8, H * 0.06, H * 0.05, (255, 255, 255))
    # small print and a barcode on the back of wraps; a weight line on fronts
    if wrap:
        barcode(d, int(W * 0.06), int(H * 0.62), int(W * 0.12), int(H * 0.22))
    return im

def label_for(p):
    im = label(p)
    if p['kind'] != 'pack': return im
    # round the roll: the wrap runs round it (across the image) and along it (up the image), the writing along its length
    r = p['h'] / 2; W, H = int(2 * math.pi * r * PX), int(p['d'] * PX)
    wrap = Image.new('RGB', (W, H), hexrgb(p['bg']))
    rot = im.rotate(90, expand=True).resize((min(W, int(math.pi * r * PX)), H))
    wrap.paste(rot, ((W - rot.width) // 2, 0))
    return wrap

def tag(p):
    W, H = 300, 90
    im = Image.new('RGB', (W, H), (250, 250, 247)); d = ImageDraw.Draw(im)
    if p.get('promo'):
        im.paste((255, 214, 0), (0, 0, W, H)); d = ImageDraw.Draw(im)
        centred(d, p['promo'], 'bold', W / 2, H * 0.36, W * 0.9, H * 0.42, 40, (200, 20, 20))
        centred(d, p['text'].title() + '  ' + p['price'], 'sans', W / 2, H * 0.78, W * 0.9, H * 0.24, 20, (20, 20, 20))
    else:
        centred(d, p['price'], 'bold', W * 0.72, H * 0.45, W * 0.5, H * 0.6, 50, (20, 20, 20))
        centred(d, p['text'].title(), 'sans', W * 0.26, H * 0.32, W * 0.46, H * 0.3, 18, (40, 40, 40))
        centred(d, 'per item', 'sans', W * 0.26, H * 0.66, W * 0.4, H * 0.2, 14, (90, 90, 90))
    return im

def paper(n):
    W, H = 600, 800
    names = ['THE DAILY HERALD', 'COUNTY EXPRESS', 'THE MORNING POST', 'EVENING CHRONICLE', 'THE WEEKLY STAR', 'BERKSHIRE ECHO']
    heads = ['ROAD CHAOS AS M4 SHUT', 'COUNCIL TAX TO RISE', 'HEATWAVE ON THE WAY', 'READING WIN AT LAST', 'POTHOLE MISERY', 'PRICE OF A PINT SOARS']
    tab = n % 2 == 0
    im = Image.new('RGB', (W, H), (246, 244, 238)); d = ImageDraw.Draw(im)
    if tab: d.rectangle([0, 0, W, 130], fill=(200, 20, 30)); centred(d, names[n % 6], 'bold', W / 2, 65, W * 0.92, 90, 80, (255, 255, 255))
    else: centred(d, names[n % 6], 'serif', W / 2, 70, W * 0.92, 80, 70, (20, 20, 20)); d.line([(20, 130), (W - 20, 130)], fill=(20, 20, 20), width=3)
    centred(d, heads[n % 6], 'bold', W / 2, 230, W * 0.92, 160, 120 if tab else 70, (15, 15, 15))
    d.rectangle([30, 340, W - 30, 640], fill=mix((120, 140, 160), (180, 150, 120), rnd.random()))
    for k in range(6): d.ellipse([60 + k * 80, 420 + (k % 2) * 40, 140 + k * 80, 560], fill=mix((60, 70, 80), (200, 180, 160), rnd.random()))
    for y in range(660, H - 20, 18): d.line([(30, y), (W - 30, y)], fill=(150, 150, 150), width=6)
    return im

for p in P.values():
    label_for(p).save(f'{OUT}/{p["id"]}.png')
    tag(p).save(f'{OUT}/tag_{p["id"]}.png')
for n in range(6): paper(n).save(f'{OUT}/paper_{n}.png')
print('labels:', len(P), 'products, 6 papers ->', OUT)
