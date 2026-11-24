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
