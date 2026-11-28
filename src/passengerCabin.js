// A hollow shell and its furniture share a single vertex-colour geometry per model.
import {createCrowdBatch, disposeCrowdBatch, writeCrowdMember, commitBatch} from './humans.js';
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
      for(const [a,b] of spans){
        box((a+b)/2,base+.64,z+side*.052,b-a,.056,.018,rail?0xc7d1cf:0xddd4b3);
        if(base===floor)box((a+b)/2,base+.075,z+side*.054,b-a,.082,.025,0x444e54);
      }
      box(0,top-.18,z,L,.25,.09,0xe8e4d4);
      for(const [a,b] of spans)box((a+b)/2,(top+base+.50)/2,z,b-a-.06,top-base-.94,.025,0xffffff,panes);
      // Window sills stop at the doorway. The contrasting threshold meets the saloon floor.
      for(const [a,b] of spans)box((a+b)/2,base+.745,z-side*.06,b-a,.04,.085,0x67767b);
      if(hasDoor){
        box(doorX,base+.022,z-side*.14,1.22,.022,.24,0xdfbe63);
        for(const edge of [-1,1])box(doorX+edge*.63,base+1,z-side*.12,.036,1.85,.036,rail?0xb1c2c4:0xe4bf55);
      }
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
  if(rail){
    for(const side of [-1,1]){
      box(0,H-.42,side*.86,L-1,.08,.05,0xabb9b9);
      for(let x=-L/2+1.4;x<L/2-1;x+=2.3)box(x,H-.47,side*1.02,.045,.11,.36,0x667879);
    }
  }else{
    box(L/2-.98,floor+.91,.23,.19,.07,.21,0x27343c);
    box(L/2-.99,floor+.955,.23,.15,.016,.16,0x6caaa6);
    for(const side of [-1,1]){
      box(L/2-.65,2.18,side*1.29,.12,.05,.29,0x29373c);
      box(L/2-.65,2.04,side*1.43,.13,.29,.09,0x374a53);
    }
  }
  if(!rail)box(L/2-.65,floor+.7,.57,.65,.4,.72,0x42494d);
  function merge(batch){const result=mergeGeometries(batch);batch.forEach(g=>g.dispose());return result;}
  const result={body:merge(parts),stripe:merge(paint),windows:merge(panes),seats,doors,L,H,floor,double};cache.set(type,result);return result;
}
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
    this.riders = createCrowdBatch(24,1);
    // Instances are placed in the vertex shader, so use the cabin dimensions for culling.
    this.riders.geo.boundingSphere = new T.Sphere(new T.Vector3(0,this.layout.H/2,0),
      Math.hypot(this.layout.L/2,this.layout.H/2,1.5));
    this.riders.mesh.frustumCulled = true;
    this.add(this.riders.mesh);
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
      const height = look.h || 1;
      writeCrowdMember(this.riders,i,{look,x,y:y+.55-.87*height,z,heading:0,pose:'seated',t:i*1.7});
    }
    commitBatch(this.riders,n);
  }
  dispose(){this.insideSign.dispose();this.frontSign.dispose();this.paint.dispose();disposeCrowdBatch(this.riders);}
}
