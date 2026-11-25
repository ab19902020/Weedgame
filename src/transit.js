import {PassengerCabin} from './passengerCabin.js';
import * as THREE from 'three/webgpu';
import {People} from './characters.js';
import {CAR_L} from './trains.js';

// Passenger journeys. Rail: the trains of trains.js on the lines passengers can ride stop at the platforms of
// stations.js; standing on a platform while a train has its doors open there, Board gets you on, and you
// ride inside one of its cars (drawn as a passenger car up close) until you ask for the next stop or it
// reaches the end of the line. Buses: board at a stop the bus is serving, ride until you request a stop.
const RAIL_NEAR = 240;   // trains this close to the player are drawn as passenger cars (with doors)
export class Transit {
  constructor(G){
    this.G=G;this.ride=null;this.request=false;this.seq=0;
    this.services=new Map();
    for(const r of G.buses.routes)for(let k=0;k<r.stops.length-1;k++){
      const si=r.stops[k].si;
      if(!this.services.has(si))this.services.set(si,[]);
      this.services.get(si).push({r,k});
    }
    this.busCabins=new Map();this.railCabins=new Map();this.cars=[];this.seat=0;this.tmp=new Float64Array(6);
  }
  get stations(){return this.G.stations?.list||[];}
  get people(){return this.G.stations?this.G.stations.people():[];}
  // a few passengers already seated in each train (fixed per train)
  railRiders(tr){
    if(!tr.riders){let h=0;for(const ch of tr.id)h=(h*31+ch.charCodeAt(0))>>>0;const rand=()=>((h=(h*1664525+1013904223)>>>0)/4294967296);
      tr.riders=Array.from({length:tr.line.cars},()=>Array.from({length:Math.floor(rand()*7)},()=>({look:People.randomLook(rand)})));}
    return tr.riders;
  }
  syncCabins(dt){
    const G=this.G,me=G.brothers.me,seen=new Set();
    for(const b of G.traffic.list){
      if(b.hidden || !['bus','busS'].includes(b.model) || (b!==this.ride && Math.hypot(b.x-me.x,b.z-me.z)>50))continue;
      seen.add(b);let c=this.busCabins.get(b);
      if(!c){c=new PassengerCabin(b.model,b.paint);G.scene.add(c);this.busCabins.set(b,c);}
      const r=b.busData,stops=G.net.busStops;
      const next=r?.stops[b.nextStop+(b.served?1:0)],last=r?.stops.at(-1);
      c.frontSign.write('BUS  '+(b.ref||''),last?stops[last.si][2]:'Out of service');
      c.insideSign.write('NEXT STOP',next?stops[next.si][2]:'Terminus');
      b.hasCabin=true;c.position.set(b.x,b.y,b.z);c.rotation.set(b.roll||0,-b.heading,b.pitch||0,'YXZ');c.passengers(b.passengers||[]);c.doorState(b.served && b.v<.3,dt);
    }
    for(const [b,c] of this.busCabins)if(!seen.has(b)){b.hasCabin=false;G.scene.remove(c);c.dispose();this.busCabins.delete(b);}
    this.syncTrains(dt);
  }
  // trains near the player (and the one being ridden) as passenger cars on their running track
  syncTrains(dt){
    const G=this.G,T=G.trains,S=G.stations;if(!T?.ready)return;
    const me=G.brothers.me,cam=G.camera.position,keep=new Set(),t=this.tmp;
    for(const tr of T.trains){
      if(!tr.line.board && tr!==this.train)continue;
      const L=tr.line,mid=T.track(L,tr.s-tr.dir*L.Lt/2,tr.dir,t);
      if(tr!==this.train && Math.hypot(mid[0]-cam.x,mid[2]-cam.z)>RAIL_NEAR && Math.hypot(mid[0]-me.x,mid[2]-me.z)>RAIL_NEAR)continue;
      if(tr!==this.train && !G.tiles.tileAt(mid[0],mid[2]))continue;
      keep.add(tr);
      let cars=this.railCabins.get(tr);
      if(!cars){cars=Array.from({length:L.cars},()=>{const c=new PassengerCabin('rail',L.color);G.scene.add(c);return c;});this.railCabins.set(tr,cars);}
      const pl=S?.platformFor(tr),riders=this.railRiders(tr);
      cars.forEach((c,k)=>{
        const sc=T.carCentre(tr,k),p=T.track(L,sc,tr.dir,t),h=Math.hypot(p[3],p[5])||1;
        const heading=Math.atan2(p[5]*tr.dir,p[3]*tr.dir),pitch=Math.atan2(p[4]*tr.dir,h);
        c.position.set(p[0],p[1]+.16,p[2]);c.rotation.set(0,-heading,pitch,'YXZ');
        // doors on the platform side: the cabin's +z side is the right of its direction of travel
        c.doorState(!!pl,dt,pl?-pl.side*tr.dir:1);
        c.frontSign.write('SERVICE TO',S?S.destination(tr):'');c.insideSign.write('NEXT STATION',S?S.nextName(tr):'');
        c.passengers(riders[k]||[]);
      });
    }
    for(const [tr,cars] of this.railCabins)if(!keep.has(tr)){for(const c of cars){G.scene.remove(c);c.dispose();}this.railCabins.delete(tr);}
    T.hide=keep;
    this.cars=this.train?this.railCabins.get(this.train)||[]:[];
  }
  riderView(dt,look){
    const rail=this.ride===this, c=rail?this.cars[this.seat]:this.busCabins.get(this.ride);
    if(!c)return;
    const {L,floor,double}=c.layout,axis=this.G.input.axis();
    this.viewYaw-=look.dx*.005;this.viewPitch=Math.max(-1,Math.min(1,this.viewPitch-look.dy*.005));
    this.aisle=Math.max(-L/2+.65,Math.min(L/2-.55,this.aisle-axis.y*Math.cos(this.viewYaw)*dt*1.9));
    if(double && this.aisle>L/2-.65 && !this.stairLatch){this.upper=!this.upper;this.stairLatch=true;}
    if(this.aisle<L/2-2)this.stairLatch=false;
    const stair=double?Math.max(0,Math.min(1,(this.aisle-(L/2-2))/1.45)):0;
    const base=double && this.upper?2.37:floor+stair*(2.37-floor);
    const eye=new THREE.Vector3(this.aisle,base+1.38,0),target=eye.clone().add(new THREE.Vector3(Math.cos(this.viewYaw)*Math.cos(this.viewPitch),Math.sin(this.viewPitch),-Math.sin(this.viewYaw)*Math.cos(this.viewPitch)));
    const camera=this.G.camera;camera.position.copy(c.localToWorld(eye));camera.lookAt(c.localToWorld(target));
  }
  nearby(me){
    if(me.vehicle)return null;
    const pl=this.platform(me);
    if(pl){const tr=this.G.stations.trainAt(pl);if(tr){this.boardTrain=tr;return this;}return null;}
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
    const T=this.G.trains;if(!T?.ready)return;
    c.save();c.strokeStyle='#50455f';c.lineWidth=2;c.setLineDash([5,3]);
    for(const L of T.lines){if(!L.board)continue;c.beginPath();for(let i=0;i<L.n;i++){const x=X(L.P[i*3]),z=Z(L.P[i*3+2]);i?c.lineTo(x,z):c.moveTo(x,z);}c.stroke();}
    c.setLineDash([]);c.font='bold 11px system-ui';c.textAlign='left';
    for(const st of this.stations){
      const x=X(st.x),z=Z(st.z);c.fillStyle='#453957';c.fillRect(x-5,z-5,10,10);c.fillStyle='white';c.fillRect(x-2,z-2,4,4);
      if(scale>.12){c.strokeStyle='white';c.lineWidth=3;c.strokeText(st.name,x+8,z+4);c.fillStyle='#352b45';c.fillText(st.name,x+8,z+4);}
    }
    if(scale>.8)for(const [si] of this.services){const [x,z]=this.G.net.busStops[si];c.fillStyle='#18687b';c.fillRect(X(x)-2,Z(z)-2,5,5);}
    c.restore();
  }
  platform(me){
    return me.vehicle?null:this.G.stations?.platformAt(me.x,me.z,me.y)||null;
  }
  currentStop(){
    if(this.ride===this){
      const pl=this.G.stations?.platformFor(this.train);if(!pl)return null;
      const q=this.G.stations.beside(pl,this.x,this.z);return {x:q[0],z:q[2],y:q[1],name:pl.name};
    }
    const b=this.ride;if(!b?.served||!b.busData)return null;
    const st=this.G.net.busStops[b.busData.stops[b.nextStop]?.si];return st?{x:st[0],z:st[1],y:b.y,name:st[2]}:null;
  }
  nextName(){
    if(this.ride===this)return this.G.stations.nextName(this.train);
    const b=this.ride,stop=b?.busData?.stops[b.nextStop+(b.served?1:0)];
    return stop ? this.G.net.busStops[stop.si][2]||'Bus stop' : 'Terminus';
  }
  update(dt){
    const G=this.G,B=G.brothers,me=B.me,I=G.input;
    G.stations?.update(dt,me);
    const candidate=this.ride||this.nearby(me);
    if(!candidate && I.pressed.has('use') && (this.platform(me)||this.busStop(me)) && !B.nearestVehicle()) I.consume('use');
    if(candidate && I.consume('use')){
      if(this.ride)this.request=true;
      else {
        this.aisle=-1;this.viewYaw=.12;this.viewPitch=0;this.upper=false;this.stairLatch=false;this.ride=candidate;
        if(candidate===this){
          // sit in the car nearest where you got on
          const tr=this.train=this.boardTrain,T=G.trains;let best=0,bd=Infinity;
          for(let k=0;k<tr.line.cars;k++){const p=T.track(tr.line,T.carCentre(tr,k),tr.dir,this.tmp),d=Math.hypot(p[0]-me.x,p[2]-me.z);if(d<bd){bd=d;best=k;}}
          this.seat=best;this.moved=false;this.aisle=Math.max(-CAR_L/2+1,Math.min(CAR_L/2-1,0));this.x=me.x;this.z=me.z;this.y=me.y;this.heading=me.heading;this.syncTrains(0);
        }
        this.boarded=this.currentStop()?.name;this.lastText='';
      }
    }
    if(!this.ride)return false;
    const v=this.ride,rail=v===this;
    if(rail){
      // ride along in the seat's car
      const tr=this.train,T=G.trains,p=T.track(tr.line,T.carCentre(tr,this.seat),tr.dir,this.tmp);
      this.x=p[0];this.z=p[2];this.y=p[1]+.88;this.heading=Math.atan2(p[5]*tr.dir,p[3]*tr.dir);
      if(tr.status==='running')this.moved=true;
    }
    const stop=this.currentStop(),lastBusStop=!rail && v.busData && v.served && v.nextStop===v.busData.stops.length-1;
    const endOfLine=rail && this.moved && this.train.status==='terminus';
    if((this.request&&stop)||lastBusStop||endOfLine||(!rail&&!v.busData)){
      const dest=stop||v;me.x=dest.x;me.z=dest.z;me.y=rail?dest.y:(G.tiles.ground(dest.x,dest.z)??dest.y);
      this.ride=null;this.request=false;this.train=null;this.cars=[];G.hud.toast('Alighted · '+(dest.name||'Terminus'));return false;
    }
    I.consume('swap');I.consume('jump');I.consume('hit');I.consume('pickup');
    me.x=v.x;me.z=v.z;me.y=v.y;me.heading=v.heading;
    B.actor[B.active].visible=false;
    this.riderLook=I.takeLook();
    return true;
  }
}
