import * as THREE from 'three/webgpu';
import {People} from './characters.js';
import line from './railLine.json';

const distances=[0];
for(let i=1;i<line.points.length;i++){
  const a=line.points[i-1],b=line.points[i];
  distances.push(distances[i-1]+Math.hypot(b[0]-a[0],b[2]-a[2]));
}
function position(s){
  let lo=0,hi=distances.length-1;
  while(hi-lo>1){const mid=(lo+hi)>>1;if(distances[mid]<=s)lo=mid;else hi=mid;}
  const a=line.points[lo],b=line.points[hi],t=Math.max(0,Math.min(1,(s-distances[lo])/(distances[hi]-distances[lo])));
  return {x:a[0]+(b[0]-a[0])*t,y:a[1]+(b[1]-a[1])*t,z:a[2]+(b[2]-a[2])*t,heading:Math.atan2(b[2]-a[2],b[0]-a[0])};
}
function box(parent,l,h,w,x,y,z,colour){
  const m=new THREE.Mesh(new THREE.BoxGeometry(l,h,w),new THREE.MeshStandardMaterial({color:colour}));
  m.position.set(x,y,z);parent.add(m);return m;
}
function carriage(){
  const g=new THREE.Group();
  box(g,18,2.8,2.7,0,2.03,0,0xd6d7ce);
  box(g,17.8,.45,2.65,0,3.55,0,0x68757c);
  box(g,17,.55,2.05,0,.53,0,0x313b42);
  for(const side of [-1,1]){
    box(g,.14,2.35,2.65,side*9,2.05,0,0xeeb536);
    box(g,.17,.91,2.1,side*9,2.55,0,0x263947);
    box(g,17.8,.24,.04,0,1.06,side*1.36,0x347e90);
    for(let i=-3;i<=3;i++)box(g,1.4,.85,.05,i*2.35,2.52,side*1.36,0x314654);
    for(const x of [-5.9,5.9])box(g,1.05,2.15,.07,x,1.86,side*1.37,0x276e81);
  }return g;
}
export class Transit {
  constructor(G){
    this.G=G;this.ride=null;this.request=false;this.people=[];this.seq=0;
    this.stations=line.calls.map((c,i)=>{
      const s=distances[c.i],p=position(s),nx=-Math.sin(p.heading),nz=Math.cos(p.heading);
      const st={...p,name:c.name,s,x:p.x+nx*3.4,z:p.z+nz*3.4,index:i};
      const platform=new THREE.Group();platform.position.set(st.x,st.y,st.z);platform.rotation.y=-p.heading;
      box(platform,42,.55,2.8,0,.27,0,0x878880);
      box(platform,41,.015,.14,0,.56,-1.07,0xe6c969);
      G.scene.add(platform);return st;
    });
    this.services=new Map();
    for(const r of G.buses.routes)for(let k=0;k<r.stops.length-1;k++){
      const si=r.stops[k].si;
      if(!this.services.has(si))this.services.set(si,[]);
      this.services.get(si).push({r,k});
    }
    this.cars=[carriage(),carriage()];for(const car of this.cars)G.scene.add(car);
    this.index=0;this.dir=1;this.at=0;this.s=0;this.elapsed=0;this.dwell=24;
    this.seedQueue(0);this.exchange(0);this.place();
  }
  seedQueue(i){
    if(this.people.some(p=>p.wait===i))return;
    const st=this.stations[i];
    for(let k=0;k<3;k++)this.people.push({id:'rail-passenger-'+this.seq++,wait:i,x:st.x+Math.cos(st.heading)*(k-1)*1.5,z:st.z+Math.sin(st.heading)*(k-1)*1.5,y:st.y+.56,look:People.randomLook(),heading:st.heading-Math.PI/2,visible:true,speed:0,t:0});
  }
  exchange(i){
    const st=this.stations[i];
    for(const p of this.people){
      if(p.destination===i){p.destination=null;p.leave=7;p.visible=true;p.x=st.x;p.z=st.z;p.y=st.y+.56;p.heading=st.heading;p.speed=1.2;}
      else if(p.wait===i){p.wait=null;p.destination=i+this.dir;p.visible=false;}
    }
  }
  place(){
    const centre=position(this.s);Object.assign(this,centre);
    for(let i=0;i<2;i++){
      const p=position(this.s+(i?9.2:-9.2));this.cars[i].position.set(p.x,p.y+.16,p.z);this.cars[i].rotation.y=-p.heading;
    }
  }
  tick(dt){
    for(const p of this.people)if(p.leave>0){p.leave-=dt;p.x+=Math.cos(p.heading)*dt*1.2;p.z+=Math.sin(p.heading)*dt*1.2;p.phase=(p.phase||0)+dt*4;if(p.leave<=0)p.visible=false;}
    this.people=this.people.filter(p=>p.visible||p.destination!=null);
    if(this.dwell>0){this.dwell-=dt;if(this.dwell<=0){this.at=null;this.elapsed=0;this.seedQueue(this.index+this.dir);}return;}
    this.elapsed+=dt;
    const next=this.index+this.dir,a=this.stations[this.index],b=this.stations[next];
    const seconds=[310,155,90,225][Math.min(next,this.index)],u=Math.min(1,this.elapsed/seconds);
    // Acceleration and braking occupy the first and last tenth of each run.
    const fraction=u<.1?5*u*u/.9:u>.9?1-5*(1-u)**2/.9:(u-.05)/.9;
    this.s=a.s+(b.s-a.s)*fraction;this.place();
    if(u===1){this.at=this.index=next;if(!next||next===this.stations.length-1)this.dir*=-1;this.dwell=next===0||next===this.stations.length-1?72:24;this.exchange(next);}
  }
  nearby(me){
    if(me.vehicle)return null;
    if(this.at!=null && this.dwell>0 && this.platform(me)?.index===this.at && Math.abs(me.y-this.y)<3)return this;
    return this.G.traffic.list.find(v=>{
      if(!v.busData || !v.served || Math.abs(v.v)>.3 || v.nextStop+1>=v.busData.stops.length)return false;
      const st=this.G.net.busStops[v.busData.stops[v.nextStop].si];
      return Math.hypot(me.x-st[0],me.z-st[1])<7 && Math.hypot(me.x-v.x,me.z-v.z)<10 && Math.abs(me.y-v.y)<3;
    });
  }
  busStop(me){
    if(me.vehicle)return null;
    if(this.stopCache && Math.hypot(me.x-this.stopCache.x,me.z-this.stopCache.z)<.8)return this.stopCache.stop;
    let stop=null,best=7;
    for(const [si,calls] of this.services){
      const [x,z,name]=this.G.net.busStops[si],d=Math.hypot(x-me.x,z-me.z);
      if(d<best){best=d;stop={si,calls,name};}
    }
    this.stopCache={x:me.x,z:me.z,stop};return stop;
  }
  drawMap(c,X,Z,scale){
    c.save();c.strokeStyle='#50455f';c.lineWidth=2;c.setLineDash([5,3]);c.beginPath();
    line.points.forEach(([x,,z],i)=>i?c.lineTo(X(x),Z(z)):c.moveTo(X(x),Z(z)));c.stroke();c.setLineDash([]);
    c.font='bold 11px system-ui';c.textAlign='left';
    for(const st of this.stations){
      const x=X(st.x),z=Z(st.z);c.fillStyle='#453957';c.fillRect(x-5,z-5,10,10);c.fillStyle='white';c.fillRect(x-2,z-2,4,4);
      if(scale>.12){c.strokeStyle='white';c.lineWidth=3;c.strokeText(st.name,x+8,z+4);c.fillStyle='#352b45';c.fillText(st.name,x+8,z+4);}
    }
    if(scale>.8)for(const [si] of this.services){const [x,z]=this.G.net.busStops[si];c.fillStyle='#18687b';c.fillRect(X(x)-2,Z(z)-2,5,5);}
    c.restore();
  }
  platform(me){
    return !me.vehicle && this.stations.find(s=>Math.hypot(me.x-s.x,me.z-s.z)<13);
  }
  currentStop(){
    if(this.ride===this)return this.at==null?null:this.stations[this.at];
    const b=this.ride;if(!b?.served||!b.busData)return null;
    const st=this.G.net.busStops[b.busData.stops[b.nextStop]?.si];return st?{x:st[0],z:st[1],y:b.y,name:st[2]}:null;
  }
  nextName(){
    if(this.ride===this)return this.stations[this.index+this.dir].name;
    const b=this.ride,stop=b?.busData?.stops[b.nextStop+(b.served?1:0)];
    return stop ? this.G.net.busStops[stop.si][2]||'Bus stop' : 'Terminus';
  }
  update(dt){
    this.tick(dt);
    const G=this.G,B=G.brothers,me=B.me,I=G.input;
    const candidate=this.ride||this.nearby(me);
    if(!candidate && I.pressed.has('use') && (this.platform(me)||this.busStop(me)) && !B.nearestVehicle()) I.consume('use');
    if(candidate && I.consume('use')){
      if(this.ride)this.request=true;
      else {this.ride=candidate;this.boarded=this.currentStop()?.name;this.lastText='';}
    }
    if(!this.ride)return false;
    const v=this.ride,stop=this.currentStop(),lastBusStop=v!==this && v.busData && v.served && v.nextStop===v.busData.stops.length-1;
    if((this.request&&stop)||lastBusStop|| (v!==this&&!v.busData)){
      const dest=stop||v;me.x=dest.x;me.z=dest.z;me.y=G.tiles.ground(dest.x,dest.z)??dest.y;
      this.ride=null;this.request=false;G.hud.toast('Alighted · '+(dest.name||'Terminus'));return false;
    }
    I.consume('swap');I.consume('jump');I.consume('hit');I.consume('pickup');
    me.x=v.x;me.z=v.z;me.y=v.y;me.heading=v.heading;
    B.actor[B.active].visible=false;
    const look=I.takeLook();B.cam.yaw+=look.dx*.006;B.cam.pitch=Math.max(.05,Math.min(1,B.cam.pitch+look.dy*.004));
    B.followCam(dt,v.x,v.y+2.2,v.z,v===this?13:9,null);
    const text=(v===this?'Rail':('Bus '+(v.ref||'')))+' · '+(stop?'At '+stop.name+' · ':'')+'Next stop: '+this.nextName()+(this.request?' · Stop requested':'');
    if(text!==this.lastText){G.hud.feed(text);this.lastText=text;}
    return true;
  }
}
