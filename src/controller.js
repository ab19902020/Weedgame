import { Mesh, BoxGeometry, MeshStandardMaterial } from 'three/webgpu';

export class Controller {
  constructor(G){this.G=G;this.previous=[];this.items=[];this.bags=[0,0];}
  poll(dt){
    const G=this.G,I=G.input,H=G.hud,M=H.menu;
    const pad=Array.from(navigator.getGamepads?.()||[]).find(p=>p?.mapping==='standard');
    const buttons=pad?.buttons.map(b=>b.pressed)||[],tap=n=>buttons[n]&&!this.previous[n];
    const axis=n=>{const x=pad?.axes[n]||0;return Math.sign(x)*Math.max(0,Math.abs(x)-.14)/.86;};
    const car=!!G.brothers.me.vehicle;
    I.padX=0;I.padY=0;I.padRun=false;I.padBrake=false;
    if(tap(9)||tap(16)){if(M.el.hidden)M.open();else M.close();}
    else if(!M.el.hidden || !H.el('map').hidden || !H.el('dev').hidden){
      const panel=!M.el.hidden?M.el:!H.el('map').hidden?H.el('map'):H.el('dev');
      const list=[...panel.querySelectorAll('button,select')].filter(e=>e.offsetWidth);
      const index=list.indexOf(document.activeElement);
      if(tap(12)||tap(13))list[(index+(tap(12)?-1:1)+list.length)%list.length]?.focus();
      const el=document.activeElement;
      if(el?.tagName==='SELECT'&&(tap(14)||tap(15))){
        el.selectedIndex=(el.selectedIndex+(tap(14)?-1:1)+el.length)%el.length;el.dispatchEvent(new Event('change'));
      }
      if(tap(0)) (list.includes(el)?el:list[0])?.click();
      if(tap(1)||tap(17)){if(!M.el.hidden){const back=M.el.querySelector('.preferences button');if(back.offsetWidth)back.click();else M.close();}else if(panel===H.el('map'))H.toggleMap(false);else H.toggleDev();}
      if(panel===H.el('map')){
        H.mapView.x+=axis(0)*dt*450/H.mapView.s;H.mapView.z+=axis(1)*dt*450/H.mapView.s;
        if(tap(4)||tap(5))H.zoomMap(tap(4)?.7:1.4);
        if(tap(3)){const {x,z}=H.mapView;H.nav.set({x,z,name:G.roadName(x,z)||'Dropped pin'});}
      }
    }else{
      I.padX=axis(0);I.padY=car?(pad?.buttons[6]?.value||0)-(pad?.buttons[7]?.value||0):axis(1);
      I.look.dx+=axis(2)*dt*260;I.look.dy+=axis(3)*dt*200;
      I.padRun=buttons[0]||buttons[10];I.padBrake=car&&(buttons[0]||buttons[2]||buttons[4]);
      if(tap(3))I.pressed.add('use');
      if(tap(8)||tap(17)||tap(12))H.toggleMap(true);
      if(tap(13))I.pressed.add('swap');
      if(tap(11))G.brothers.cam.yaw=G.brothers.me.heading+Math.PI;
      if(tap(14)||tap(15))G.brothers.cam.yaw+=(tap(14)?-1:1)*Math.PI/2;
      if(car){if(tap(10)||tap(1))I.pressed.add('horn');if(tap(5))I.pressed.add('camera');}
      else{
        if(tap(2))I.pressed.add('jump');
        if(tap(1)||tap(7))I.pressed.add('hit');
        if(tap(4)||tap(5))I.pressed.add('pickup');
        if(tap(6))H.toast('Carrying '+this.bags[G.brothers.active]+' parcels');
      }
    }
    this.previous=buttons;
  }
  actions(dt){
    const G=this.G,B=G.brothers,a=B.actor[B.active],me=B.me,I=G.input;
    if(!this.items.length && !G._needGround){
      const geo=new BoxGeometry(.36,.24,.28),mat=new MeshStandardMaterial({color:0xb38b5b});
      for(const offset of [1.6,3.2]){
        const box=new Mesh(geo,mat);box.position.set(me.x+offset,me.y+.12,me.z);G.scene.add(box);this.items.push(box);
      }
    }
    const jump=I.consume('jump'),hit=I.consume('hit'),pickup=I.consume('pickup');
    if(me.vehicle)return;
    if(jump && !(a.jumpTime>0))a.jumpTime=.68;
    if(a.jumpTime>0){a.jumpTime=Math.max(0,a.jumpTime-dt);const t=1-a.jumpTime/.68;a.y=me.y+3.2*t*(1-t);}
    if(hit && !(a.hitTime>0)){
      a.hitTime=.32;
      const target=G.peds.near(me.x,me.z,1.7).find(p=>Math.cos(me.heading)*(p.x-me.x)+Math.sin(me.heading)*(p.z-me.z)>0);
      if(target){target.fallT=2;G.peds.disturb(me.x,me.z,12,'hit');}
    }
    if(a.hitTime>0){a.hitTime-=dt;a.pose='point';}
    if(pickup){
      const item=this.items.find(o=>o.visible && Math.hypot(o.position.x-me.x,o.position.z-me.z)<2.3);
      if(item){item.visible=false;this.bags[B.active]++;}G.hud.toast(item?'Parcel picked up':'No parcel within reach');
    }
  }
}
