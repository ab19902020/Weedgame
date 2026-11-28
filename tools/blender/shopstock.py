# What's on the shelves of a British convenience shop: the product kinds (their shapes, made in Blender by
# shelves.py), their labels (drawn by labels.py) and how each bay of shelving is stocked. Generic names only: no real
# brands. Sizes in metres; colours as hex.
#
# kinds: can (330 ml), bottle2 (2 l PET), bottle5 (500 ml PET), water (500 ml), milk (HDPE, coloured cap: green
# semi-skimmed, blue whole, red skimmed), box (card carton), bag (crisp/snack bag), tube (crisp tube), tin (food
# tin), jar, loaf (bread in its bag), roll (toilet roll pack), wine, beercan (4-pack of 440 ml), bar (chocolate
# bar), tub (yoghurt/ice cream), pack (biscuit pack, lying), sandwich (triangle pack), carton (juice)

P = {}
def prod(pid, kind, w, h, d, text, bg, fg='#ffffff', accent=None, sub='', style='band', cap=None, liquid=None, price='£1.00', promo=None):
    P[pid] = dict(id=pid, kind=kind, w=w, h=h, d=d, text=text, sub=sub, bg=bg, fg=fg, accent=accent or fg, style=style,
                  cap=cap, liquid=liquid, price=price, promo=promo)

# ---- soft drinks
prod('cola2', 'bottle2', 0.105, 0.33, 0.105, 'COLA', '#c8102e', '#ffffff', '#ffffff', 'Original taste', 'swoosh', cap='#c8102e', liquid='#2a120a', price='£2.15', promo='2 for £4')
prod('diet2', 'bottle2', 0.105, 0.33, 0.105, 'COLA', '#d8d8d8', '#c8102e', '#111111', 'Zero sugar', 'swoosh', cap='#111111', liquid='#2a120a', price='£2.15')
prod('lemon2', 'bottle2', 0.105, 0.33, 0.105, 'LEMONADE', '#f2f2f2', '#2a8a3a', '#f4d03f', 'Cloudy', 'band', cap='#2a8a3a', liquid='#e8eccf', price='£1.25')
prod('orange2', 'bottle2', 0.105, 0.33, 0.105, 'ORANGE', '#f07c00', '#ffffff', '#1b5e20', 'Fizzy', 'swoosh', cap='#f07c00', liquid='#f6a01a', price='£1.95')
prod('water5', 'water', 0.068, 0.215, 0.068, 'SPRING', '#1f6fb2', '#ffffff', '#9fd3f5', 'Still water', 'band', cap='#1f6fb2', liquid='#e8f4fb', price='£0.85')
prod('cola5', 'bottle5', 0.068, 0.22, 0.068, 'COLA', '#c8102e', '#ffffff', '#ffffff', '500ml', 'swoosh', cap='#c8102e', liquid='#2a120a', price='£1.65', promo='Meal deal')
prod('energy5', 'can', 0.033, 0.168, 0.033, 'VOLT', '#101010', '#7ed321', '#7ed321', 'Energy', 'bolt', price='£1.35', promo='2 for £2.50')
prod('cans8', 'box', 0.27, 0.125, 0.135, 'COLA', '#c8102e', '#ffffff', '#ffffff', '8 x 330ml cans', 'swoosh', price='£4.50')
prod('orangejuice', 'carton', 0.095, 0.235, 0.065, 'ORANGE JUICE', '#ff9f1a', '#ffffff', '#3c8d2f', 'Smooth · 1 litre', 'fruit', price='£1.60')
# ---- crisps and snacks
for pid, text, bg in [('crisps_rs', 'READY SALTED', '#d0021b'), ('crisps_co', 'CHEESE & ONION', '#1f5fbf'), ('crisps_sv', 'SALT & VINEGAR', '#159a3a'),
                      ('crisps_pc', 'PRAWN COCKTAIL', '#e86aa8'), ('crisps_sb', 'SMOKY BACON', '#7a1f2b'), ('crisps_bbq', 'BBQ BEEF', '#6b3a1f')]:
    prod(pid, 'bag', 0.20, 0.27, 0.07, text, bg, '#ffffff', '#f4d03f', '6 x 25g multipack', 'crisps', price='£1.85', promo='2 for £3' if pid in ('crisps_rs', 'crisps_sv') else None)
