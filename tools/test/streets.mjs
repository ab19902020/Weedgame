import fs from 'node:fs';
import {inflate,decode} from '../../src/data.js';
import {Network} from '../../src/network.js';
import {Buses} from '../../src/services.js';
import {Signals} from '../../src/signals.js';
const n=new Network(decode(await inflate(fs.readFileSync('www/world/network.bin')))),bs=new Buses({net:n}),sig=new Signals(n);
let invalid=0,breaks=0;
for(const r of bs.routes)r.hs.forEach((h,i)=>{if(i&&n.endNode(r.hs[i-1])!==n.startNode(h))breaks++;if(!n.outD[n.startNode(h)].includes(h) && !((n.flags[h>>1]&128) && !(h&1)))invalid++;});
for(let t=0;t<2000;t++){if(t%200===0)sig.ctl.forEach(c=>sig.press(c.i));sig.update(.25);for(const c of sig.ctl)if(sig.ped(c.i)==='walk'&&c.approaches.some(a=>sig.aspect(c.i,a[3])==='G'))throw Error('conflicting green');}
console.log({roads:n.nEdges,signals:sig.ctl.length,routes:bs.routes.length,withStops:bs.routes.filter(r=>r.stops.length).length,invalid,breaks});

if(invalid || breaks) throw Error('Disconnected or disallowed service traversal');

// Waiting for a long signal cycle must never override a red pedestrian aspect.
const {Peds}=await import('../../src/peds.js');
const busy=new Map();
const peds=Object.create(Peds.prototype);
peds.net={width:[8]};
peds.pos=()=>[0,0,1,0];
peds.controllerFor=()=>0;
peds.G={signals:{t:60,press(){},ped:()=> 'wait'},traffic:{list:[{x:0,z:0,v:8}],zebraBusy:busy}};
const pedestrian={h:0,x:0,z:0,sideSign:1,mode:'waitCross',crossT:60,cross:{kind:'signal',s:4,x:0,z:0}};
peds.waitCross(pedestrian,.1);
if(pedestrian.mode!=='waitCross')throw Error('Entered on red after long wait');
pedestrian.cross.kind='zebra';
peds.waitCross(pedestrian,.1);
if(!busy.has('0:4') || pedestrian.mode!=='waitCross')throw Error('Zebra demand failed');
peds.G.traffic.list[0].v=0;
peds.waitCross(pedestrian,.1);
if(pedestrian.mode!=='cross')throw Error('Failed to cross after traffic stopped');
