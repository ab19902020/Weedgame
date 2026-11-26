import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makePlan} from '../../../src/interiorPlan.js';
import {Neighbourhood} from '../../../src/neighbourhood.js';
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
    const area=Object.create(Neighbourhood.prototype);area.G={police:{incidents:[incident]}};area.calls=[];
    area.sendCrew=service=>{area.calls.push({service});return true;};
    for(let i=0;i<40;i++)area.dispatchInjuries(1);
    assert.deepEqual(area.calls.map(c=>c.service),services);
  }
});