prod('tube_orig', 'tube', 0.075, 0.25, 0.075, 'STACKS', '#c0392b', '#ffffff', '#f4d03f', 'Original', 'band', price='£2.25')
prod('tube_sc', 'tube', 0.075, 0.25, 0.075, 'STACKS', '#27ae60', '#ffffff', '#f4d03f', 'Sour cream', 'band', price='£2.25')
prod('popcorn', 'bag', 0.16, 0.22, 0.06, 'POPCORN', '#f4d03f', '#7b3f00', '#c0392b', 'Sweet & salty', 'crisps', price='£1.10')
prod('nuts', 'bag', 0.13, 0.18, 0.05, 'PEANUTS', '#7b3f00', '#ffffff', '#f4d03f', 'Dry roasted', 'crisps', price='£1.25')
# ---- biscuits, chocolate, sweets
prod('digestive', 'pack', 0.075, 0.075, 0.20, 'DIGESTIVES', '#1d4e9e', '#ffffff', '#d0021b', 'The original', 'roll', price='£0.99')
prod('choc_dig', 'pack', 0.075, 0.075, 0.20, 'MILK CHOC', '#5a2d0c', '#ffffff', '#d4af37', 'Digestives', 'roll', price='£1.50', promo='2 for £2.50')
prod('richtea', 'pack', 0.07, 0.07, 0.20, 'RICH TEA', '#c0392b', '#ffffff', '#f4d03f', 'Biscuits', 'roll', price='£0.85')
prod('custard', 'box', 0.20, 0.06, 0.08, 'CUSTARD CREAMS', '#f4d03f', '#5a2d0c', '#c0392b', 'Vanilla flavour', 'band', price='£0.65')
prod('bourbon', 'box', 0.20, 0.06, 0.08, 'BOURBON', '#4a2511', '#ffffff', '#d4af37', 'Chocolate creams', 'band', price='£0.65')
prod('chocbar', 'bar', 0.11, 0.02, 0.05, 'MILK', '#4b1c7d', '#ffffff', '#d4af37', 'Chocolate', 'bar', price='£0.85')
prod('chocbar2', 'bar', 0.11, 0.02, 0.05, 'CARAMEL', '#c0392b', '#ffffff', '#f4d03f', 'Bar', 'bar', price='£0.85')
prod('chocbar3', 'bar', 0.11, 0.02, 0.05, 'NUTTY', '#1f3a93', '#ffffff', '#f4d03f', 'Peanut', 'bar', price='£0.85')
prod('sharebag', 'bag', 0.17, 0.21, 0.05, 'FRUIT CHEWS', '#e91e63', '#ffffff', '#f4d03f', 'Share bag', 'crisps', price='£1.25', promo='£1.25')
# ---- tins and jars, tea and coffee
prod('beans', 'tin', 0.075, 0.11, 0.075, 'BAKED BEANS', '#1aa6a6', '#ffffff', '#e74c3c', 'in tomato sauce', 'band', price='£0.89')
prod('soup', 'tin', 0.075, 0.11, 0.075, 'TOMATO SOUP', '#c0392b', '#ffffff', '#f4d03f', 'Cream of', 'band', price='£1.10')
prod('toms', 'tin', 0.075, 0.11, 0.075, 'CHOPPED', '#e74c3c', '#ffffff', '#27ae60', 'Tomatoes', 'band', price='£0.55')
prod('corn', 'tin', 0.075, 0.08, 0.075, 'SWEETCORN', '#f1c40f', '#1e8449', '#1e8449', 'Golden', 'band', price='£0.70')
prod('hoops', 'tin', 0.075, 0.11, 0.075, 'PASTA HOOPS', '#e67e22', '#ffffff', '#2980b9', 'in tomato sauce', 'band', price='£0.75')
prod('pasta_sauce', 'jar', 0.08, 0.15, 0.08, 'ITALIAN', '#7b241c', '#ffffff', '#27ae60', 'Tomato & basil', 'band', liquid='#a93226', cap='#c9a227', price='£1.75')
prod('coffee', 'jar', 0.085, 0.16, 0.085, 'GOLD', '#1b1b1b', '#d4af37', '#d4af37', 'Instant coffee', 'band', liquid='#4a2c17', cap='#d4af37', price='£4.20')
prod('teabags', 'box', 0.135, 0.16, 0.115, 'TEA', '#c0392b', '#ffffff', '#1e8449', '80 tea bags', 'band', price='£2.65', promo='Was £3.10')
# ---- cereal and bread
prod('cornflakes', 'box', 0.20, 0.30, 0.07, 'CORN FLAKES', '#ffffff', '#1e8449', '#c0392b', 'Toasted', 'cereal', price='£2.30')
prod('wheat', 'box', 0.20, 0.27, 0.08, 'WHEAT BISKS', '#f4d03f', '#c0392b', '#7b3f00', '24 pack', 'cereal', price='£2.75')
prod('oats', 'box', 0.15, 0.22, 0.09, 'PORRIDGE OATS', '#1f3a93', '#ffffff', '#f4d03f', 'Rolled oats', 'cereal', price='£1.60')
prod('chocpops', 'box', 0.19, 0.28, 0.07, 'CHOCO POPS', '#7b3f00', '#f4d03f', '#e67e22', 'Rice', 'cereal', price='£2.50')
prod('white_loaf', 'loaf', 0.13, 0.12, 0.30, 'MEDIUM WHITE', '#ffffff', '#1f3a93', '#d0021b', '800g', 'bread', price='£1.20')
prod('brown_loaf', 'loaf', 0.13, 0.12, 0.30, 'WHOLEMEAL', '#e8d8b8', '#7b3f00', '#1e8449', '800g', 'bread', price='£1.30')
# ---- household
prod('loo9', 'roll', 0.33, 0.33, 0.11, 'SOFT', '#ffffff', '#5b2c83', '#f8bbd0', '9 toilet rolls', 'band', price='£4.75', promo='Half price')
prod('kitchen', 'roll', 0.26, 0.24, 0.13, 'KITCHEN ROLL', '#ffffff', '#1f6fb2', '#9fd3f5', '2 rolls', 'band', price='£2.00')
prod('wash_up', 'bottle5', 0.07, 0.24, 0.05, 'WASHING UP', '#2ecc71', '#ffffff', '#ffffff', 'Original', 'band', cap='#ffffff', liquid='#2ecc71', price='£1.00')
prod('bleach', 'bottle5', 0.08, 0.27, 0.06, 'THICK BLEACH', '#ffffff', '#1f3a93', '#d0021b', '750ml', 'band', cap='#d0021b', liquid='#ffffff', price='£0.75')
prod('capsules', 'box', 0.17, 0.20, 0.10, 'BIO CAPS', '#1f6fb2', '#ffffff', '#f4d03f', '24 washes', 'band', price='£6.00')
# ---- chilled
prod('milk_semi', 'milk', 0.11, 0.24, 0.11, 'SEMI-SKIMMED', '#ffffff', '#1e8449', '#1e8449', '4 pints', 'milk', cap='#1e8449', price='£1.65')
prod('milk_whole', 'milk', 0.11, 0.24, 0.11, 'WHOLE MILK', '#ffffff', '#1f3a93', '#1f3a93', '4 pints', 'milk', cap='#1f3a93', price='£1.65')
prod('milk_skim', 'milk', 0.09, 0.19, 0.09, 'SKIMMED', '#ffffff', '#c0392b', '#c0392b', '2 pints', 'milk', cap='#c0392b', price='£1.10')
prod('yog', 'tub', 0.075, 0.08, 0.075, 'STRAWBERRY', '#f8bbd0', '#c2185b', '#c2185b', 'Yogurt', 'band', price='£0.70')
prod('yog2', 'tub', 0.075, 0.08, 0.075, 'GREEK STYLE', '#ffffff', '#1f6fb2', '#1f6fb2', 'Natural', 'band', price='£0.90')
prod('cheddar', 'box', 0.16, 0.06, 0.03, 'MATURE CHEDDAR', '#f39c12', '#1b1b1b', '#c0392b', '400g', 'band', price='£3.25')
prod('butter', 'tub', 0.11, 0.07, 0.11, 'SPREADABLE', '#f7dc6f', '#1e8449', '#1e8449', 'Butter', 'band', price='£2.40')
prod('sandwich', 'sandwich', 0.13, 0.13, 0.07, 'CHICKEN', '#ffffff', '#1b1b1b', '#c0392b', 'Club sandwich', 'band', price='£3.50', promo='Meal deal £3.85')
prod('sandwich2', 'sandwich', 0.13, 0.13, 0.07, 'EGG & CRESS', '#ffffff', '#1b1b1b', '#f4d03f', 'Free range', 'band', price='£2.75', promo='Meal deal £3.85')
prod('ham', 'box', 0.15, 0.025, 0.1, 'HONEY ROAST HAM', '#f5b7b1', '#7b241c', '#7b241c', '8 slices', 'band', price='£2.00')
# ---- alcohol
prod('wine_red', 'wine', 0.075, 0.30, 0.075, 'MERLOT', '#f5f0e1', '#5a1220', '#5a1220', 'Chile', 'wine', cap='#5a1220', liquid='#2a0a10', price='£7.50')
prod('wine_white', 'wine', 0.075, 0.30, 0.075, 'SAUVIGNON', '#f5f0e1', '#1e5631', '#1e5631', 'New Zealand', 'wine', cap='#c9a227', liquid='#e7dfa8', price='£8.00')
prod('wine_rose', 'wine', 0.075, 0.30, 0.075, 'ROSÉ', '#fbeee6', '#c2185b', '#c2185b', 'California', 'wine', cap='#f8bbd0', liquid='#f1948a', price='£6.75')
prod('lager4', 'beercan', 0.135, 0.17, 0.135, 'LAGER', '#1f3a93', '#ffffff', '#f4d03f', '4 x 440ml', 'band', price='£5.00', promo='2 for £9')
prod('bitter4', 'beercan', 0.135, 0.17, 0.135, 'BEST BITTER', '#7b3f00', '#f4d03f', '#ffffff', '4 x 440ml', 'band', price='£5.50')
prod('cider4', 'beercan', 0.135, 0.17, 0.135, 'CIDER', '#1e8449', '#ffffff', '#f4d03f', '4 x 440ml', 'band', price='£4.75')
# ---- frozen (seen from above in the chest freezer)
prod('icecream', 'tub', 0.16, 0.10, 0.11, 'VANILLA', '#fdfefe', '#7b3f00', '#f4d03f', 'Ice cream 2L', 'band', price='£2.50')
prod('peas', 'bag', 0.18, 0.26, 0.05, 'GARDEN PEAS', '#1e8449', '#ffffff', '#f4d03f', 'Frozen 900g', 'crisps', price='£1.40')
prod('chips', 'bag', 0.2, 0.30, 0.06, 'OVEN CHIPS', '#f4d03f', '#c0392b', '#c0392b', 'Crinkle cut', 'crisps', price='£2.00')

