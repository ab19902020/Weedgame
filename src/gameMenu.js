const key='green-county-interface-v1';
const choices={
  orientation:['Minimap orientation','Heading up','North up'],
  size:['Minimap size','Standard','Compact','Large'],
  colour:['Route colour','Mint','Amber','Blue'],
  steering:['Steering (touch)','Steering wheel','Buttons','Tilt'],
  handling:['Handling','Easy (assists on)','Realistic (fewer assists)'],
  wildlife:['Wildlife','Plenty','Realistic'],
  buttons:['Touch button size','Standard','Large','Compact']
};
export class GameMenu {
  constructor(hud) {
    this.hud=hud;
    try { this.settings=JSON.parse(localStorage.getItem(key)) || {}; } catch { this.settings={}; }
    // (the steering options' old names)
    this.settings.steering=({'Drag wheel':'Steering wheel','Arrow buttons':'Buttons'})[this.settings.steering]||this.settings.steering;
    const menu=this.el=document.createElement('section');
    menu.id='countyMenu';menu.setAttribute('aria-label','Green County menu');
    menu.innerHTML=`<div class="menuContent"><small>BERKSHIRE · ENGLAND</small><h1>Green<br>County</h1><nav><button data-go="play">Enter free roam ↗</button><button data-go="atlas">Road Atlas</button><button data-go="settings">Settings</button></nav><section class="preferences" hidden><h2>Settings</h2></section></div>`;
    document.body.append(menu);
    const prefs=menu.querySelector('.preferences');
    for(const [id,[label,...values]] of Object.entries(choices)){
      const field=document.createElement('label'), select=document.createElement('select');
      field.append(label,select);prefs.append(field);
      values.forEach(v=>select.add(new Option(v,v)));
      select.value=values.includes(this.settings[id])?this.settings[id]:values[0];
      select.onchange=()=>{this.settings[id]=select.value;this.apply();try{localStorage.setItem(key,JSON.stringify(this.settings));}catch{}};
    }
    const credits = document.createElement('a');
    credits.textContent = 'Sound recording credits';
    credits.href = 'sfx/CREDITS.txt';
    credits.target = '_blank';
    credits.rel = 'noopener';
    credits.style.color = 'inherit';
    prefs.append(credits);
    const back=document.createElement('button'); back.textContent='Back';prefs.append(back);
    const page=settings=>{prefs.hidden=!settings;menu.querySelector('nav').hidden=settings;};
    back.onclick=()=>page(false);
    menu.querySelector('nav').onclick=e=>{
      const action=e.target.dataset.go;
      if(action==='settings'){page(true);return;}
      if(!action)return;
      this.close();if(action==='atlas')hud.toggleMap(true);
    };
    hud.el('bMenu').onclick=()=>this.open();
    addEventListener('keydown',e=>{
      if(e.key==='Escape'&&!e.repeat){
        if(!menu.hidden && !prefs.hidden)page(false);
        else if(!hud.el('map').hidden)hud.toggleMap(false);
        else if(menu.hidden)this.open();else this.close();
      }
    });
    this.apply();this.open();
  }
  apply(){
    this.hud.nav.colour=({Amber:'#ffbd4a',Blue:'#79bdff'})[this.settings.colour] || '#5df4c2';
    document.documentElement.style.setProperty('--mini-size',({Compact:'112px',Large:'174px'})[this.settings.size] || '150px');
    document.documentElement.style.setProperty('--u',({Large:'1.18',Compact:'.84'})[this.settings.buttons] || '1');
    if(this.settings.steering==='Tilt'){try{this.hud.G.input.calibrateTilt();}catch{}}
  }
  resetInput(){const i=this.hud.G.input;i.release();i.keys.clear();i.pressed.clear();i.held.clear();}
  open(){this.resetInput();this.el.hidden=false;this.el.querySelector('nav button').focus();}
  close(){this.resetInput();this.el.hidden=true;this.el.querySelector('[data-go="play"]').textContent='Resume free roam ↗';}
}
