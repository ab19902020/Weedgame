const sites=[
 ['Woodley','Lock-up',-.906,51.453],['Earley','Outdoor plot',-.932,51.436],['Cemetery Junction','Street territory',-.949,51.452],['Reading town centre','Street territory',-.971,51.455],['Winnersh','Processing unit',-.876,51.431],['Bracknell','Wholesale warehouse',-.757,51.415]];
for(const s of sites){s[2]=Math.round((s[2]+.99)*69400);s[3]=Math.round((51.48-s[3])*111100)}
const start=sites[0],fresh={x:start[2],y:start[3],cx:start[2]+10,cy:start[3],drive:false,cash:240,flower:0,edibles:0,vapes:0,owned:[0],crew:[],ready:0,last:Date.now(),bank:0};
let g=fresh;try{g={...fresh,...JSON.parse(localStorage.greenCounty||'{}')}}catch{}
const save=()=>{try{localStorage.greenCounty=JSON.stringify(g)}catch{}};
const ctx=world.getContext('2d'),grid=new Map(),keys=new Set();
for(const f of features){let xs=f[1].map(p=>p[0]),ys=f[1].map(p=>p[1]);for(let x=Math.floor(Math.min(...xs)/500);x<=Math.floor(Math.max(...xs)/500);x++)for(let y=Math.floor(Math.min(...ys)/500);y<=Math.floor(Math.max(...ys)/500);y++){let k=x+','+y;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(f)}}
const majorFeatures=features.filter(f=>/motorway|primary|trunk/.test(f[0]));let dx=0,dy=0,angle=0,map=false,target=0,previous=performance.now(),near=0;
function msg(t){hint.textContent=t}
msg('Your Woodley lock-up is ready. Tap Site to collect your first crop.');
function actions(){panel.hidden=false;panel.replaceChildren();function label(t){let p=document.createElement('p');p.textContent=t;panel.append(p)}function btn(t,fn){let b=document.createElement('button');b.textContent=t;b.onclick=()=>{fn();save();actions()};panel.append(b)}
let close=document.createElement('button');close.textContent='Close ×';close.onclick=()=>panel.hidden=true;panel.append(close);
for(const [name,fn] of [['Street',streetMenu],['Grow room',garage],['Motor Works',tuning]]){let el=document.createElement('button');el.textContent=name;el.onclick=fn;panel.append(el)}
label('Satnav · choose a destination');sites.forEach((s,i)=>btn(s[0],()=>{target=i;waypoint=null;msg('Follow the gold bearing to '+s[0])}));
label('Cargo · '+g.flower+' flower / '+g.edibles+' edibles / '+g.vapes+' vapes');
if(near<0){label('Visit a marked site to trade or manage it.');return}
let i=near;label(sites[i][0]+' · '+sites[i][1]);
if(!g.owned.includes(i)){let cost=[0,350,180,420,550,850][i];btn('Acquire £'+cost,()=>{if(g.cash<cost)return msg('More cash needed');g.cash-=cost;g.owned.push(i);msg('Site acquired')})}
if(g.owned.includes(i)){
if(i<2)btn('Harvest batch',()=>{if(Date.now()<g.ready)return msg('Next crop in '+Math.ceil((g.ready-Date.now())/1000)+'s');g.flower+=i?12:6;g.ready=Date.now()+25000;msg('Batch added to cargo')});
if(i===4||i===0)for(const [name,cost] of [['edibles',2],['vapes',3]])btn('Make '+name+' · '+cost+' flower',()=>{if(g.flower<cost)return msg('More flower needed');g.flower-=cost;g[name]++;msg('Finished '+name+' batch')});
if(i===2||i===3){if(!g.crew.includes(i))btn('Hire dealer £90',()=>{if(g.cash<90)return msg('Need £90');g.cash-=90;g.crew.push(i)});btn('Collect £'+g.bank,()=>{g.cash+=g.bank;g.bank=0})}}
if(i>=2)for(const [k,v] of [['flower',26],['edibles',68],['vapes',106]])btn('Sell '+k+(i===5?' ×4':' ×1'),()=>{let n=i===5?4:1;if(g[k]<n)return msg('Insufficient cargo');if(!streetCheck()){streetMenu();return}g[k]-=n;g.cash+=v*n+(n===4?40:0);msg('Payment received')})
}
act.onclick=actions;overview.onclick=()=>map=!map;car.onclick=()=>{if(!g.drive&&Math.hypot(g.cx-g.x,g.cy-g.y)>32)return msg('Return to the blue car marker');g.drive=!g.drive;save()};
onkeydown=e=>keys.add(e.key.toLowerCase());onkeyup=e=>keys.delete(e.key.toLowerCase());onblur=()=>{keys.clear();dx=dy=0;save()};
function steer(e){let r=stick.getBoundingClientRect(),x=e.clientX-r.left-50,y=e.clientY-r.top-50,n=Math.max(42,Math.hypot(x,y));dx=x/n;dy=y/n;knob.style.transform='translate('+dx*30+'px,'+dy*30+'px)'}
stick.onpointerdown=e=>{stick.setPointerCapture(e.pointerId);steer(e)};stick.onpointermove=e=>{if(stick.hasPointerCapture(e.pointerId))steer(e)};stick.onlostpointercapture=()=>{dx=dy=0;knob.style.transform=''};
function frame(now){let dt=Math.min(.08,(now-previous)/1000);previous=now;let ux=dx+Number(keys.has('d')||keys.has('arrowright'))-Number(keys.has('a')||keys.has('arrowleft')),uy=dy+Number(keys.has('s')||keys.has('arrowdown'))-Number(keys.has('w')||keys.has('arrowup'));let speed=(g.drive?110+18*b.motor:18)*dt/Math.max(1,Math.hypot(ux,uy));if(panel.hidden){g.x=Math.max(300,Math.min(17800,g.x+ux*speed));g.y=Math.max(500,Math.min(9800,g.y+uy*speed));if(ux||uy)angle=Math.atan2(uy,ux)}if(g.drive){g.cx=g.x;g.cy=g.y}
if(now%1000<dt*1000)save();if(Date.now()-g.last>30000){let sold=Math.min(g.flower,g.crew.length);g.bank+=sold*24;g.flower-=sold;g.last=Date.now()}
near=sites.findIndex(s=>Math.hypot(s[2]-g.x,s[3]-g.y)<55);
businessTick();let w=innerWidth,h=innerHeight;if(world.width!==w||world.height!==h){world.width=w;world.height=h}
let z=map?mapScale():1.5,cx=map?mapCentre[0]:g.x,cy=map?mapCentre[1]:g.y,X=x=>(x-cx)*z+w/2,Y=y=>(y-cy)*z+h/2;
ctx.fillStyle='#465c47';ctx.fillRect(0,0,w,h);let wide=map&&zoom<5,fs=wide?majorFeatures:new Set();if(!wide)for(let x=Math.floor((cx-w/2/z)/500);x<=(cx+w/2/z)/500;x++)for(let y=Math.floor((cy-h/2/z)/500);y<=(cy+h/2/z)/500;y++)for(const f of grid.get(x+','+y)||[])fs.add(f);
for(const [kind,pts] of fs){let major=/motorway|primary|trunk/.test(kind);if(wide&&!major)continue;ctx.beginPath();pts.forEach(([x,y],i)=>i?ctx.lineTo(X(x),Y(y)):ctx.moveTo(X(x),Y(y)));if(kind==='b'){ctx.fillStyle='#937e68';ctx.fill()}else{ctx.strokeStyle=major?'#d7baa0':'#8a8d81';ctx.lineWidth=Math.max(1,(major?11:6)*z);ctx.stroke()}}
function dot(x,y,r,color){ctx.fillStyle=color;ctx.beginPath();ctx.arc(X(x),Y(y),r,0,7);ctx.fill()}
if(map){for(const key of b.blocks){let [bx,by]=key.split(',').map(Number);ctx.fillStyle='#69c99c99';ctx.fillRect(X(bx*450),Y(by*450),450*z,450*z)}dot(workshop[0],workshop[1],5,'#70cdff');let other=b.positions[1-b.active];dot(other[0],other[1],5,'#d496ed')}sites.forEach(([name,,x,y],i)=>{dot(x,y,i===target?8:5,i===target?'#ffcb74':'#e6ede2');ctx.font='bold 12px system-ui';ctx.fillStyle='white';ctx.fillText(name,X(x)+7,Y(y)+(i%2?15:-8))});
ctx.save();ctx.translate(X(g.cx),Y(g.cy));ctx.rotate(angle);ctx.fillStyle='#6bbac1';ctx.fillRect(-9,-5,18,10);ctx.fillStyle='#22333a';ctx.fillRect(1,-4,4,8);ctx.restore();if(!g.drive)dot(g.x,g.y,4,'#ffdd96');
if(waypoint)dot(...waypoint,6,'#ffcb74');let s=waypoint?['Waypoint','',...waypoint]:sites[target],d=Math.hypot(s[2]-g.x,s[3]-g.y),a=Math.atan2(s[3]-g.y,s[2]-g.x);if(!map&&d>55){ctx.save();ctx.translate(w/2+Math.cos(a)*65,h/2+Math.sin(a)*65);ctx.rotate(a);ctx.fillStyle='#ffcb74';ctx.beginPath();ctx.moveTo(9,0);ctx.lineTo(-5,-5);ctx.lineTo(-5,5);ctx.fill();ctx.restore()}
document.getElementById('status').textContent='£'+g.cash+' · '+s[0]+' · '+(d/1000).toFixed(1)+' km';car.textContent=g.drive?'Exit car':'Enter car';if(typeof drawStreets==="function")drawStreets();requestAnimationFrame(frame)}
requestAnimationFrame(frame)
