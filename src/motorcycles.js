// +X is forward. Each chassis and each helmeted rider is batched across the fleet.
import * as T from 'three/webgpu';
import {mergeGeos} from './tiles.js';

export function motorcycleMesh(dirt, rider=false, model='motorcycle') {
  const parts=[];
  const metal=0x91969b, rubber=0x26282b, frame=dirt?0xb95624:0x41464c;
  function part(g,colour,paint=0,lamp=0) {
    if(g.index)g=g.toNonIndexed();
    g.deleteAttribute('uv');
    const n=g.attributes.position.count, rgb=new T.Color(colour);
    const colours=new Float32Array(n*3), data=new Float32Array(n*4);
    for(let i=0;i<n;i++){rgb.toArray(colours,i*3);data[i*4]=paint;data[i*4+1]=lamp;}
    g.setAttribute('color',new T.BufferAttribute(colours,3));
    g.setAttribute('vdat',new T.BufferAttribute(data,4));parts.push(g);
  }
  function oval(x,y,z,l,h,w,colour,paint=0,lamp=0,tilt=0) {
    part(new T.SphereGeometry(1,14,9).scale(l/2,h/2,w/2).rotateZ(tilt).translate(x,y,z),colour,paint,lamp);
  }
  function tube(a,b,r,colour,r2=r) {
    const start=new T.Vector3(...a),end=new T.Vector3(...b),dir=end.clone().sub(start);
    const g=new T.CylinderGeometry(r2,r,dir.length(),9);
    g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),dir.normalize()));
    const centre=start.lerp(end,.5);part(g.translate(centre.x,centre.y,centre.z),colour);
  }
  function panel(points,z,depth,colour,paint=0){
    const outline=new T.Shape(points.map(([x,y])=>new T.Vector2(x,y)));
    const geometry=new T.ExtrudeGeometry(outline,{depth,bevelEnabled:true,bevelSegments:1,
      bevelSize:.009,bevelThickness:.009,steps:1});
    part(geometry.translate(0,0,z),colour,paint);
  }
  const cycle = model==='bicycle' || model==='ebike', stand = model==='escooter';
  if(cycle && !rider){
    const axle=model==='ebike'?.57:.54, rear=[-axle,.35,0], crank=[-.055,.30,0], saddle=[-.20,.84,0], head=[.33,.86,0];
    tube(crank,saddle,.024,frame); tube(crank,head,model==='ebike'?.052:.026,frame);
    tube(saddle,head,.022,model==='ebike'?0x41645a:0xa64d31); tube([-.20,.82,0],[-.23,.92,0],.017,metal);
    for(const side of [-1,1]){
      const z=side*.066;
      tube([rear[0],rear[1],z],crank,.015,frame); tube([rear[0],rear[1],z],saddle,.014,frame);
      tube([axle,.35,z],head,.02,metal); tube(head,[.34,1.02,side*.23],.012,metal);
      tube([.34,1.02,side*.20],[.31,1.01,side*.30],.019,rubber);
    }
    tube([-.52,.35,-.077],[-.055,.365,-.077],.009,0x494a41);
    oval(-.23,.93,0,.26,.075,.16,rubber); oval(.34,.94,0,.076,.06,.077,0xf4f3dd,0,1);
    oval(-.35,.84,0,.05,.044,.07,0xcb2822,0,2);
    if(model==='ebike')oval(-.06,.30,0,.17,.15,.145,0x34393a);
    return mergeGeos(parts);
  }
  const axle=dirt?.735:.765,radius=dirt?.335:.315,seat=cycle?.93:stand?.99:dirt?.94:.76;
  if(rider){
    const hip=[-.19,seat+.06,0], shoulder=[stand?-.09:dirt?-.12:.01,seat+.48,0];
    oval(hip[0],hip[1],0,.30,.21,.30,0x29323d);
    oval((hip[0]+shoulder[0])/2,seat+.30,0,.29,.54,.39,0x364450,0,0,dirt?-.13:-.30);
    for(const sign of [-1,1]){
      const knee=[stand?-.12:.14,seat-(stand?.34:.19),sign*(stand?.10:.20)], boot=[stand?sign*.11:-.03,stand?.29:.40,sign*(stand?.075:.22)];
      if (!cycle) { tube([hip[0],hip[1],sign*.11],knee,.092,0x29323d,.073);
      tube(knee,boot,.07,0x35404b,.052);oval(boot[0]+.04,boot[1],boot[2],.23,.10,.12,rubber); }
      const elbow=[.13,seat+.25,sign*.27], hand=[stand?.30:cycle?.32:.40,stand?.95:cycle?1.02:seat+.25,sign*.28];
      tube([shoulder[0],shoulder[1],sign*.15],elbow,.075,0x364450,.055);
      tube(elbow,hand,.054,0x303b46,.042);oval(...hand,.12,.085,.085,rubber);
    }
    oval(shoulder[0]+.06,seat+.68,0,.27,.31,.24,0xd9dbd6);
    oval(shoulder[0]+.116,seat+.70,0,.176,.112,.238,0x253745);
    oval(shoulder[0]+.14,seat+.637,0,.12,.067,.197,0xb6b8b3);
    if(dirt)oval(shoulder[0]+.16,seat+.798,0,.21,.027,.25,0x495059);
  } else {
    for(const sign of [-1,1]){
      const z=sign*.105;
      tube([.40,seat+.25,sign*.31],[.41,seat+.25,sign*.385],.019,rubber);
      tube([.42,seat+.24,sign*.25],[.46,seat+.225,sign*.34],.009,metal);
      if(dirt)oval(.455,seat+.25,sign*.315,.064,.074,.13,0xdbd8c8);
      else oval(.38,seat+.285,sign*.14,.084,.055,.086,0x36434b);
      tube([-.39,.78,z],[.1,.34,z],.031,frame);
      tube([.1,.34,z],[.46,seat+.1,z],.032,frame);
      tube([-.39,.78,z],[.46,seat+.1,z],.028,frame);
      tube([-axle,radius,z],[-.02,.43,z],.035,metal);
      tube([axle,radius,z],[.45,seat+.17,z],.033,metal);
      tube([.45,seat+.17,z],[.40,seat+.25,sign*.31],.018,metal);
      tube([-.05,.40,z],[-.05,.40,sign*.24],.019,rubber);
    }
    for(const sign of [-1,1]){
      const z=sign*.157-.013;
      if(dirt){
        panel([[-.24,.86],[.04,.94],[.44,.91],[.37,.72],[.19,.59],[.07,.77]],z,.026,0xffffff,1);
        panel([[-.67,.89],[-.32,.91],[-.12,.83],[-.32,.66],[-.54,.72]],z,.026,0xdfdfd8);
        panel([[-.02,.82],[.25,.87],[.15,.78],[.04,.75]],z+sign*.021,.008,0x242b30);
      }else{
        panel([[-.41,.73],[-.17,.77],[.08,.73],[.03,.60],[-.24,.55]],z,.026,0xffffff,1);
        for(let fin=0;fin<5;fin++)
          part(new T.BoxGeometry(.25,.014,.035).rotateZ(.18).translate(.06,.50+fin*.035,sign*.17),0x9b9c99);
        tube([.37,seat+.24,sign*.24],[.34,seat+.41,sign*.32],.009,metal);
        oval(.34,seat+.42,sign*.32,.08,.065,.14,0x34393a);
      }
      oval(-.10,.46,sign*.156,.23,.22,.048,0x707477);
      oval(-.10,.46,sign*.182,.145,.14,.018,0x474b4c);
      tube([axle,radius+.025,sign*.112],[.60,.59,sign*.112],.043,dirt?0xd5cbb0:metal);
    }
    if(dirt){
      // The two-stroke expansion chamber swells at the cylinder, before the narrow tailpipe.
      tube([.18,.53,.16],[.30,.46,.195],.032,0x847c70,.085);
      tube([.30,.46,.195],[.08,.39,.20],.085,0x918275,.057);
      tube([.08,.39,.20],[-.18,.57,.19],.057,0x847b70,.029);
    }else{
      part(new T.BoxGeometry(.075,.085,.19).rotateZ(-.24).translate(.38,seat+.25,0),0x405c62);
    }
    tube([-.45,.58,.01],[-.19,.83,.01],.039,0xb4ada2);
    tube([-axle,radius,-.115],[-.13,.48,-.115],.014,0x393a32);
    tube([-axle,radius-.06,-.115],[-.13,.41,-.115],.011,0x393a32);
    oval(-.67,seat+.01,0,.38,.06,.23,0xffffff,1,0,-.16);
    oval(-.03,.52,0,.44,.33,.3,0x575e61);
    for(let i=0;i<6;i++)part(new T.BoxGeometry(.18,.016,.33).translate(.08,.56+i*.033,0),metal);
    tube([.18,.55,.13],[.30,.34,.16],.034,metal);
    tube([.30,.34,.16],[-.55,dirt?.77:.47,.17],.045,metal,.078);
    oval(.19,seat-.055,0,.56,.30,dirt?.29:.44,0xffffff,1,0,-.13);
    oval(-.26,seat,0,.64,.10,.28,rubber,0,0,.035);
    oval(-.54,seat-.07,0,.51,.12,.25,0xffffff,1,0,-.14);
    oval(axle,dirt?.84:.65,0,.52,.065,.17,0xffffff,1,0,-.09);
    if(dirt) panel([[.47,1.01],[.53,1.20],[.59,1.17],[.56,1.01]],-.095,.19,0xffffff,1);
    oval(.54,seat+.12,0,.14,.177,.185,rubber);
    oval(.598,seat+.12,0,.043,.137,.145,0xf4f1dc,0,1);
    oval(-.77,seat-.10,0,.07,.059,.135,0xc8382c,0,2);
    part(new T.BoxGeometry(.023,.095,.18).rotateZ(-.23).translate(-.78,seat-.20,0),0xe6bd3a);
  }
  return mergeGeos(parts);
}
