import { F_DRIVE, F_ONEWAY, F_ROUNDABOUT } from './network.js';

const storageKey = 'green-county-waypoint-v1';
export const distanceLabel = m => m < 402 ? Math.round(m / .9144) + ' yd' : (m / 1609.344).toFixed(1) + ' mi';

function options(net, snap, walk) {
  const edge = snap.e, forward = edge * 2;
  const list = [{h:forward, s:snap.s}];
  if (walk || !(net.flags[edge] & F_ONEWAY)) list.push({h:forward+1, s:net.len[edge]-snap.s});
  return list;
}

// Clip both end streets at the projected positions, including same-street trips.
export function makeRoute(net, me, pin, walk) {
  const eligible = e => walk ? net.walkable(e) : net.flags[e] & F_DRIVE;
  const start = net.nearest(me.x,me.z,120,eligible), end = net.nearest(pin.x,pin.z,120,eligible);
  if (!start || !end) return null;
  let best, cost = Infinity;
  function consider(legs) {
    const value = legs.reduce((sum,[h,a,b]) => sum+(b-a)/(walk ? 1.4 : Math.max(4,net.speed[h>>1]/3.6)),0);
    if (value < cost) { best=legs; cost=value; }
  }
  for (const a of options(net,start,walk)) for (const b of options(net,end,walk)) {
    if (a.h===b.h && a.s<=b.s) { consider([[a.h,a.s,b.s]]); continue; }
    const first = net.len[a.h>>1]-a.s, last = b.s;
    if ((first+last)/(walk ? 1.4 : 50) >= cost) continue;
    const path = net.route(net.endNode(a.h),net.startNode(b.h),{walk});
    if (path) consider([[a.h,a.s,net.len[a.h>>1]],...path.map(h=>[h,0,net.len[h>>1]]),[b.h,0,b.s]]);
  }
  if (!best) return null;
  const pts=[], turns=[];
  let length=0, previous;
  const add=(x,z)=>{
    const p=pts.at(-1), step=p ? Math.hypot(x-p.x,z-p.z) : 0;
    if (p && step<.01) return;
    length+=step; pts.push({x,z,d:length});
  };
  for (const [h,a,b] of best) {
    if (b-a<.01) continue;
    const e=h>>1, s=net.pstart[e], n=net.pcount[e], reversed=h&1;
    const first=net.at(h,a,[]), last=net.at(h,b,[]);
    if (previous) {
      const angle=Math.atan2(previous[3]*first[4]-previous[4]*first[3],previous[3]*first[3]+previous[4]*first[4]);
      const circle=!!(net.flags[e]&F_ROUNDABOUT);
      const cue = circle && !previous.circle ? 'Enter roundabout' : !circle && previous.circle ? 'Exit roundabout' :
        !circle && Math.abs(angle)>.60 ? (Math.abs(angle)>2.7 ? 'Turn around' : angle>0 ? 'Turn right' : 'Turn left') : '';
      if (cue) turns.push({d:length,cue,name:net.roadName(e)});
    }
    add(first[0],first[2]);
    for (let k=0;k<n;k++) {
      const j=s+(reversed ? n-1-k : k), d=reversed ? net.len[e]-net.cum[j] : net.cum[j];
      if (d>a && d<b) add(net.pts[j*3],net.pts[j*3+2]);
    }
    add(last[0],last[2]); previous=last; previous.circle=!!(net.flags[e]&F_ROUNDABOUT);
  }
  if (!pts.length) add(end.x,end.z);
  turns.push({d:length,cue:'Arrive',name:pin.name});
  return {pts,turns,length};
}

export class Navigation {
  constructor(net) {
    this.net=net; this.pin=null;
    try { const p=JSON.parse(localStorage.getItem(storageKey)); if (p && Number.isFinite(p.x) && Number.isFinite(p.z) && typeof p.name==='string') this.pin=p; } catch {}
  }
  set(pin) {
    this.pin=pin; this.route=null; this.anchor=null;
    try { if (pin) localStorage.setItem(storageKey,JSON.stringify(pin)); else localStorage.removeItem(storageKey); } catch {}
  }
  update(me) {
    if (!this.pin) return;
    const walk=!me.vehicle, now=performance.now();
    const plan=()=>{
      this.route=makeRoute(this.net,me,this.pin,walk);
      this.progress=0; this.walk=walk; this.anchor={x:me.x,z:me.z}; this.planned=now;
    };
    if (!this.anchor || this.walk!==walk || (!this.route && now-this.planned>2000 && Math.hypot(me.x-this.anchor.x,me.z-this.anchor.z)>15)) plan();
    if (!this.route) return;
    let best=Infinity, along=0;
    const {pts,length}=this.route;
    for (let i=1;i<pts.length;i++) {
      const a=pts[i-1],b=pts[i], dx=b.x-a.x,dz=b.z-a.z;
      const t=Math.max(0,Math.min(1,((me.x-a.x)*dx+(me.z-a.z)*dz)/(dx*dx+dz*dz)));
      const gap=Math.hypot(me.x-a.x-t*dx,me.z-a.z-t*dz);
      if (gap<best) {best=gap;along=a.d+t*(b.d-a.d);}
    }
    if (best>(walk?16:28) && pts.length>1 && now-this.planned>2500) {plan();return;}
    this.progress=along;
    const end=pts.at(-1);
    if (length-along<12 && Math.hypot(me.x-end.x,me.z-end.z)<12) {this.set(null);return 'Waypoint reached';}
  }
  instruction() {
    if (!this.pin) return '';
    if (!this.route) return 'No connected route · choose another street';
    const turn=this.route.turns.find(t=>t.d>this.progress+3) || this.route.turns.at(-1);
    return turn.cue+' in '+distanceLabel(Math.max(0,turn.d-this.progress))+(turn.name?' · '+turn.name:'');
  }
  draw(c,X,Z,unit=1) {
    if (!this.pin) return;
    c.save();
    if (this.route) {
      const pts=this.route.pts;
      c.beginPath(); let started=false;
      for(let i=1;i<pts.length;i++){
        const a=pts[i-1], b=pts[i]; if(b.d<this.progress)continue;
        if(!started){const t=Math.max(0,(this.progress-a.d)/(b.d-a.d));c.moveTo(X(a.x+t*(b.x-a.x)),Z(a.z+t*(b.z-a.z)));started=true;}
        c.lineTo(X(b.x),Z(b.z));
      }
      c.lineJoin=c.lineCap='round'; c.strokeStyle='#173a39'; c.lineWidth=7*unit;c.stroke();
      c.strokeStyle=this.colour || '#5df4c2';c.lineWidth=4*unit;c.stroke();
    }
    const x=X(this.pin.x),z=Z(this.pin.z);
    c.translate(x,z);c.scale(unit,unit);c.fillStyle='#ff785d';c.strokeStyle='#31241e';c.lineWidth=2;
    c.beginPath();c.moveTo(0,0);c.bezierCurveTo(-2,-4,-9,-9,-9,-14);c.arc(0,-14,9,Math.PI,0);c.bezierCurveTo(9,-9,2,-4,0,0);c.fill();c.stroke();
    c.fillStyle='#fff6dc';c.beginPath();c.arc(0,-14,3,0,Math.PI*2);c.fill();c.restore();
  }
}
