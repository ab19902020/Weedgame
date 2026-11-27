import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makePlan} from '../../../src/interiorPlan.js';
import {Emergency} from '../../../src/emergency.js';
import {Police} from '../../../src/police.js';

test('the mapped Woodley home has three bedrooms and a furnished TV room',()=>{
  const {sites}=JSON.parse(readFileSync(new URL('../../../www/world/interiors.json',import.meta.url)));
  const home=sites.find(s=>s.id===2 && s.district==='Woodley');
  const plan=makePlan({...home,brothersHome:true});
  assert.equal(plan.levels[1].rooms.filter(r=>/^bed/.test(r.name)).length,3);
  for(const type of ['sofaL','tv','tvunit','units','box'])assert.ok(plan.items.some(it=>it.type===type),type);
});

test('dispatch distinguishes a shunt, an injury and a trapped occupant and avoids duplicate crews',()=>{
  for(const [speed,services] of [[5,[]],[12,['ambulance']],[25,['ambulance','fire']]]){
    const law=Object.create(Police.prototype);
    law.G={peds:{list:[]}};let incident;
    law.createIncident=(type,x,z,parties,opts)=>(incident={...opts,status:'reported'});
    law.onVehicleHit({by:{id:'a'},other:{id:'b',kind:'traffic',def:{W:2}},speed});
    const area=Object.create(Emergency.prototype);area.G={police:{incidents:[incident]}};area.calls=[];
    area.sendCrew=service=>{area.calls.push({service});return true;};
    for(let i=0;i<40;i++)area.dispatchInjuries(1);
    assert.deepEqual(area.calls.map(c=>c.service),services);
  }
});

test('someone shot down or knocked out gets an ambulance call of their own, without the police',()=>{
  const made=[];const area=Object.create(Emergency.prototype);
  area.G={police:{createIncident:(type,x,z,parties,opts)=>{made.push({type,...opts});}}};
  const hurt={x:1,z:2},dead={x:0,z:0,dead:true};
  area.casualty(hurt,'Shooting · one injured');area.casualty(hurt,'again');area.casualty(dead,'x');
  assert.equal(made.length,1);
  assert.equal(made[0].medical,true);assert.equal(made[0].patient,hurt);assert.equal(hurt.awaitingMedic,true);
  const law=Object.create(Police.prototype);law.G={hud:{feed(){}},roadName:()=>'Test Road'};law.G.hud.feed=()=>{};
  const inc={medical:true,status:'new',t:0,callAt:5,injury:true};
  for(let i=0;i<8;i++)law.updateIncident(inc,1);
  assert.equal(inc.status,'reported');assert.equal(inc.unit,undefined);
  inc.medicalBusy=true;inc.medicalDone=true;law.updateIncident(inc,1);assert.equal(inc.status,'reported');
  inc.medicalBusy=false;law.updateIncident(inc,1);assert.equal(inc.status,'cleared');
});

test('a stretcher goes round the ambulance, not through it',()=>{
  const area=Object.create(Emergency.prototype);
  const v={x:0,z:0,heading:0,def:{L:6,W:2.2}};
  // from the cab door on the left down that side: nothing in the way
  assert.equal(area.around(v,1.3,-1.6,-2.5,-1.7),null);
  // to the back doors: by the back corner on that side (straight there would clip the tail)
  assert.deepEqual(area.around(v,1.3,-1.6,-3.6,-0.55).map(x=>+x.toFixed(2)),[-3.45,-1.55]);
  assert.equal(area.around(v,-3.45,-1.55,-3.6,-0.55),null);
  // from the right-hand door to a spot on the far side behind: via the near corner at the back
  const via=area.around(v,1.3,1.6,-3.5,-2.5);
  assert.ok(via,'needs a waypoint');
  assert.ok(via[0]<-3 && via[1]>1.4,'the back right corner: '+via);
  // straight through from front to back: round a side
  const thru=area.around(v,4.5,0,-4.5,0);
  assert.ok(thru && Math.abs(thru[1])>1.4);
});

test('a crew member walks round the back of the engine to the far side without dithering at a corner',()=>{
  const area=Object.create(Emergency.prototype);
  area.G={tiles:{ground:()=>null}};
  const v={x:10,z:-4,heading:0.7,def:{L:8,W:2.5}};
  // from the rear-left corner, making for the right-hand side by the back: the rear-right corner next, not the front
  const c=Math.cos(v.heading),s=Math.sin(v.heading),at=(lx,lz)=>[v.x+c*lx-s*lz,v.z+s*lx+c*lz];
  const [sx,sz]=at(-4.45,-1.7),[tx,tz]=at(-3.5,1.85);
  const via=area.around(v,sx,sz,tx,tz),[vx,vz]=[(via[0]-v.x)*c+(via[1]-v.z)*s,-(via[0]-v.x)*s+(via[1]-v.z)*c];
  assert.ok(vx<-4 && vz>1.6,'rear-right corner, got '+[vx.toFixed(2),vz.toFixed(2)]);
  // walked there from the cab door on the other side: it gets there, and never through the engine
  const [dx,dz]=at(1.8,-1.7),p={x:dx,z:dz,y:0,heading:0,phase:0,t:0};
  let steps=0;while(!area.walk(p,tx,tz,0.1,1.8,v)&&steps<400){steps++;
    const lx=(p.x-v.x)*c+(p.z-v.z)*s,lz=-(p.x-v.x)*s+(p.z-v.z)*c;assert.ok(Math.abs(lx)>4.1||Math.abs(lz)>1.3,'inside the engine at '+[lx,lz]);}
  assert.ok(steps<120,'took '+steps+' steps');
});

test('walk straight through the brothers’ lounge from the front door to the kitchen', () => {
  const {sites} = JSON.parse(readFileSync(new URL('../../../www/world/interiors.json',import.meta.url)));
  const home = sites.find(s => s.id === 2);
  const p = makePlan({...home, brothersHome:true});
  const lounge = p.find(p.levels[0], 'living');
  assert.ok(home.doorX > lounge.x0 && home.doorX < lounge.x1);
  assert.equal(p.exit.x, home.doorX);
  for (let y = 0.4; y < lounge.y1 + 0.9; y += 0.05) {
    for (const offset of [-0.3, 0, 0.3]) {
      const x = p.exit.x + offset;
      const [actualX, actualY] = p.collide(x,y,0.32,0);
      assert.ok(Math.hypot(actualX-x, actualY-y) < 0.001, 'Blocked at '+[x,y]);
    }
  }
});
