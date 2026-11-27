"""Encode only supported observed OSM building finishes. Unknown tags stay unknown."""
def finish_code(tags):
    material = str(tags.get('building:material', '')).lower().strip()
    colour = str(tags.get('building:colour', '')).lower().strip()
    roof = str(tags.get('roof:material', '')).lower().strip()
    rcolour = str(tags.get('roof:colour', '')).lower().strip()
    wall = 0
    if material in ('brick', 'bricks'):
        wall = 5 if colour in ('yellow', 'buff', 'cream', 'beige') else 2 if colour in ('brown', 'dark_brown', 'dark_red') else 1
    elif material in ('plaster', 'render', 'stucco'): wall = 3
    elif material in ('pebbledash', 'pebble_dashed'): wall = 4
    elif material in ('stone', 'sandstone', 'limestone'): wall = 6
    elif material in ('concrete', 'concrete_block'): wall = 7
    elif material in ('metal', 'steel', 'aluminium', 'cladding'): wall = 8
    roof_code = 0
    if roof in ('slate', 'slates'): roof_code = 1
    elif roof in ('roof_tiles', 'tiles', 'clay', 'terracotta'):
        if rcolour in ('red', 'orange', 'brown', 'terracotta'): roof_code = 2
        # Grey tiles do not prove slate; leave unsupported/ambiguous finishes unknown.
    elif roof in ('bitumen', 'tar_paper', 'felt', 'asphalt'): roof_code = 3
    return wall | roof_code << 5
