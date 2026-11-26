import * as THREE from 'three/webgpu';

const episodes=[
  ['Elon Gets Upgraded','Elon_Gets_Upgraded_1080p'],
  ['Interdimensional Cable','Interdimensional_Cable_South_Park_1080p'],
  ['Make America Cartman Again','Make_America_Cartman_Again_1080p'],
  ['Cancel Anytime','Cancel_Anytime_1080p'],['Drain the Swamp','Drain_the_Swamp_1080p'],
  ['Midterm Meltdown','Midterm_Meltdown_1080p'],['Couples Counseling','Couples_Counseling_1080p'],
  ['Player Owned','Player_Owned_Episode_1080p'],['Roads Are Optional','Roads_Are_Optional_1080p'],['Free Ride','free_ride']
];
export class HomeTV {
  constructor(interiors){this.interiors=interiors;this.generation=0;}
  sit(room){
    if(this.seated)return;
    const G=this.interiors.G,B=G.brothers,sofa=room.plan.items.find(i=>i.type.startsWith('sofa'));
    const tv=room.plan.items.find(i=>i.type==='tv');
    if(!sofa||!tv)return;
    this.room=room;this.seated=true;this.exitPoint=[B.me.x,B.me.y,B.me.z,B.me.heading];
    const world=(it)=>this.interiors.toWorld(room.site,it.x,it.y);
    const [x,z]=world(sofa),[tx,tz]=world(tv);
    Object.assign(B.me,{x,z,y:room.floor0,heading:Math.atan2(tz-z,tx-x)});
    B.vel.x=B.vel.z=B.speedNow=0;
    this.cameraTarget=[tx,room.floor0+tv.base+.1+tv.h/2,tz];
    this.panel=document.createElement('section');this.panel.id='homeTV';this.panel.ariaLabel='Living room television';
    this.panel.addEventListener('pointerdown',e=>e.stopPropagation());
    document.body.append(this.panel);
    this.off();
  }
  updateSeat(dt){
    const G=this.interiors.G,B=G.brothers,a=B.actor[B.active],p=B.me;
    Object.assign(a,{x:p.x,z:p.z,y:p.y,heading:p.heading,running:false,speed:0,speedNow:0,gaitSpeed:0,pose:'seated',visible:true});
    a.t+=dt;
    const side=p.heading+Math.PI/2;
    G.camera.position.set(p.x-.33*Math.cos(p.heading)+.43*Math.cos(side),p.y+1.23,p.z-.33*Math.sin(p.heading)+.43*Math.sin(side));
    G.camera.lookAt(...this.cameraTarget);
    G.input.pressed.clear();
  }
  clear(){
    this.generation++;
    if(this.video){this.video.pause();this.video.removeAttribute('src');this.video.load();this.video=null;}
    if(this.screen){this.screen.removeFromParent();this.screen.material.map.dispose();this.screen.material.dispose();this.screen.geometry.dispose();this.screen=null;}
    this.panel.replaceChildren();this.panel.classList.remove('playing');
  }
  button(label,fn){
    const b=document.createElement('button');b.textContent=label;b.onclick=fn;this.panel.append(b);return b;
  }
  off(){
    this.clear();this.button('Turn TV on',()=>this.menu());this.button('Stand up',()=>this.stand());
  }
  menu(){
    this.clear();this.button('Episodes',()=>this.channels());this.button('Games console',()=>this.consoleMenu());
    this.button('Turn TV off',()=>this.off());this.button('Stand up',()=>this.stand());
  }
  channels(){
    this.clear();episodes.forEach(([title],i)=>this.button(title,()=>this.play(i)));
    this.button('Back',()=>this.menu());
  }
  play(i){
    this.clear();const [title,file]=episodes[i],v=document.createElement('video');this.video=v;
    v.playsInline=true;v.preload='metadata';v.src='assets/home/episodes/'+file+'.mp4';
    const tex=new THREE.VideoTexture(v);tex.colorSpace=THREE.SRGBColorSpace;
    const tv=this.room.plan.items.find(it=>it.type==='tv'),screen=new THREE.Mesh(new THREE.PlaneGeometry(tv.w-.06,tv.h-.045),new THREE.MeshBasicMaterial({map:tex,toneMapped:false,side:THREE.DoubleSide}));
    screen.rotation.y=-tv.rot;screen.position.set(tv.x-.042*Math.sin(tv.rot),tv.base+.1+tv.h*.5,tv.y+.042*Math.cos(tv.rot));
    this.room.group.add(screen);this.screen=screen;
    const pause=this.button('Pause',()=>{if(v.paused)v.play().catch(()=>{});else v.pause();});
    v.onpause=()=>pause.textContent='Play';v.onplay=()=>pause.textContent='Pause';
    const next=()=>this.play((i+1)%episodes.length);
    v.onended=next;v.onerror=()=>{if(this.video===v)pause.textContent=title+' unavailable';};
    this.button('Next episode',next);this.button('TV menu',()=>this.menu());v.play().catch(()=>{pause.textContent='Play';});
  }
  consoleMenu(){
    this.clear();this.button('Narco Lord',()=>this.game('narco'));this.button('The Results Business',()=>this.game('results'));
    this.button('TV menu',()=>this.menu());
  }
  async game(id){
    this.clear();this.panel.classList.add('playing');const generation=this.generation;
    this.button('Return to console',()=>this.consoleMenu());
    try{
      const res=await fetch('assets/home/'+id+'.html.gz');if(!res.ok)throw Error();
      const html=await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).text();
      if(this.generation!==generation)return;
      const frame=document.createElement('iframe');frame.title=id==='narco'?'Narco Lord':'The Results Business';
      frame.srcdoc=html;this.panel.append(frame);
    }catch{if(this.generation===generation)this.button('Retry game',()=>this.game(id));}
  }
  stand(){
    this.clear();this.panel.remove();this.seated=false;
    const B=this.interiors.G.brothers;[B.me.x,B.me.y,B.me.z,B.me.heading]=this.exitPoint;
    this.interiors.G.input.pressed.clear();this.room=null;
  }
}