# ---- the bays: [name, bay height, shelves as (height of the shelf board, [product ids, used in turn across it])]
BAYS = {
    'drinks':    (1.6, [(0.12, ['cans8', 'cans8']), (0.52, ['cola2', 'diet2', 'lemon2', 'orange2']), (0.92, ['orangejuice', 'cola5', 'water5']), (1.25, ['energy5', 'cola5', 'water5'])]),
    'crisps':    (1.6, [(0.12, ['crisps_rs', 'crisps_co', 'crisps_sv']), (0.48, ['crisps_pc', 'crisps_sb', 'crisps_bbq']), (0.84, ['tube_orig', 'tube_sc', 'popcorn']), (1.2, ['nuts', 'sharebag', 'popcorn'])]),
    'biscuits':  (1.6, [(0.12, ['digestive', 'choc_dig', 'richtea']), (0.42, ['custard', 'bourbon']), (0.72, ['teabags', 'coffee']), (1.02, ['chocbar', 'chocbar2', 'chocbar3', 'sharebag']), (1.3, ['digestive', 'richtea'])]),
    'tins':      (1.6, [(0.12, ['beans', 'beans', 'soup']), (0.42, ['toms', 'corn', 'hoops']), (0.72, ['pasta_sauce', 'coffee']), (1.02, ['soup', 'beans', 'toms']), (1.32, ['teabags'])]),
    'cereal':    (1.6, [(0.12, ['white_loaf', 'brown_loaf']), (0.48, ['cornflakes', 'wheat']), (0.88, ['chocpops', 'oats']), (1.25, ['oats', 'teabags'])]),
    'household': (1.6, [(0.12, ['loo9']), (0.5, ['kitchen', 'capsules']), (0.85, ['wash_up', 'bleach']), (1.2, ['capsules', 'wash_up'])]),
    'alcohol':   (1.6, [(0.12, ['lager4', 'bitter4', 'cider4']), (0.48, ['lager4', 'cider4']), (0.84, ['wine_red', 'wine_white']), (1.22, ['wine_rose', 'wine_red', 'wine_white'])]),
    'dairy':     (1.9, [(0.15, ['milk_semi', 'milk_whole', 'milk_semi', 'milk_skim']), (0.55, ['yog', 'yog2', 'butter']), (0.85, ['cheddar', 'ham', 'cheddar']), (1.15, ['sandwich', 'sandwich2']), (1.48, ['sandwich2', 'sandwich', 'orangejuice'])]),
    'fridge':    (1.9, [(0.15, ['cola5', 'water5', 'cola5']), (0.55, ['energy5', 'energy5', 'cola5']), (0.92, ['water5', 'orangejuice']), (1.3, ['cola5', 'energy5', 'water5'])]),
}
# a chest freezer, from above; the counter's front (sweets); the tobacco gantry (shutters, as the law has had them since
# 2015); the newspapers
EXTRA = ['freezer', 'sweets', 'gantry', 'papers']
