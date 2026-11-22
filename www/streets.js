// Local geometry uses metres east and south. Keep only the neighbouring map cells on the GPU.
function buildStreetView(){
 const T=THREE, scene=new T.Scene(),camera=new T.PerspectiveCamera(54,1,.5,1100);
 const renderer=new T.WebGLRenderer({antialias:true,alpha:false});
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
 const canvas=renderer.domElement;canvas.style.cssText='position:absolute;inset:0;pointer-events:none';world.after(canvas);
 scene.background=new T.Color(0xbacbd0);scene.fog=new T.FogExp2(0xbacbd0,.0024);
 scene.add(new T.HemisphereLight(0xfff2d7,0x99a69b,2));const sun=new T.DirectionalLight(0xffddad,2);sun.position.set(-120,180,90);scene.add(sun);
 const ground=new T.Mesh(new T.PlaneGeometry(50000,50000),new T.MeshLambertMaterial({color:0x74805b}));ground.rotation.x=-Math.PI/2;scene.add(ground);
 const block=new T.BoxGeometry(1,1,1);
 function box(parent,x,y,z,w,h,d,color){const m=new T.Mesh(block,new T.MeshLambertMaterial({color}));m.scale.set(w,h,d);m.position.set(x,y,z);parent.add(m);return m}
 const auto=new T.Group(),person=new T.Group();scene.add(auto,person);
 box(auto,0,.82,0,4.6,.9,2,0x812f42);box(auto,-.2,1.5,0,2.6,.73,1.8,0x52666d);
 for(const x of [-1.4,1.4])for(const z of [-.96,.96])box(auto,x,.43,z,.78,.8,.28,0x292b29);
 box(person,0,1.1,0,.54,.75,.32,0x243848);box(person,0,1.72,0,.33,.38,.32,0xb58c6c);
 for(const x of [-.16,.16])box(person,x,.41,0,.23,.82,.27,0x32373a);

 // Open-front starter lock-up with corrugated sides, timber benches and amber work lights.
 const home=new T.Group();scene.add(home);home.position.set(start[2]-5,0,start[3]-9);
 box(home,0,.1,0,9,.2,7,0x919089);box(home,0,2,-3.5,9,4,.25,0x845f4e);
 for(let side of [-1,1])box(home,side*4.5,2,0,.25,4,7,0x996d58);
 box(home,0,4.2,0,9.6,.4,7.5,0x494b49);box(home,0,3.6,3.3,8.8,.7,.18,0x848b82);
 box(home,-1,1,-2,5,.16,1.3,0x967346);
 for(let i=0;i<5;i++){box(home,i-3,1.3,-2,.5,.48,.5,0x9c6447);let leaf=new T.Mesh(new T.IcosahedronGeometry(.45),new T.MeshLambertMaterial({color:i%2?0x527843:0x72925a}));leaf.position.set(i-3,1.85,-2);home.add(leaf)}
 box(home,-1,3,-2,4,.1,.32,0xffdf9c);
 const people=[0xab763e,0x3b7667,0x7b4252,0x533d4b].map(col=>{let npc=person.clone();npc.children[0].material=person.children[0].material.clone();npc.children[0].material.color.setHex(col);scene.add(npc);return npc});
 const shop=new T.Group();scene.add(shop);shop.position.set(workshop[0],0,workshop[1]);box(shop,0,2,-5,14,4,1,0x466565);box(shop,0,4.5,-1,15,.4,9,0x344b50);for(let x of [-6,6])box(shop,x,2,2,.5,4,.5,0xc0a26b);
 const body=auto.children[0];const plate=box(auto,-2.31,.82,0,.04,.25,.77,0xfac849);
 for(let side of [-1,1])box(auto,2.32,.86,side*.7,.06,.25,.42,0xffe6aa);
 const pin=new T.Mesh(new T.OctahedronGeometry(2),new T.MeshBasicMaterial({color:0xffcb74}));scene.add(pin);
 let chunk=null,cell='',lastSize='';
 function refresh(ix,iy){if(chunk){scene.remove(chunk);chunk.geometry.dispose();chunk.material.dispose()}
 let positions=[],colors=[];function tri(a,b,c,col){positions.push(...a,...b,...c);let shade=new T.Color(col);for(let j=0;j<3;j++)colors.push(shade.r,shade.g,shade.b)}
 let items=new Set();for(let x=ix-1;x<=ix+1;x++)for(let y=iy-1;y<=iy+1;y++)for(const f of grid.get(x+','+y)||[])items.add(f);
 for(const [kind,p] of items){if(kind==='b'){if(p.some(([x,y])=>Math.abs(x-start[2])<19&&Math.abs(y-start[3])<18))continue;let ox=p[0][0],oz=p[0][1],height=4+Math.abs(ox%7),color=[0x967463,0xad8976,0x96877b][Math.abs(ox)%3];
 for(let i=1;i<p.length;i++){let [x,z]=p[i-1],[u,v]=p[i];tri([x,0,z],[u,0,v],[u,height,v],color);tri([x,0,z],[u,height,v],[x,height,z],color);tri([ox,height,oz],[x,height,z],[u,height,v],0x5b5852);
 let len=Math.hypot(x-u,z-v);if(len>4&&len<45){for(let j=2;j<len-1;j+=4){let l=j/len,r=(j+1.2)/len,ex=(v-z)/len*.06,ez=(x-u)/len*.06;for(let sign of [-1,1]){let a=x+(u-x)*l+sign*ex,b=z+(v-z)*l+sign*ez,c=x+(u-x)*r+sign*ex,d=z+(v-z)*r+sign*ez;tri([a,2,b],[c,2,d],[c,3.3,d],0x46575a);tri([a,2,b],[c,3.3,d],[a,3.3,b],0x46575a)}}}}
 }else for(let i=1;i<p.length;i++){let [x,z]=p[i-1],[u,v]=p[i],len=Math.hypot(u-x,v-z)||1,w=/motorway|primary|trunk/.test(kind)?5.8:3.1,n=(v-z)*w/len,m=(x-u)*w/len;tri([x-n,.1,z-m],[x+n,.1,z+m],[u+n,.1,v+m],0x55595a);tri([x-n,.1,z-m],[u+n,.1,v+m],[u-n,.1,v-m],0x55595a)}}
 let geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));geo.computeVertexNormals();chunk=new T.Mesh(geo,new T.MeshLambertMaterial({vertexColors:true,side:T.DoubleSide}));scene.add(chunk)}
 return function(){canvas.style.display=map?'none':'block';if(map)return;let ix=Math.floor(g.x/500),iy=Math.floor(g.y/500),k=ix+','+iy;if(k!==cell){refresh(ix,iy);cell=k}
 let size=innerWidth+','+innerHeight;if(size!==lastSize){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();lastSize=size}
 auto.position.set(g.cx,.15,g.cy);if(g.drive)auto.rotation.y=-angle;person.visible=!g.drive;person.position.set(g.x,.15,g.y);person.rotation.y=-angle;pin.position.set(waypoint?.[0]??sites[target][2],6,waypoint?.[1]??sites[target][3]);pin.rotation.y+=.015;
 body.material.color.setHex(b.paint);person.children[0].material.color.setHex(b.active?0x716048:0x243848);
 for(let i=0;i<2;i++){let npc=people[i],following=b.friends[i];npc.visible=!following||!g.drive;let x=following?g.x+(i?2:-2):start[2]+i*2,y=following?g.y+2:start[3]-4;if(Math.hypot(npc.position.x-x,npc.position.z-y)>45)npc.position.set(x,.15,y);npc.position.lerp(new T.Vector3(x,.15,y),.09)}
 people[2].visible=!!b.rival;if(b.rival)people[2].position.set(b.rival.x,.15,b.rival.y);let other=b.positions[1-b.active];people[3].position.set(other[0],.15,other[1]);
 let distance=g.drive?30:13;camera.position.set(g.x, distance*.95,g.y+distance);camera.lookAt(g.x,1,g.y-2);renderer.render(scene,camera)}
}
let drawStreets;try{drawStreets=buildStreetView()}catch(e){console.warn(e)}
