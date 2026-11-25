// A hollow shell and its furniture share a single vertex-colour geometry per model.
import {TransitSign} from './transitSign.js';
import * as T from 'three/webgpu';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
const cache=new Map(), material=new T.MeshStandardMaterial({vertexColors:true,roughness:.78,emissive:0x272a2a});
const glass=new T.MeshStandardMaterial({color:0xc3e4ec,transparent:true,opacity:.11,depthWrite:false,side:T.DoubleSide});
function layout(type){
  if(cache.has(type))return cache.get(type);
  const rail=type==='rail',double=type==='bus',L=rail?18:double?10.6:11.2,W=rail?2.7:2.5,H=rail?3.55:double?4.3:3.05,floor=rail?.72:.40;
  const parts=[],panes=[],paint=[],seats=[],doors=[];
  function box(x,y,z,l,h,w,colour,group=parts){
    const geom=new T.BoxGeometry(l,h,w).translate(x,y,z);
    const c=new T.Color(colour),rgb=[];
    for(let i=0;i<geom.attributes.position.count;i++)rgb.push(c.r,c.g,c.b);
    geom.setAttribute('color',new T.Float32BufferAttribute(rgb,3));group.push(geom);
  }
  box(0,floor-.12,0,L,.24,W,0x41494b);
  box(0,H-.08,0,L,.16,W,0xd2d0bb);
  const levels=double?[floor,2.37]:[floor];
  for(const base of levels){
    const top=double&&base===floor?2.37:H;
    if(base>floor){ // Front staircase opens into the upper saloon.
      box(-1,base-.07,0,L-2,.14,W,0x4a4e54);
      for(let i=0;i<9;i++)box(L/2-2+.105+i*.21,floor+i*.218,0,.22,.2,.74,0xa2a5a1);
    }
    for(const side of [-1,1]){
      const z=side*(W/2-.05);
      const doorX=rail ? L*.32 : L/2-1.5;
      const hasDoor=base===floor && (rail || side<0);
      const spans=hasDoor?[[-L/2,doorX-.62],[doorX+.62,L/2]]:[[-L/2,L/2]];
      if(hasDoor)doors.push([doorX,base,z]);
      for(const [a,b] of spans)box((a+b)/2,base+.37,z,b-a,.74,.09,0xffffff,paint);
      box(0,top-.18,z,L,.25,.09,0xe8e4d4);
      for(const [a,b] of spans)box((a+b)/2,(top+base+.50)/2,z,b-a-.06,top-base-.94,.025,0xffffff,panes);
      const bays=rail?9:6;
      for(let i=0;i<=bays;i++)box(-L/2+i*L/bays,(base+top)/2,z,.09,top-base,.12,0x49585a);
      box(0,top-.28,side*.62,L-.55,.045,.045,rail?0xacb6b5:0xe7b746);
      for(let x=-L/2+1;x<L/2-2;x+=rail?1.18:1.03){
        if(hasDoor && Math.abs(x-doorX)<1.15)continue;
        if(!rail && base===floor && side<0 && x>0 && x<2.2)continue; // wheelchair / pushchair space
        const sz=side*.82, blue=rail?0x34606e:0x304d72;
        box(x,base+.48,sz,.48,.14,.66,blue);
        box(x-.23,base+.82,sz,.10,.67,.66,blue);
        box(x,base+.23,sz,.16,.42,.21,0x586268);
        box(x-.22,base+1.16,sz,.13,.13,.57,rail?0x96aba3:0x65839a);
        for(const dz of [-.19,0,.19])box(x-.172,base+.84,sz+dz,.014,.47,.028,rail?0x62998b:0x597c9f);
        box(x,base+.68,side*.50,.34,.055,.047,0x414957);
        seats.push([x,base,sz]);
      }
      for(let x=-L/2+1;x<L/2;x+=3.1)box(x,(base+top)/2,side*.45,.035,top-base,.035,rail?0x9caeae:0xf1b844);
    }
    for(const end of [-1,1]){
      box(end*(L/2-.04),base+.41,0,.09,.82,W,rail?0xe1ad41:0x586268);
      box(end*(L/2-.04),(top+base+.62)/2,0,.025,top-base-.92,W-.14,0xffffff,panes);
    }
    for(let x=-L/2+1.2;x<L/2-.8;x+=2.4){
      box(x,top-.11,0,1.8,.045,.19,0xffefd3);
      box(x,top-.12,.25,.85,.035,.085,0x697074);
    }
    if(!rail){
      for(const x of [-L/2+1,-L/2+4.1])box(x,base+1.15,-.42,.085,.13,.06,0xe04436);
      if(base===floor){
        box(1.1,base+.91,-W/2+.14,1.3,.05,.06,0xe7b746);
        box(1.48,base+.69,-W/2+.14,.64,.43,.11,0x304d72);
        box(L/2-1.5,base+.022,-W/2+.12,1.25,.03,.19,0xe3bc57);
      }
    }
  }
  if(rail){
    for(const end of [-1,1]){
      box(end*(L/2-2.1),.32,0,2.65,.37,1.8,0x2c3336);
      for(const side of [-1,1])for(const shift of [-.76,.76]){
        const wheel=new T.CylinderGeometry(.36,.36,.18,12).rotateX(Math.PI/2).translate(end*(L/2-2.1)+shift,.32,side*.79);
        const rgb=new Float32Array(wheel.attributes.position.count*3).fill(.07);
        wheel.setAttribute('color',new T.BufferAttribute(rgb,3));parts.push(wheel);
      }
    }
    for(const side of [-1,1])box(0,H-.52,side*1.02,L-1,.055,.42,0x8b989c);
  }
  if(!rail)box(L/2-.65,floor+.7,.57,.65,.4,.72,0x42494d);
  function merge(batch){const result=mergeGeometries(batch);batch.forEach(g=>g.dispose());return result;}
  const result={body:merge(parts),stripe:merge(paint),windows:merge(panes),seats,doors,L,H,floor,double};cache.set(type,result);return result;
}
const head=new T.SphereGeometry(.13,8,6),torso=new T.BoxGeometry(.30,.48,.33),riderMat=new T.MeshStandardMaterial();
const doorSurface=new T.MeshStandardMaterial({color:0x426b77});
const doorPanel=mergeGeometries([
  new T.BoxGeometry(.61,.85,.075).translate(0,-.52,0),
  new T.BoxGeometry(.61,.22,.075).translate(0,.86,0),
  ...[-1,1].map(s=>new T.BoxGeometry(.06,.92,.075).translate(s*.275,.32,0))
]);
export class PassengerCabin extends T.Group {
  constructor(type,colour){
    super();this.typeName=type;this.seated=[];this.layout=layout(type);this.paint=new T.MeshStandardMaterial({color:colour});
    this.add(new T.Mesh(this.layout.body,material),new T.Mesh(this.layout.stripe,this.paint),new T.Mesh(this.layout.windows,glass));
    this.heads=new T.InstancedMesh(head,riderMat,24);this.bodies=new T.InstancedMesh(torso,riderMat,24);
    this.add(this.heads,this.bodies);this.heads.count=this.bodies.count=0;
    this.leaves=[];
    for(const [x,y,z] of this.layout.doors)for(const sign of [-1,1]){
      const leaf=new T.Mesh(doorPanel,doorSurface);leaf.position.set(x+sign*.31,y+.95,z);this.add(leaf);
      this.leaves.push({leaf,x:x+sign*.31,sign});
    }
    const {L,H,double}=this.layout;
    this.insideSign=new TransitSign(1.18,.29,true);this.insideSign.position.set(L/2-.18,double?2.14:H-.37,0);this.insideSign.rotation.y=-Math.PI/2;
    this.frontSign=new TransitSign(1.8,.34,true);this.frontSign.position.set(L/2+.018,H-.32,0);this.frontSign.rotation.y=Math.PI/2;
    this.add(this.insideSign,this.frontSign);
    this.openAmount=0;
    this.seatMatrix=new T.Matrix4();this.heads.frustumCulled=this.bodies.frustumCulled=false;
  }
  // side: which side's doors a train opens (+1 the cabin's +z side, -1 its -z side: the platform side)
  doorState(open,dt,side=1){
    this.openAmount=T.MathUtils.damp(this.openAmount,open?1:0,5,dt);
    for(const {leaf,x,sign} of this.leaves)leaf.position.x=x+sign*.55*(this.typeName==='rail' && leaf.position.z*side<0?0:this.openAmount);
  }
  passengers(people){
    const n=Math.min(24,this.layout.seats.length,people.length);
    if(n===this.seated.length && this.seated.every((p,i)=>p===people[i]))return;
    this.seated=people.slice(0,n);
    for(let i=0;i<n;i++){
      const [x,y,z]=this.layout.seats[i],look=(people[i].actor||people[i]).look;
      this.heads.setMatrixAt(i,this.seatMatrix.makeTranslation(x,y+1.22,z));this.bodies.setMatrixAt(i,this.seatMatrix.makeTranslation(x,y+.86,z));
      this.heads.setColorAt(i,new T.Color(look.skin));this.bodies.setColorAt(i,new T.Color(look.top));
    }
    for(const m of [this.heads,this.bodies]){m.count=n;m.instanceMatrix.needsUpdate=true;if(m.instanceColor)m.instanceColor.needsUpdate=true;}
  }
  dispose(){this.insideSign.dispose();this.frontSign.dispose();this.paint.dispose();this.heads.dispose();this.bodies.dispose();}
}
