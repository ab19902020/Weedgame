import urllib.request,concurrent.futures,xml.etree.ElementTree as E,json,os,time
places=[(-.974,51.456),(-.95,51.45),(-.927,51.453),(-.909,51.454),(-.901,51.442),(-.928,51.434),(-.882,51.435),(-.862,51.428),(-.842,51.421),(-.819,51.414),(-.795,51.409),(-.772,51.413),(-.75,51.415)]
def get(p):
 x,y=p
 url='https://api.openstreetmap.org/api/0.6/map?bbox='+','.join('%.5f'%v for v in (x-.014,y-.012,x+.014,y+.012))
 for i in range(3):
  try:
   root=E.fromstring(urllib.request.urlopen(url,timeout=45).read());nodes={n.get('id'):[round((float(n.get('lon'))+.99)*69400),round((51.48-float(n.get('lat')))*111100)] for n in root.findall('node')}; ways={}
   for w in root.findall('way'):
    t={k.get('k'):k.get('v') for k in w.findall('tag')}; h=t.get('highway','')
    if h in 'motorway motorway_link trunk trunk_link primary primary_link secondary tertiary residential unclassified service living_street'.split() or 'building' in t:
     a=[nodes[n.get('ref')] for n in w.findall('nd') if n.get('ref') in nodes]
     if len(a)>1:ways[w.get('id')]=[h or 'b',a,t.get('name') or t.get('ref') or '',t.get('building','')]
   if ways:return ways
  except Exception:pass
 return {}
allways={}
with concurrent.futures.ThreadPoolExecutor(4) as e:
 for w in e.map(get,places):
  if not w:raise RuntimeError('Missing Berkshire extract')
  allways.update(w);print(len(w),flush=True)
open('www/map.js','w').write('const features='+json.dumps(list(allways.values()),separators=(',',':'))+';')
