// Generate from the shipped OSM track geometry. Station centroids: davwheat/uk-railway-stations.
import fs from 'node:fs';
import {decode,inflate} from '../../src/data.js';
import {llToWorld} from '../../src/save.js';
const stations=[['Reading',-.972318,51.45922],['Earley',-.917989,51.441051],['Winnersh Triangle',-.89183,51.436767],['Winnersh',-.87795,51.430779],['Wokingham',-.842981,51.411904],['Bracknell',-.751833,51.413319],['Martins Heron',-.725417,51.407654]];
const manifest=JSON.parse(fs.readFileSync('www/world/manifest.json')),nodes=new Map();
for(const tile of manifest.tiles){
 const {header:h,arrays:a}=decode(await inflate(fs.readFileSync('www/world/tiles/'+tile+'.bin')));
 function point(x,z,y){const X=Math.round((h.ix*256+x)*10)/10,Z=Math.round((h.iz*256+z)*10)/10,k=X+','+Z;
 if(!nodes.has(k))nodes.set(k,{x:X,z:Z,y:+y.toFixed(2),edges:new Set()});return nodes.get(k);}
 function link(last,p){if(last && last!==p){last.edges.add(p);p.edges.add(last);}return p;}
 let i=0;
 for(const n of a.railN){let last;for(let j=0;j<n;j++,i++){
 const x=a.railC[i*2]/10,z=a.railC[i*2+1]/10,gx=Math.min(63,Math.max(0,Math.floor(x/4))),gz=Math.min(63,Math.max(0,Math.floor(z/4))),u=x/4-gx,v=z/4-gz,k=gz*65+gx;
 const H=a.h;const y=H[k]*(1-u)*(1-v)+H[k+1]*u*(1-v)+H[k+65]*(1-u)*v+H[k+66]*u*v;
 last=link(last,point(x,z,h.hmin+y/100));}}
 i=0;for(let k=0;k<a.brM.length;k+=4){let last;for(let j=0;j<a.brM[k];j++,i++)if(a.brM[k+2]===2)last=link(last,point(a.brP[i*3],a.brP[i*3+2],a.brP[i*3+1]));}
}
function path(a,b){const q=[a],parent=new Map([[a,null]]);for(let i=0;i<q.length;i++){const p=q[i];if(p===b){const list=[];for(let v=b;v;v=parent.get(v))list.push(v);return list.reverse();}for(const v of p.edges)if(!parent.has(v)){parent.set(v,p);q.push(v);}}}
const stops=stations.map(([name,lon,lat])=>{const [x,z]=llToWorld(manifest.llfit,lon,lat);return {name,x,z,near:[...nodes.values()].filter(p=>Math.hypot(p.x-x,p.z-z)<100).sort((a,b)=>Math.hypot(a.x-x,a.z-z)-Math.hypot(b.x-x,b.z-z))};});
// Select one continuous end-to-end alignment to avoid changing tracks at stations.
let points, last;
for(const start of nodes.values()){if(start.component)continue;const stack=[start];start.component=start;while(stack.length){const p=stack.pop();for(const v of p.edges)if(!v.component){v.component=start;stack.push(v);}}}
for(last=stops.length-1;last>=1&&!points;last--){
 for(const a of stops[0].near){for(const b of stops[last].near){if(a.component!==b.component)continue;points=path(a,b);if(points)break;}if(points)break;}
}
if(!points)throw Error('No connected main line');
const calls=[];let cursor=0;
for(const stop of stops.slice(0,last+2)){
 let best=-1,gap=100;
 for(let i=cursor;i<points.length;i++){const d=Math.hypot(points[i].x-stop.x,points[i].z-stop.z);if(d<gap){best=i;gap=d;}}
 if(best<0)throw Error('Alignment misses '+stop.name);
 calls.push({name:stop.name,i:best});cursor=best+1;
}
console.log(calls);
fs.writeFileSync('src/railLine.json',JSON.stringify({calls,points:points.map(p=>[p.x,p.y,p.z])}));
