// Navigation and traffic consume the same metre-based OpenStreetMap polylines as the renderer.
function nearbyWays(x,y,r){
 const ways=new Set();for(let a=Math.floor((x-r)/500);a<=Math.floor((x+r)/500);a++)
 for(let j=Math.floor((y-r)/500);j<=Math.floor((y+r)/500);j++)for(const f of grid.get(a+','+j)||[])if(f[0]!=='b')ways.add(f);return ways
}
function streetAt(x,y,ways){let name='',best=95*95;
 for(const [,points,label] of ways){if(!label)continue;for(let i=1;i<points.length;i++){
 let [a,z]=points[i-1],[b,v]=points[i],dx=b-a,dz=v-z,t=Math.max(0,Math.min(1,((x-a)*dx+(y-z)*dz)/(dx*dx+dz*dz||1))),d=(a+t*dx-x)**2+(z+t*dz-y)**2;
 if(d<best){best=d;name=label}}}return name||district()[0]}
const radar=document.querySelector('#radar'),rc=radar.getContext('2d');let lastRadar=-1000,lastStreet='';
function updateRadar(now){if(now-lastRadar<180)return;lastRadar=now;radar.hidden=map;if(map)return;
 const w=radar.width,h=radar.height,scale=g.drive?.52:.8,ways=nearbyWays(g.x,g.y,220),X=x=>(x-g.x)*scale+w/2,Y=y=>(y-g.y)*scale+h/2;
 rc.fillStyle='#172826';rc.fillRect(0,0,w,h);
 for(const [kind,points] of ways){rc.strokeStyle=/primary|motorway|trunk/.test(kind)?'#c6b18a':'#80948e';rc.lineWidth=/service/.test(kind)?1.5:3;rc.beginPath();points.forEach(([x,y],i)=>i?rc.lineTo(X(x),Y(y)):rc.moveTo(X(x),Y(y)));rc.stroke()}
 const dst=waypoint||sites[target].slice(2);function marker(x,y,col,r){rc.fillStyle=col;rc.beginPath();rc.arc(x,y,r,0,7);rc.fill()}
 marker(Math.max(6,Math.min(w-6,X(dst[0]))),Math.max(6,Math.min(h-6,Y(dst[1]))),'#ffb857',5);marker(X(g.cx),Y(g.cy),'#69bcdd',4);
 rc.save();rc.translate(w/2,h/2);rc.rotate(angle);rc.fillStyle='#fff';rc.beginPath();rc.moveTo(8,0);rc.lineTo(-5,-4);rc.lineTo(-3,0);rc.lineTo(-5,4);rc.fill();rc.restore();rc.fillStyle='white';rc.font='bold 12px sans-serif';rc.fillText('N',6,14);
 lastStreet=streetAt(g.x,g.y,ways);document.getElementById('road').textContent=lastStreet}
let speedMps=0;
const localFleet=g.localFleet??=sites.slice(1).map((s,i)=>({x:s[2]+4,y:s[3]+4,paint:[0xc2bcb0,0x536674,0x713d35,0x46665c,0x615e60][i]}));
function nearbyCar(){let best={d:Math.hypot(g.cx-g.x,g.cy-g.y),id:-1};localFleet.forEach((v,i)=>{let d=Math.hypot(v.x-g.x,v.y-g.y);if(d<best.d)best={d,id:i}});return best}
function vehicleAction(){if(g.drive){g.drive=false;g.x=g.cx+Math.sin(angle)*1.6;g.y=g.cy-Math.cos(angle)*1.6;speedMps=0;msg('On foot · '+lastStreet)}
 else if(nearbyCar().d<=10){let i=nearbyCar().id;if(i>=0){let old={x:g.cx,y:g.cy,paint:b.paint},v=localFleet[i];g.cx=v.x;g.cy=v.y;b.paint=v.paint;localFleet[i]=old}g.drive=true;g.x=g.cx;g.y=g.cy;speedMps=0;msg('Driving · hold stick up to accelerate, steer left or right, pull back to reverse')}
 else{let i=nearbyCar().id;waypoint=i<0?[g.cx,g.cy]:[localFleet[i].x,localFleet[i].y];msg('Car marked on your map · approach the driver’s door')}save()}
car.onclick=vehicleAction;
function driveInput(x,y,dt){let throttle=-y;
 if(Math.abs(throttle)>.05)speedMps+=throttle*(speedMps*throttle<0?21:10+b.motor*2)*dt;
 else speedMps*=Math.exp(-1.3*dt);
 speedMps=Math.max(-9,Math.min(35+b.motor*6,speedMps));angle+=x*1.65*dt*Math.min(1,Math.abs(speedMps)/3)*Math.sign(speedMps);
 g.x+=Math.cos(angle)*speedMps*dt;g.y+=Math.sin(angle)*speedMps*dt;
 viewYaw=Math.atan2(-Math.cos(angle),-Math.sin(angle));}
