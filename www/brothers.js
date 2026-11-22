// Shared business state. Each brother keeps his own position when the player switches.
const names=['Cal Ward','Leon Ward'],friends=['Ash','Mo'],seeds=['Kennet Lime','Loddon Plum','Ember Mint'];
const lines={light:['Salvaged lamp','Reflector hood','LED board','LED array','Zoned lighting'],water:['Watering can','Wick bed','Drip feed','Deep-water tanks','Recirculating system'],room:['Garage shelf','Grow bench','Twin racks','Climate cabinet','Automated room']};
const b=g.business??={active:0,positions:[[start[2],start[3]],[start[2]+14,start[3]+5]],friends:[true,true],blocks:[],light:0,water:0,room:0,paint:0x812f42,motor:0,rack:0,stock:{},strains:{},crop:null,call:null,next:0,jobs:0,rival:null};
const scenes=[
 ['Ash','Cal, Leon says the shutter finally opens. I promised someone in Earley the first batch. You two still in?'],
 ['Leon','I spent our last spare cash fixing that car. Meet the buyer at Cemetery Junction and bring something back for the garage.'],
 ['Mo','Reading wants a sample. Ash reckons the brothers can supply a second block. Time to find out.'],
 ['Cal','There’s room to expand in Winnersh. Take this order while I look at the unit.'],
 ['Ash','Bracknell called. Remember when we had one shelf between four of us? They want a regular delivery.']
];
const blockKey=()=>Math.floor(g.x/450)+','+Math.floor(g.y/450);
function district(){return sites.reduce((best,s)=>Math.hypot(s[2]-g.x,s[3]-g.y)<Math.hypot(best[2]-g.x,best[3]-g.y)?s:best)}
function switchBrother(i){if(i===b.active)return; b.positions[b.active]=[g.x,g.y];g.drive=false;b.active=i;[g.x,g.y]=b.positions[i];panel.hidden=true;document.body?.animate?.([{opacity:.3},{opacity:1}],{duration:400});msg(names[i]+' · '+district()[0]);save()}
function switcher(){let ui=sheet('The Ward brothers');names.forEach((n,i)=>ui.button(n+(i===b.active?' • Playing':' • Switch'),()=>switchBrother(i)))}
function sheet(title){panel.replaceChildren();panel.hidden=false;let head=document.createElement('h3');head.textContent=title;panel.append(head);
function button(t,fn){let el=document.createElement('button');el.textContent=t;el.onclick=()=>{fn();save()};panel.append(el)}
function line(t){let el=document.createElement('p');el.textContent=t;panel.append(el)}button('Close ×',()=>panel.hidden=true);return {button,line}}
function buy(cost,fn){if(g.cash<cost){msg('Need £'+cost);return}g.cash-=cost;fn()}
function ring(){if(!b.call&&Date.now()>=b.next){let i=b.jobs%5+1;b.call={i,accepted:false};msg('Incoming call · '+(scenes[b.jobs%5][0])+' · open Phone')}}
function phoneMenu(){let u=sheet('Phone · '+names[b.active]);ring();if(b.call){let c=b.call;if(c.accepted)u.line(scenes[b.jobs%5][1]);u.line((c.accepted?'Active order':'Incoming call')+' · '+sites[c.i][0]+' · two flower for £80');u.button(c.accepted?'Show destination':'Answer call',()=>{c.accepted=true;target=c.i;waypoint=null;phoneMenu();msg('“Meet me in '+sites[c.i][0]+'. Bring two.”')});
if(c.accepted&&near===c.i)u.button('Complete order',()=>{if(g.flower<2)return msg('Need two flower');if(!streetCheck())return;g.flower-=2;g.cash+=80;b.jobs++;b.call=null;b.next=Date.now()+45000;phoneMenu();msg('Order complete · £80')})}
u.line('Crew');friends.forEach((n,i)=>u.button(n+(b.friends[i]?' • Following':' • At garage'),()=>{b.friends[i]=!b.friends[i];phoneMenu()}));u.line('Story · '+(b.jobs===0?'First favour':b.jobs<3?'The brothers build a name':'Regulars across Berkshire')+' · '+b.jobs+' orders complete');u.button('Street business',streetMenu);u.button('Brothers',switcher)}
function streetCheck(){if(b.blocks.includes(blockKey()))return true;if(b.rival||Math.random()<.55){b.rival={x:g.x+9,y:g.y+6};msg('Local crew intercepted the sale. Open Street to face them or move away.');return false}return true}
function streetMenu(){let u=sheet(district()[0]+' · street');let k=blockKey();u.line(b.blocks.includes(k)?'Your block · protected sales':'Rival block · contested sales');if(b.rival){u.button('Stand with crew',()=>{let ok=Math.random()<.35+.27*b.friends.filter(Boolean).length;b.rival=null;if(ok){if(!b.blocks.includes(k))b.blocks.push(k);msg('Your crew took this block')}else{g.cash=Math.max(0,g.cash-35);msg('Driven back · lost £35')}streetMenu()});u.button('Back off',()=>{b.rival=null;panel.hidden=true});return}
function trade(name,qty,value,take){if(qty<1)return msg('No stock');if(streetCheck()){take();g.cash+=value;msg('Sold '+name+' · £'+value)}streetMenu()}
u.button('Sell flower £26',()=>trade('flower',g.flower,26,()=>g.flower--));for(const [s,n] of Object.entries(b.stock))if(n)u.button(s+' ×'+n+' · £'+b.strains[s],()=>trade(s,n,b.strains[s],()=>b.stock[s]--));
if(!b.blocks.includes(k))u.button('Challenge local crew',()=>{b.rival={x:g.x+8,y:g.y};streetMenu()})}
function garage(){let u=sheet('Woodley · grow room');if(near!==0){u.line('Return to your Woodley garage to use the grow room.');return}for(const [key,tiers] of Object.entries(lines)){let level=b[key];u.line(tiers[level]);if(level<tiers.length-1){let cost=70*(level+1)**2;u.button(tiers[level+1]+' · £'+cost,()=>buy(cost,()=>{b[key]++;garage()}))}}
if(b.crop){let c=b.crop;u.button(Date.now()>=c.time?'Harvest '+c.name:'Check crop · '+c.name,()=>{if(Date.now()<c.time)return msg('Ready in '+Math.ceil((c.time-Date.now())/1000)+'s');b.stock[c.name]=(b.stock[c.name]||0)+c.yield;b.crop=null;garage();msg('Harvest packed for street sales')});return}
u.line('Cross two fictional parent lines');let parents=[0,1].map(()=>{let sel=document.createElement('select');for(const n of seeds){let opt=document.createElement('option');opt.textContent=n;sel.append(opt)}return sel});parents[1].selectedIndex=1;parents.forEach(p=>u.line('')||panel.append(p));u.button('Start cross · £15',()=>{if(parents[0].value===parents[1].value)return msg('Choose two different lines');buy(15,()=>{let rare=Math.random()<.12+.06*b.light,n=parents[0].value.split(' ')[1]+' '+parents[1].value.split(' ')[1]+(rare?' Reserve':'');b.strains[n]=rare?98:48;b.crop={name:n,time:Date.now()+1000*(35-5*b.water),yield:2+b.room};garage()})})}
const workshop=[sites[4][2]+85,sites[4][3]+35];
function tuning(){let u=sheet('Winnersh · Motor Works');if(Math.hypot(g.cx-workshop[0],g.cy-workshop[1])>65||Math.hypot(g.x-workshop[0],g.y-workshop[1])>65){u.line('Bring the hatchback to the blue workshop marker, east of the Winnersh unit.');target=4;waypoint=[...workshop];return}
for(const [label,c] of [['Oxblood',0x812f42],['British racing green',0x174936],['Midnight blue',0x223e69]])u.button(label+' £30',()=>buy(30,()=>{b.paint=c;tuning()}));if(b.motor<3)u.button('Engine stage '+(b.motor+1)+' £150',()=>buy(150,()=>{b.motor++;tuning()}))}
function businessTick(){ring();if(b.rival&&Math.hypot(g.x-b.rival.x,g.y-b.rival.y)>65)b.rival=null}
let mapCentre=[9250,5000],zoom=1,drag=null,waypoint=null;
function mapScale(){return Math.min(innerWidth/18500,innerHeight/10000)*zoom}
overview.onclick=()=>{map=!map;panel.hidden=true;maptools.hidden=!map};
world.onpointerdown=e=>{if(!map)return;drag={x:e.clientX,y:e.clientY,c:[...mapCentre]};world.setPointerCapture(e.pointerId)};
world.onpointermove=e=>{if(!drag)return;mapCentre=[drag.c[0]-(e.clientX-drag.x)/mapScale(),drag.c[1]-(e.clientY-drag.y)/mapScale()]};
world.onpointerup=e=>{if(!drag)return;if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<7){waypoint=[mapCentre[0]+(e.clientX-innerWidth/2)/mapScale(),mapCentre[1]+(e.clientY-innerHeight/2)/mapScale()];msg('Custom waypoint set')}drag=null};world.onpointercancel=()=>drag=null;
