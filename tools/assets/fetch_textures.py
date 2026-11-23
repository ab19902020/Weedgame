"""Build the CC0 surface library from Poly Haven (https://polyhaven.com, CC0 1.0).

For each layer: downloads the 1k diffuse, OpenGL normal, roughness and (if present) AO maps,
resizes to 512 px, and writes two JPEGs per layer into www/assets/tex/:
  <n>_a.jpg  RGB = albedo (sRGB), A not used (JPEG) -> AO is multiplied into albedo at 35 %
  <n>_n.jpg  R,G = tangent-space normal X,Y (OpenGL convention), B = roughness
plus www/assets/tex/library.json with ids, real-world tile size in metres and source URLs.
Usage: python3 -I tools/assets/fetch_textures.py
"""
import json, io, os, sys, urllib.request, concurrent.futures
from PIL import Image, ImageChops
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'www', 'assets', 'tex')
UA = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) texture-fetch'}
LAYERS = [  # name, polyhaven id, fallback tile size (m)
    ('asphalt', 'asphalt_02', 3), ('flags', 'concrete_pavement', 2.4), ('blocks', 'herringbone_pavement', 1.6),
    ('concrete', 'concrete', 3), ('grass', 'leafy_grass', 2.5), ('brick_red', 'red_brick_03', 2),
    ('brick_dark', 'brick_wall_001', 2), ('brick_buff', 'brick_wall_02', 2), ('render', 'painted_plaster_wall', 2.5),
    ('pebbledash', 'pebble_embedded_concrete', 1.5), ('roof_clay', 'clay_roof_tiles', 2.5), ('roof_slate', 'roof_slates_02', 2.5),
    ('felt', 'asphalt_04', 3), ('cladding', 'corrugated_iron_02', 2), ('gravel', 'gravel_floor', 1.5),
    ('bark', 'bark_brown_02', 1.5), ('soil', 'farm_soil', 3), ('stone', 'sandstone_blocks_08', 2.5), ('concrete_wall', 'plaster_grey_04', 3),
    ('forest', 'forest_leaves_02', 2.5),
]
N = 512
def op(u): return urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=90)
def img(url, mode): return Image.open(io.BytesIO(op(url).read())).convert(mode).resize((N, N), Image.LANCZOS)
def build(i_layer):
    i, (name, pid, fallback) = i_layer
    files = json.load(op(f'https://api.polyhaven.com/files/{pid}'))
    info = json.load(op(f'https://api.polyhaven.com/info/{pid}'))
    def url(key):
        for k in (key,):
            if k in files and '1k' in files[k]:
                f = files[k]['1k']
                return (f.get('jpg') or f.get('png'))['url']
        return None
    alb = img(url('Diffuse'), 'RGB')
    ao_u = url('AO')
    if ao_u:
        ao = img(ao_u, 'L').point(lambda v: int(255 - (255 - v) * 0.35))
        alb = ImageChops.multiply(alb, Image.merge('RGB', (ao, ao, ao)))
    nor = img(url('nor_gl'), 'RGB')
    rough = img(url('Rough'), 'L') if url('Rough') else Image.new('L', (N, N), 200)
    r, g, _ = nor.split()
    alb.save(os.path.join(OUT, f'{i}_a.jpg'), quality=88)
    Image.merge('RGB', (r, g, rough)).save(os.path.join(OUT, f'{i}_n.jpg'), quality=92)
    dims = info.get('dimensions')  # millimetres [w, h]
    size = round(dims[0] / 1000, 3) if dims else fallback
    return dict(layer=i, name=name, id=pid, tileMetres=size, url=f'https://polyhaven.com/a/{pid}', licence='CC0 1.0',
                authors=list((info.get('authors') or {}).keys()))
os.makedirs(OUT, exist_ok=True)
with concurrent.futures.ThreadPoolExecutor(5) as ex:
    lib = list(ex.map(build, enumerate(LAYERS)))
json.dump({'size': N, 'layers': lib}, open(os.path.join(OUT, 'library.json'), 'w'), indent=1)
for l in lib: print(l['layer'], l['name'], l['id'], l['tileMetres'], 'm')