function cityScene(T,scene,box){
 const makeGroup=(x,z)=>{let m=new T.Group();m.position.set(x,0,z);scene.add(m);return m};
 function centre(name){let p=features.find(f=>f[0]==='b'&&f[2]===name)[1];let xs=p.map(v=>v[0]),zs=p.map(v=>v[1]);return [(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...zs)+Math.max(...zs))/2]}
 const gate=makeGroup(...centre('Cemetery Arch'));gate.rotation.y=-Math.PI/2;
 const sandstone=0xbca887;
 for(const side of [-1,1]){box(gate,side*6,2.1,0,5,4.2,5,sandstone);box(gate,side*6,4.35,0,5.5,.4,5.4,0xd1c4a7);box(gate,side*2.7,2.2,0,1.35,4.4,3.2,sandstone);box(gate,side*6,2.2,2.52,1.1,1.8,.1,0x3a4647)}
 let arch=new T.Shape();arch.moveTo(-3.4,4);arch.lineTo(-3.4,7.4);arch.lineTo(3.4,7.4);arch.lineTo(3.4,4);arch.lineTo(2.05,4);arch.absarc(0,4,2.05,0,Math.PI,false);arch.closePath();
 let masonry=new T.Mesh(new T.ExtrudeGeometry(arch,{depth:3.3,bevelEnabled:false}),new T.MeshStandardMaterial({color:sandstone}));masonry.position.z=-1.65;gate.add(masonry);box(gate,0,7.5,0,7.35,.44,3.8,0xd9c9ac);
 const hall=makeGroup(...centre('Reading Town Hall'));hall.rotation.y=.3;
 box(hall,0,6,0,25,12,12,0x8e6559);box(hall,11,12,5,5.5,24,5.5,0x985a48);
 for(let level of [5,10,16,21])box(hall,11,level,5,5.9,.42,6,0xc28769);
 let roof=new T.Mesh(new T.ConeGeometry(4.7,8,4),new T.MeshStandardMaterial({color:0x464950}));roof.rotation.y=Math.PI/4;roof.position.set(11,28,5);hall.add(roof);
 for(let i=-10;i<10;i+=3)for(let y of [3,8])box(hall,i,y,6.1,1.35,2.45,.15,0x383e41);
 let dial=document.createElement('canvas');dial.width=dial.height=128;let c=dial.getContext('2d');c.fillStyle='#eadbb5';c.beginPath();c.arc(64,64,62,0,7);c.fill();c.translate(64,64);c.fillStyle='#272c2d';for(let i=0;i<12;i++){c.fillRect(-2,-55,4,8);c.rotate(Math.PI/6)}c.fillRect(-2,-41,4,43);c.rotate(2);c.fillRect(-3,-30,6,31);
 let clock=new T.Mesh(new T.PlaneGeometry(3.9,3.9),new T.MeshBasicMaterial({map:new T.CanvasTexture(dial),transparent:true}));clock.position.set(11,19,7.78);hall.add(clock);
 // Fixed-size actor pools follow local road segments on a left-hand lane or pavement.
 let actors=[];for(let i=0;i<16;i++){let node=makeGroup(0,0),ped=i>=8;if(ped){box(node,0,1.13,0,.5,.75,.33,[0x48566a,0x895a45,0x575d4c][i%3]);box(node,0,1.7,0,.29,.34,.28,0xb68b70);for(let s of [-1,1])box(node,s*.14,.44,0,.19,.83,.22,0x303036)}
 else{let tint=[0x656f79,0x904e47,0xc8c0ac,0x354e60][i%4];box(node,0,.71,0,4,.72,1.72,tint);box(node,-.2,1.22,0,2.15,.5,1.46,0x52616a);for(let side of [-1,1])for(let x of [-1.2,1.2])box(node,x,.4,side*.8,.65,.64,.25,0x292a29)}node.visible=false;actors.push({node,ped})}
 const parked=localFleet.map(v=>{let node=makeGroup(v.x,v.y);box(node,0,.7,0,4,.75,1.8,v.paint);box(node,-.15,1.25,0,2.2,.55,1.5,0x495c65);for(let x of [-1.2,1.2])for(let z of [-.83,.83])box(node,x,.4,z,.68,.7,.24,0x272826);return node});
 let cell='',routes=[];return function(now){parked.forEach((node,i)=>{let v=localFleet[i];node.position.set(v.x,0,v.y);node.children[0].material.color.setHex(v.paint)});let key=Math.floor(g.x/100)+','+Math.floor(g.y/100);
 if(key!==cell){cell=key;routes=[];for(let [kind,p] of nearbyWays(g.x,g.y,180)){if(kind==='service')continue;for(let i=1;i<p.length;i++){let [x,z]=p[i-1],[u,v]=p[i],len=Math.hypot(u-x,v-z);if(len>18&&Math.hypot((x+u)/2-g.x,(z+v)/2-g.y)<155)routes.push([x,z,(u-x)/len,(v-z)/len,len])}}routes.sort((a,b)=>Math.hypot(a[0]-g.x,a[1]-g.y)-Math.hypot(b[0]-g.x,b[1]-g.y))}
 actors.forEach(({node,ped},i)=>{let path=routes[i];node.visible=!!path;if(!path)return;let [x,z,ux,uz,len]=path,t=(now*.001*(ped?1.2:6)+i*13)%(2*len),forward=t<len,dist=forward?t:2*len-t,offset=(forward?1:-1)*(ped?4.5:1.45);node.position.set(x+ux*dist+uz*offset,0,z+uz*dist-ux*offset);node.rotation.y=-Math.atan2(uz,ux)+(forward?0:Math.PI)})}
}
