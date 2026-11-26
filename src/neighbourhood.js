import * as THREE from 'three/webgpu';
import {People} from './characters.js';

function actor(id,top,x,y,z){
  return {id,x,y,z,heading:0,look:{...People.randomLook(),top},speed:0,t:0,phase:0,visible:true};
}
export class Neighbourhood {
  constructor(G){
    this.G=G;this.cooldown=65+Math.random()*90;this.social=4;this.check=0;this.actors=[];this.elapsed=0;
    this.calls=[];
    this.nextFire=1200+Math.random()*1200;
    const mesh=(geometry,colour)=>new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:colour}));
    this.ball=mesh(new THREE.SphereGeometry(.13,10,8),0xf3ead3);
    this.fire=new THREE.Group();
    for(let k=0;k<5;k++){
      const flame=mesh(new THREE.ConeGeometry(.3+k*.04,1.1,7),k%2?0xffd248:0xf35e2e);
      flame.position.set(Math.sin(k)*.6,.5,Math.cos(k)*.45);this.fire.add(flame);
    }
    for(let k=0;k<5;k++)this.fire.add(mesh(new THREE.IcosahedronGeometry(.55,0),0x575552));
    G.scene.add(this.fire,this.ball);this.fire.visible=this.ball.visible=false;
  }
  pitch(f){
    const tiles=this.G.tiles;
    for(const t of tiles.tiles.values()){
      if(t.lod!==0||Math.hypot(t.data.ox+128-f.x,t.data.oz+128-f.z)>350)continue;
      for(let z=8;z<248;z+=12)for(let x=8;x<248;x+=12){
        const X=t.data.ox+x,Z=t.data.oz+z;
        if(tiles.landcover(X,Z)!==13)continue;
        if([[-9,-6],[9,-6],[-9,6],[9,6]].every(([a,b])=>tiles.landcover(X+a,Z+b)===13))return {x:X,z:Z};
      }
    }
  }
  football(dt){
    const G=this.G, f=G.focus;
    if(this.field && (Math.hypot(f.x-this.field.x,f.z-this.field.z)>330||G.world.hours()>21||G.world.hours()<7)){
      this.field=null;this.team=[];this.ball.visible=false;
    }
    if(!this.field && this.check<=0 && G.world.hours()>=7 && G.world.hours()<21){
      this.field=this.pitch(f);
      if(this.field){const {x,z}=this.field;this.team=Array.from({length:6},(_,k)=>actor('football-'+k,k%2?0xb44b39:0x315d90,x+(k%3-1)*5,G.tiles.terrain(x,z)||0,z+(k<3?-3:3)));this.ball.visible=true;this.play=0;this.touch=0;this.score=[0,0];}
    }
    if(!this.field)return;
    this.play+=dt;const phase=Math.floor(this.play/2.8),u=this.play/2.8-phase;
    this.team.forEach((p,k)=>{
      const x=this.field.x+(k%3-1)*5+Math.sin(this.play*.75+k)*1.5,z=this.field.z+(k<3?-3:3)+Math.cos(this.play*.65+k)*1.2;
      const d=Math.hypot(x-f.x,z-f.z),avoid=d<2?2-d:0;
      p.x=x+avoid*(x-f.x)/(d||1);p.z=z+avoid*(z-f.z)/(d||1);p.y=G.tiles.terrain(p.x,p.z)??p.y;
      p.phase+=dt*4;p.t+=dt;p.speed=1.4;p.heading=Math.atan2(this.ball.position.z-p.z,this.ball.position.x-p.x);
    });
    const order=[0,4,2,3,1,5],a=this.team[order[phase%6]],b=this.team[order[(phase+1)%6]];
    const shot=phase%9===8,side=Math.floor(phase/9)%2?1:-1;
    const endX=shot?this.field.x+side*8:b.x,endZ=shot?this.field.z:b.z;
    if(this.lastPhase!==phase && phase>0 && (phase-1)%9===8){
      this.score[side>0?0:1]++;this.team.forEach(p=>{p.pose='wave';});
    } else if(u>.3)this.team.forEach(p=>{p.pose='walk';});
    this.lastPhase=phase;
    if(this.touch>0){
      this.touch-=dt;this.ball.position.x+=this.touchX*dt;this.ball.position.z+=this.touchZ*dt;
      this.ball.position.y=(G.tiles.terrain(this.ball.position.x,this.ball.position.z)??a.y)+.14;
      if(this.touch<=0){
        const nearest=this.team.reduce((best,p)=>Math.hypot(p.x-this.ball.position.x,p.z-this.ball.position.z)<Math.hypot(best.x-this.ball.position.x,best.z-this.ball.position.z)?p:best);
        nearest.x=this.ball.position.x;nearest.z=this.ball.position.z;this.play=(phase-phase%6+order.indexOf(this.team.indexOf(nearest)))*2.8;
      }
    }else{
      this.ball.position.set(a.x+(endX-a.x)*u,a.y+(b.y-a.y)*u+.15+.55*Math.sin(Math.PI*u),a.z+(endZ-a.z)*u);
      const me=G.brothers.me;
      if(!me.vehicle && Math.hypot(me.x-this.ball.position.x,me.z-this.ball.position.z)<.7 && G.brothers.speedNow>.4){
        this.touch=.75;this.touchX=Math.cos(me.heading)*3.4;this.touchZ=Math.sin(me.heading)*3.4;
      }
    }
  }
  robbery(){
    const G=this.G, civilians=G.peds.near(G.focus.x,G.focus.z,155).filter(p=>!p.officer&&p.mode==='walk'&&!p.leader);
    for(const victim of civilians.filter(p=>p.look.bag)){
      const thief=civilians.find(p=>p!==victim&&!p.look.bag&&Math.hypot(p.x-victim.x,p.z-victim.z)<2.4);
      if(!thief)continue;
      G.police.createIncident('theft',victim.x,victim.z,[],{label:'Reported bag snatch'});
      victim.look.bag=false;thief.look.bag=true;victim.reactT=0;victim.phoneT=12;
      thief.reactT=0;thief.phoneT=0;thief.hurryUntil=thief.t+16;thief.leader=null;
      return true;
    }
    return false;
  }
  sendCrew(service,x,z,reason,incident){
    const G=this.G,net=G.net;
    const snap=net.nearest(x,z,45,e=>net.flags[e]&16);
    if(!snap)return false;
    for(const last of [snap.e*2,snap.e*2+1]){
      if(!net.outD[net.startNode(last)].includes(last))continue;
      const route=[last],seen=new Set([snap.e]);let length=0;
      while(length<230){
        const h=net.inD[net.startNode(route[0])].find(edge=>!seen.has(edge>>1));
        if(h==null)break;
        seen.add(h>>1);route.unshift(h);length+=net.len[h>>1];
      }
      if(length<65)continue;
      const medic=service==='ambulance';
      const unit=G.traffic.spawnAt(route[0],0,{kind:service,model:service,paint:medic?0xe9ee77:0xac221e,route,v:0});
      Object.assign(unit,{siren:true,status:'responding',target:{x,z}});
      this.calls.push({unit,service,reason,incident,x,z,time:0,worked:0});
      G.hud.feed((medic?'Ambulance':'Fire crew')+' responding · '+reason);return true;
    }
    return false;
  }
  startFire(){
    if(this.calls.some(c=>c.service==='fire'))return false;
    const G=this.G;
    for(const car of G.traffic.list){
      if(car.kind!=='parked'||car.owner||car.free||car.player||Math.hypot(car.x-G.focus.x,car.z-G.focus.z)>160)continue;
      if(!this.sendCrew('fire',car.x,car.z,'vehicle fire',null))continue;
      this.fire.position.set(car.x,car.y+.65,car.z);this.fire.scale.setScalar(1);this.fire.visible=true;
      return true;
    }
    return false;
  }
  dispatchInjuries(dt){
    for(const inc of this.G.police.incidents){
      if(!inc.injury || inc.status==='new' || inc.medicalClosed)continue;
      inc.responseAge=(inc.responseAge||0)+dt;
      if(inc.responseAge>=240 || inc.status==='cleared'){
        if(!inc.medicalSent && inc.patient)inc.patient.awaitingMedic=false;
        inc.medicalClosed=true;continue;
      }
      if(inc.retryAfter>inc.responseAge)continue;
      inc.retryAfter=inc.responseAge+8;
      if(!inc.medicalSent && this.calls.filter(c=>c.service==='ambulance').length<2){
        inc.medicalSent=this.sendCrew('ambulance',inc.x,inc.z,'reported injury',inc);
      }
      if(inc.trapped && !inc.rescueSent && !this.calls.some(c=>c.service==='fire')){
        inc.rescueSent=this.sendCrew('fire',inc.x,inc.z,'trapped occupant',inc);
      }
    }
  }
  response(dt){
    const G=this.G;
    for(let i=this.calls.length-1;i>=0;i--){
      const s=this.calls[i],v=s.unit,medic=s.service==='ambulance',fire=s.reason==='vehicle fire';
      const patient=medic?s.incident?.patient:null;
      const x=patient?.x??s.x,z=patient?.z??s.z;
      s.time+=dt;
      const distance=Math.hypot(v.x-x,v.z-z);
      if(!s.crew && !v.player && (distance<30 || (distance<85 && v.wait>6))){
        Object.assign(v,{occupied:true,parked:true,v:0,siren:false,lightsOnly:true,target:null,status:'onscene'});
        s.crew=[-1,1].map((side,k)=>actor(v.id+'-crew-'+k,medic?0x22674e:0xc79845,
          v.x-Math.sin(v.heading)*side*(v.def.W/2+.35),v.y,v.z+Math.cos(v.heading)*side*(v.def.W/2+.35)));
        G.hud.feed(medic?'Paramedics on scene':'Fire crew on scene');
      }
      if(s.crew){
        for(const [k,p] of s.crew.entries()){
          const dx=(s.returning?v.x:x)+(s.returning?0:medic?.8:2.5)-p.x;
          const dz=(s.returning?v.z:z)+(k?1:-1)*.75-p.z,d=Math.hypot(dx,dz);
          p.heading=Math.atan2(dz,dx);p.speed=d>.65?1.8:0;p.phase+=dt*p.speed*3;
          p.x+=dx/(d||1)*Math.min(d,p.speed*dt);p.z+=dz/(d||1)*Math.min(d,p.speed*dt);
          p.y=G.tiles.ground(p.x,p.z)??p.y;p.pose=p.speed?'walk':medic?'brace':'point';
        }
        if(s.crew.every(p=>!p.speed)){
          if(s.returning)s.finished=true;
          else if((s.worked+=dt)>=(medic?30:22)){
            if(patient)patient.awaitingMedic=false;
            s.returning=true;
          }
        }
      }
      if(fire){
        for(let k=0;k<10;k++){const p=this.fire.children[k];if(k<5)p.scale.y=1+.3*Math.sin(s.time*8+k);else{const u=(s.time*.25+k*.21)%1;p.position.set(u*.9,1+u*4,Math.sin(k)*.3);p.scale.setScalar(.4+u);}}
        this.fire.scale.setScalar(Math.max(.01,1-s.worked/22));
      }
      if(s.finished||v.player||v.dead||s.time>420){
        if(patient)patient.awaitingMedic=false;
        if(fire)this.fire.visible=false;
        Object.assign(v,{parked:false,target:null,siren:false,lightsOnly:false,occupied:false,status:'returning',retiredCrew:true});
        this.calls.splice(i,1);
      }
    }
  }
  commuter(){
    const G=this.G, net=G.net;
    for(const v of G.traffic.list){
      if(!v.errand || v.player)continue;
      if(v.parked){if(Math.hypot(v.x-G.focus.x,v.z-G.focus.z)>320)G.traffic.remove(v);continue;}
      const trip=v.errand;
      if(v.h!==trip.h || Math.abs(v.s-trip.s)>9 || Math.hypot(v.x-trip.x,v.z-trip.z)>13)continue;
      if(G.parking.blocked(trip.x,trip.z)){v.errand=null;continue;}
      v.parked=true;v.v=0;v.x=trip.x;v.z=trip.z;v.y=G.tiles.ground(v.x,v.z)??v.y;v.heading=trip.heading;
      const w=net.nearest(v.x,v.z,30,e=>net.walkable(e));
      if(w){const p=actor('p'+G.peds.nextId++,0x515868,w.x,v.y,w.z);
        Object.assign(p,{h:w.e*2,s:w.s,sideSign:w.side||1,lane:0,speed:1.35,alpha:1,mode:'walk'});
        p[trip.site.kind+'Site']=trip.site;G.peds.list.push(p);G.peds.planDay(p);
      }
    }
    if(this.commuteAfter>this.elapsed)return;
    this.commuteAfter=this.elapsed+12;
    const driver=G.traffic.list.find(v=>v.kind==='traffic'&&!v.player&&!v.parked&&!v.errand&&!v.crashed);
    if(!driver)return;
    const hour=G.world.hours(),kind=hour<7||hour>=18?'home':hour>=12&&hour<14?'shop':'work';
    for(const tile of G.tiles.tiles.values()){
      const slots=tile.data.slots;if(!slots?.length)continue;
      const site=tile.data.buildings.destinations?.find(p=>p.kind===kind);
      if(!site)continue;
      for(let i=0;i<slots.length;i+=4){
        const x=slots[i]+tile.data.ox,z=slots[i+2]+tile.data.oz;
        if(Math.hypot(x-site.x,z-site.z)>85||G.parking.blocked(x,z))continue;
        const road=net.nearest(x,z,9,e=>net.flags[e]&16);if(!road)continue;
        const h=road.e*2,path=net.route(net.endNode(driver.h),net.startNode(h),{limit:2500});
        if(!path)continue;
        driver.route=[driver.h,...path,h];driver.ri=0;driver.dest=net.endNode(h);
        driver.errand={h,s:road.s,x,z,heading:slots[i+3],site};return;
      }
    }
  }
  update(dt){
    this.elapsed+=dt;this.check-=dt;this.cooldown-=dt;
    this.football(dt);if(this.check<=0)this.check=5;
    this.social-=dt;
    if(this.social<=0){
      this.social=6+Math.random()*18;
      const walkers=this.G.peds.near(this.G.focus.x,this.G.focus.z,130).filter(p=>!p.officer && p.mode==='walk' && !p.leader && !p.phoneT && !(p.socialAfter>p.t) && !(p.hurryUntil>p.t));
      for(const a of walkers){
        const b=walkers.find(b=>b!==a && (b.h>>1)===(a.h>>1) && Math.hypot(b.x-a.x,b.z-a.z)<2.8);
        if(!b)continue;
        const duration=3+Math.random()*8;
        for(const [p,other] of [[a,b],[b,a]]){
          p.mode='greeting';p.partner=other;p.timer=duration;p.socialAfter=p.t+90;
        }
        break;
      }
    }
    if(this.cooldown<=0){
      this.robbery();this.cooldown=240+Math.random()*480;
    }
    if(this.elapsed>=this.nextFire){
      this.nextFire=this.elapsed+1200+Math.random()*1200;
      if(!this.G.police.incidents.some(i=>i.status!=='cleared'))this.startFire();
    }
    this.dispatchInjuries(dt);this.response(dt);
    this.commuter();
    this.actors=[...(this.team||[]),...this.calls.flatMap(c=>c.crew||[])];
  }
}
