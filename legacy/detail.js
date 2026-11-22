// Repeatable materials and small meshes stay resident while map geometry streams.
function detailWorld(T,scene,home,person,people,auto,box){
 const sphere=new T.SphereGeometry(1,14,10), cache=new Map();
 function curved(group,x,y,z,w,h,d,color){
  if(!cache.has(color))cache.set(color,new T.MeshStandardMaterial({color,roughness:.82}));
  const m=new T.Mesh(sphere,cache.get(color));m.scale.set(w,h,d);m.position.set(x,y,z);group.add(m);return m;
 }
 const groundShadow=new T.CanvasTexture((()=>{let c=document.createElement('canvas');c.width=c.height=64;let p=c.getContext('2d'),gradient=p.createRadialGradient(32,32,1,32,32,31);gradient.addColorStop(0,'rgba(0,0,0,.65)');gradient.addColorStop(1,'rgba(0,0,0,0)');p.fillStyle=gradient;p.fillRect(0,0,64,64);return c})());
 function shadow(parent,w,d){let m=new T.Mesh(new T.PlaneGeometry(w,d),new T.MeshBasicMaterial({map:groundShadow,transparent:true,depthWrite:false}));m.rotation.x=-Math.PI/2;m.position.y=.04;parent.add(m)}
 const outfits=[0x314958,0x765741,0x294735,0x653143],skin=[0xb48265,0x895e46,0xc39475];

 const headGeo=new T.BufferGeometry();
 for(const key of ['position','normal','uv','index']){
  const bytes=Uint8Array.from(atob(portraitData[key]),c=>c.charCodeAt(0)).buffer;
  if(key==='index')headGeo.setIndex(new T.BufferAttribute(new Uint16Array(bytes),1));
  else headGeo.setAttribute(key,new T.BufferAttribute(new Float32Array(bytes),key==='uv'?2:3))
 }
 headGeo.computeBoundingBox();let bounds=headGeo.boundingBox;let mid=bounds.getCenter(new T.Vector3());headGeo.translate(-mid.x,-mid.y,-mid.z);
 const portrait=new T.TextureLoader().load('assets/portrait.jpg');portrait.flipY=false;portrait.colorSpace=T.SRGBColorSpace;
 // A tapered jacket with shoulder, chest, waistband and hip cross sections.
 let profile=[[.84,.205,.135],[.91,.25,.16],[1.05,.245,.18],[1.34,.29,.185],[1.45,.3,.17],[1.5,.19,.13]],vertices=[],indices=[];
 profile.forEach(([height,w,d],r)=>{for(let i=0;i<18;i++){let a=i*Math.PI/9;vertices.push(Math.sin(a)*w,height,Math.cos(a)*d);if(r){let a0=(r-1)*18+i,a1=(r-1)*18+(i+1)%18;indices.push(a0,a0+18,a1,a1,a0+18,a1+18)}}});
 let jacket=new T.BufferGeometry();jacket.setAttribute('position',new T.Float32BufferAttribute(vertices,3));jacket.setIndex(indices);jacket.computeVertexNormals();
 const actors=[person,...people].map((actor,i)=>{
  actor.clear();const torso=curved(actor,0,1.21,0,.27,.36,.18,outfits[i%4]);torso.geometry=jacket;torso.scale.setScalar(1);torso.position.set(0,0,0);torso.material=torso.material.clone();torso.material.side=T.DoubleSide;box(actor,0,1.18,.179,.012,.53,.008,0xb1a797);for(let side of [-1,1])box(actor,side*.15,1.05,.145,.086,.013,.025,0x282c31);
  curved(actor,0,1.55,0,.21,.12,.17,0x414347);const face=curved(actor,0,1.73,0,.15,.2,.145,skin[i%3]);face.geometry=headGeo;face.scale.setScalar(.063);face.material=new T.MeshStandardMaterial({map:portrait,roughness:.83});
  const hair=curved(actor,0,1.86,-.025,.155,.1,.146,0x352c28);
  const legs=[],arms=[];for(const side of [-1,1]){let leg=new T.Group();actor.add(leg);leg.position.set(side*.12,.89,0);curved(leg,0,-.36,0,.12,.4,.13,0x30363c);curved(leg,0,-.77,.05,.114,.094,.19,0x262422);legs.push(leg);
  let arm=new T.Group();actor.add(arm);arm.position.set(side*.235,1.44,0);curved(arm,side*.045,-.22,0,.09,.26,.105,outfits[i%4]);curved(arm,side*.055,-.49,0,.07,.1,.074,skin[i%3]);arms.push(arm)}
  shadow(actor,1.3,1.1);return {torso,face,hair,arms,legs}
 });

 // Longitudinal sections shape the bonnet, belt line and sloping glasshouse.
 function shell(sections,material){
  let xyz=[],idx=[];sections.forEach(([x,w,bottom,top,taper],i)=>{xyz.push(x,bottom,-w,x,bottom,w,x,top,w*taper,x,top,-w*taper);
   if(i)for(let j=0;j<4;j++){let a=(i-1)*4+j,b=(i-1)*4+(j+1)%4;idx.push(a,b,a+4,b,b+4,a+4)}});
  let end=xyz.length/3-4;idx.push(0,2,1,0,3,2,end,end+1,end+2,end,end+2,end+3);let geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(xyz,3));geo.setIndex(idx);geo.computeVertexNormals();material.side=T.DoubleSide;let mesh=new T.Mesh(geo,material);auto.add(mesh);return mesh}
 auto.children.forEach(m=>m.visible=false);let paint=auto.children[0].material;
 shell([[-2.15,.78,.46,.98,.97],[-1.86,.88,.4,1.15,.96],[.78,.9,.4,1.12,.96],[2,.82,.48,.91,.95]],paint);
 shell([[-1.88,.80,1.06,1.14,.94],[-1.43,.81,1.07,1.67,.84],[-.24,.84,1.07,1.69,.82],[.81,.84,1.07,1.13,.95]],new T.MeshStandardMaterial({color:0x475d67,metalness:.25,roughness:.26}));
 box(auto,-.84,1.69,0,1.26,.065,1.45,0x51343c);
 for(let d of [-1,1]){box(auto,-.84,1.38,d*.76,.085,.51,.075,0x292a29);box(auto,-.53,1.04,d*.87,.16,.038,.04,0xc4c4b9);box(auto,.61,1.18,d*.94,.23,.13,.16,0x3a3634);
 for(let x of [-1.36,1.31]){let wheel=new T.Mesh(new T.CylinderGeometry(.387,.387,.22,24),new T.MeshStandardMaterial({color:0x232322}));wheel.rotation.x=Math.PI/2;wheel.position.set(x,.41,d*.84);auto.add(wheel);let hub=new T.Mesh(new T.CylinderGeometry(.24,.24,.025,16),new T.MeshStandardMaterial({color:0xaaa59b}));hub.rotation.x=Math.PI/2;hub.position.set(x,.41,d*.958);auto.add(hub);for(let k=0;k<6;k++)curved(auto,x+.136*Math.cos(k*Math.PI/3),.41+.136*Math.sin(k*Math.PI/3),d*.976,.044,.044,.012,0x4a4944)}
 box(auto,-2.16,.86,d*.61,.055,.18,.24,0xa32b27);box(auto,2.015,.81,d*.57,.06,.13,.32,0xf6ddaf)}
 box(auto,-2.18,.69,0,.036,.13,.53,0xe8bd50);box(auto,2.03,.67,0,.025,.14,.66,0x292b2b);
 shadow(auto,6,3);shadow(home,13,12);
 function texture(kind){let canvas=document.createElement('canvas');canvas.width=canvas.height=256;let p=canvas.getContext('2d'),seed=685;function rand(){seed=seed*16807%2147483647;return seed/2147483647}p.fillStyle=kind==='brick'?'#b3a695':'#74736d';p.fillRect(0,0,256,256);
 if(kind==='brick')for(let y=0;y<16;y++)for(let x=-1;x<9;x++){let f=Math.floor(rand()*29);p.fillStyle='rgb('+(127+f)+','+(81+f)+','+(66+f)+')';p.fillRect(x*32+y%2*16,y*16,30,14)}
 for(let i=0;i<13000;i++){p.fillStyle=rand()<.5?'#ffffff12':'#11111118';p.fillRect(rand()*256,rand()*256,1+rand()*2,1)}let t=new T.CanvasTexture(canvas);t.wrapS=t.wrapT=T.RepeatWrapping;t.colorSpace=T.SRGBColorSpace;return t}
 const brick=texture('brick'),tarmac=texture('asphalt');brick.repeat.set(2,1);
 for(let i of [1,2,3])home.children[i].material=new T.MeshStandardMaterial({map:brick});
 const forecourt=box(home,0,.055,5,24,.12,22,0xffffff);tarmac.repeat.set(5,5);forecourt.material.map=tarmac;
 function sign(text,x,y,z,width){let c=document.createElement('canvas');c.width=512;c.height=96;let p=c.getContext('2d');p.fillStyle='#203634';p.fillRect(0,0,512,96);p.strokeStyle='#b0a185';p.strokeRect(4,4,504,88);p.font='bold 44px sans-serif';p.fillStyle='#ede6d3';p.textAlign='center';p.fillText(text,256,63);let t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;let m=new T.Mesh(new T.PlaneGeometry(width,width*96/512),new T.MeshBasicMaterial({map:t}));home.add(m);m.position.set(x,y,z)}
 sign('WARD  •  UNIT 07',0,3.68,3.42,5.1);
 const tiers=[];for(let n=1;n<=4;n++){let rack=box(home,2,.65+n*.43,-1.6,2,.08,1,0x868b83),tank=curved(home,3, .5,-2.6+n*.92,.4,.55,.4,0x35615e),bar=box(home,-3+n*1.25,3.2,-.45,.8,.09,.35,0xffe5a0);tiers.push([rack,tank,bar])}
 const leafShape=new T.SphereGeometry(1,5,3),leaves=new T.InstancedMesh(leafShape,new T.MeshLambertMaterial({color:0x508342}),140);let marker=new T.Object3D();for(let i=0;i<140;i++){let pot=Math.floor(i/28),n=i%28,a=n*2.4,r=.18+(n%4)*.05;marker.position.set(pot-3+Math.cos(a)*r,1.55+n*.025,-2+Math.sin(a)*r);marker.rotation.set(.4,a,.65);marker.scale.set(.065,.038,.25);marker.updateMatrix();leaves.setMatrixAt(i,marker.matrix)}home.add(leaves);
 const yard=new T.Group();yard.position.set(sites[1][2],0,sites[1][3]);scene.add(yard);
 for(let i=0;i<6;i++){box(yard,i*1.7-4,.13,0,1.1,.26,8,0x594633);for(let j=0;j<7;j++)curved(yard,i*1.7-4,.63,j-3,.43,.6,.42,0x527448)}
 const trees=new T.Group();home.add(trees);for(let i=0;i<15;i++){let x=-22+i*3.5,z=-16-Math.sin(i*2)*3;box(trees,x,2,z,.44,4,.4,0x645542);curved(trees,x,5,z,2.4,2.8,2,0x486541);curved(trees,x+.9,5.7,z,1.7,2,1.6,0x60794b)}
 let prevX=g.x,prevY=g.y,phase=0;
 return function(){let moved=Math.min(1,Math.hypot(g.x-prevX,g.y-prevY));prevX=g.x;prevY=g.y;phase+=moved*2.4;for(let i=0;i<actors.length;i++){const m=actors[i];if(i===0||i===4){let o=b.wardrobe[i===0?b.active:1-b.active];m.torso.material.color.setHex(outfits[o.jacket]);m.face.material.color.setHex([0xffe9d4,0xc09b7e,0xfffaf3][o.skin]);m.hair.visible=o.hair!==1;for(let arm of m.arms){if(!arm.userData.tint){arm.children[0].material=arm.children[0].material.clone();arm.userData.tint=true}arm.children[0].material.color.setHex(outfits[o.jacket])}}
  let stride=moved>.01&&i<3?Math.sin(phase+i)*.55:0;m.legs[0].rotation.x=stride;m.legs[1].rotation.x=-stride;m.arms[0].rotation.x=-stride;m.arms[1].rotation.x=stride}
 tiers.forEach(([rack,tank,bar],i)=>{rack.visible=b.room>i;tank.visible=b.water>i;bar.visible=b.light>i});yard.visible=g.owned.includes(1)}
}
