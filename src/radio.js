// One media element, no decoded album in memory (the playing track is held compressed, see load()). Independent per-device tuning,
// shared resume points for the stations. Assets are local to www/radio in the APK.
// Tracks: [title, file in www/radio, gain]. The gains even out the loudness (songs to about -14 LUFS, the talk to -15,
// measured with ffmpeg's EBU R128 meter), so changing track or station doesn't jump in volume.
export const STATIONS=[
  {id:'music',name:'United Road FM',icon:'♫',kind:'MUSIC',tracks:[
    ['The United Road (2026 Studio Remaster)','the-united-road.mp3',0.68],['Feel It','feel-it.mp3',1.22],
    ['Manchester Is Red (UK Trap Remix)','manchester-trap.mp3',0.99],['Red Devil (Take Me Home, United Road)','red-devil.mp3',0.88],
    ['National Anthem','national-anthem.mp3',1.16],['Rashford Is Red (Remix)','rashford-remix.mp3',0.9],
    ['Under My Skin','under-my-skin.mp3',1.2],['Manchester Is Red (Remastered)','manchester-is-red.mp3',0.92],
    ['Magic (Remix)','magic.mp3',1.35],['Oh Ah Cantona','oh-ah-cantona.mp3',1.07],
    ['Still Holding','still-holding.mp3',1.17],['Manchester Red (Remastered)','manchester-red.mp3',0.95],
    ['Red Side Indie Anthem (Remix)','red-side.mp3',0.92],['The Wolves (Remix)','the-wolves.mp3',1.16],
    ['Don\'t Tap the Glass','dont-tap-glass.mp3',1.19]]},
  {id:'podcast',name:'Green County Talk',icon:'◉',kind:'PODCAST',tracks:[['Theo Von – Childhood Stories','theo-von.m4a',1.32]]},
  {id:'off',name:'Radio off',icon:'⏻',kind:'OFF',tracks:[]}
];
export function stationFromStick(x,y){if(Math.hypot(x,y)<.4)return null;return x<-.35?'off':y<0?'music':'podcast';}
export function nextTrack(index,count,dir=1){return count?((index+dir)%count+count)%count:0;}
export class GameRadio {
  constructor(G){
    this.G=G;this.devices=new Map();this.resume={music:{index:0,time:0},podcast:{index:0,time:0}};
    this.context=null;this.current='off';this.selected='off';this.volume=.55;this.opened=false;
    this.audio=new Audio();this.audio.preload='metadata';this.audio.volume=this.volume;
    this.audio.addEventListener('ended',()=>{if(this.current!=='off')this.skip(1);});
    this.audio.addEventListener('error',()=>{this.status='Audio unavailable — install the radio asset pack';this.refresh();});
    this.audio.addEventListener('timeupdate',()=>this.refreshProgress());
    this.audio.addEventListener('loadedmetadata',()=>{const p=this.resume[this.current];if(p&&p.time>0)this.audio.currentTime=Math.min(p.time,Math.max(0,this.audio.duration-.2));this.refreshProgress();});
    const style=document.createElement('style');style.textContent=`
      #gcRadioButton{position:fixed;z-index:35;left:50%;top:12px;transform:translateX(-50%);padding:8px 14px;border:1px solid #ffffff50;border-radius:18px;background:#10151ddd;color:white;font:600 12px system-ui;max-width:38vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:auto}
      #gcRadioWheel{position:fixed;inset:0;z-index:900;display:flex;align-items:center;justify-content:center;background:#070b13a8;pointer-events:auto;touch-action:none;font:14px system-ui;color:#fff}
      #gcRadioWheel[hidden],#gcRadioButton[hidden]{display:none!important}
      #gcRadioWheel .radio-card{width:min(94vw,480px);max-height:94vh;overflow:auto;text-align:center;padding:10px;box-sizing:border-box}
      #gcRadioWheel .radio-ring{width:min(62vw,52vh,280px);aspect-ratio:1;position:relative;margin:7px auto;border-radius:50%;background:conic-gradient(from 0deg,#2d4057 0 120deg,#182938 120deg 240deg,#263348 240deg 360deg);border:2px solid #a6b8c877;box-shadow:0 0 40px #0008}
      #gcRadioWheel .station{position:absolute;display:grid;justify-items:center;gap:3px;width:42%;padding:8px 3px;background:#101720da;border:1px solid #ffffff50;border-radius:13px;color:white;font:600 11px system-ui;transform:translate(-50%,-50%)}
      #gcRadioWheel .station strong{font-size:26px}#gcRadioWheel .station.on{background:#e7b958;color:#18202b;border-color:#fff}
      #gcRadioWheel .centre{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:11px;max-width:37%;color:#e8edf3}
      #gcRadioWheel .radio-transport{display:flex;justify-content:center;gap:7px;margin:8px 0;flex-wrap:wrap}
      #gcRadioWheel .radio-transport button,#gcRadioWheel .radio-close{background:#25364a;color:white;border:1px solid #ffffff40;border-radius:8px;padding:9px 13px;font:600 12px system-ui}
      #gcRadioWheel progress{width:80%;height:5px;accent-color:#e7b958}#gcRadioWheel .radio-meta{font-size:12px;color:#b6c3d2;margin:5px}
      #gcRadioWheel h2{font-size:18px;margin:2px}#gcRadioWheel .radio-track{min-height:2em;font-weight:600}#gcRadioWheel label{display:flex;align-items:center;justify-content:center;gap:8px;font-size:12px}
      `;document.head.append(style);
    this.button=document.createElement('button');this.button.id='gcRadioButton';this.button.hidden=true;this.button.textContent='♫ Radio';this.button.onclick=()=>this.toggle();document.body.append(this.button);
    this.el=document.createElement('div');this.el.id='gcRadioWheel';this.el.hidden=true;this.el.setAttribute('role','dialog');this.el.setAttribute('aria-label','Radio station wheel');
    this.el.innerHTML=`<div class="radio-card"><h2>GREEN COUNTY RADIO</h2><div class="radio-ring"><button class="station" data-id="music" style="left:69%;top:21%"><strong>♫</strong>United Road FM</button><button class="station" data-id="podcast" style="left:69%;top:79%"><strong>◉</strong>Green County Talk</button><button class="station" data-id="off" style="left:17%;top:50%"><strong>⏻</strong>Off</button><span class="centre">SELECT STATION</span></div><div class="radio-track"></div><progress max="1" value="0"></progress><div class="radio-meta"></div><div class="radio-transport"><button data-action="prev">⏮ Previous</button><button data-action="pause">Pause / play</button><button data-action="next">Next ⏭</button></div><label>Volume <input type="range" min="0" max="1" step=".05" value=".55"></label><div class="radio-meta">D-pad / right stick • Cross select • Circle close</div><button class="radio-close">Close</button></div>`;
    this.el.querySelectorAll('.station').forEach(b=>b.onclick=()=>this.tune(b.dataset.id));
    this.el.querySelector('[data-action=prev]').onclick=()=>this.skip(-1);
    this.el.querySelector('[data-action=next]').onclick=()=>this.skip(1);
    this.el.querySelector('[data-action=pause]').onclick=()=>this.pauseToggle();
    this.el.querySelector('.radio-close').onclick=()=>this.close();
    this.el.querySelector('input').oninput=e=>{this.volume=Number(e.target.value);this.setVolume();};
    document.body.append(this.el);
    addEventListener('keydown',e=>{if(e.repeat)return;if(e.code==='KeyU'&&!e.target.closest?.('input,textarea,select')){e.preventDefault();this.toggle();}else if(this.opened&&e.code==='Escape'){this.close();}});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){this.audio.pause();}else if(this.context&&!this.manualPause)this.play();});
  }
  device(){const me=this.G.brothers?.me;if(!me)return null;if(me.vehicle){const v=this.G.brothers.vehicleOf(me);return v&&v.def?.wheels!==2?'car:'+v.id:null;}
    const IN=this.G.interiors?.at(me);return IN?.plan?.items?.some(i=>i.type==='radio')?'home:'+IN.site.id:null;}
  savePosition(){const p=this.resume[this.current];if(p&&Number.isFinite(this.audio.currentTime)&&!this.audio.error&&this.audio.readyState>0)p.time=this.audio.currentTime;}
  setContext(key){if(key===this.context)return;this.savePosition();this.audio.pause();this.close();this.context=key;this.manualPause=false;this.current='off';if(key){const id=this.devices.get(key)||'off';this.tune(id);}else this.refresh();}
  update(){this.setContext(this.device());const blocked=!this.G.hud.menu.el.hidden||!this.G.hud.el('map').hidden||!this.G.hud.el('dev').hidden||this.G.hud.wheelOpen||this.G.interiors?.homeTV?.seated||this.G.interiors?.games?.open||document.hidden;
    this.blocked=blocked;this.button.hidden=!this.context||blocked;if(blocked&&this.opened)this.close();
    if(this.context?.startsWith('home:')){const me=this.G.brothers.me,IN=this.G.interiors.at(me),it=IN?.plan.items.find(i=>i.type==='radio');if(it){const [x,z]=this.G.interiors.toLocal(IN.site,me.x,me.z);this.attenuation=Math.max(.12,1-Math.hypot(x-it.x,z-it.y)/13);}}else this.attenuation=1;
    this.setVolume();
  }
  setVolume(){const s=STATIONS.find(s=>s.id===this.current),p=this.resume[this.current],t=s&&p?s.tracks[p.index]:null;this.audio.volume=Math.max(0,Math.min(1,this.volume*(this.attenuation??1)*(t?.[2]??1)));}
  toggle(){if(this.opened)this.close();else if(!this.blocked&&this.device()){this.setContext(this.device());this.opened=true;this.selected=this.current;this.el.hidden=false;this.G.input.release();this.G.input.keys.clear();this.G.input.held.clear();this.G.input.pressed.clear();this.refresh();}}
  close(){if(this.opened){this.G.input.release();this.G.input.pressed.clear();this.G.input.keys.clear();this.G.input.held.clear();}this.opened=false;this.el.hidden=true;}
  select(id){if(STATIONS.some(s=>s.id===id)){this.selected=id;this.refresh();}}
  step(dir){const i=STATIONS.findIndex(s=>s.id===this.selected);this.select(STATIONS[nextTrack(i,STATIONS.length,dir)].id);}
  tune(id){if(!this.context||!STATIONS.some(s=>s.id===id))return;if(id===this.current&&id!=='off'){this.manualPause=false;this.play();this.refresh();return;}this.savePosition();this.audio.pause();this.current=id;this.selected=id;this.devices.set(this.context,id);this.manualPause=false;this.status='';if(id!=='off')this.load();this.refresh();}
  // The phone's asset server (Main.java) can't serve part of a file, and a media element can't seek in a file served
  // whole: each track is read into memory first (a few MB; compressed, not decoded) and played from there, so
  // resuming part-way through and the podcast's back-30-seconds work. Missing files fall back to the plain URL, which
  // fails into the "install the radio asset pack" message.
  load(){const s=STATIONS.find(s=>s.id===this.current),p=this.resume[this.current];if(!s?.tracks.length||!p)return;
    const f=s.tracks[p.index][1],file=f.includes('.')?f:f+'.m4a',url='radio/'+file,tok=this.loadTok=(this.loadTok||0)+1;
    const type=file.endsWith('.mp3')?'audio/mpeg':'audio/mp4';
    const start=src=>{if(tok!==this.loadTok)return;this.audio.src=src;this.setVolume();this.play();};
    fetch(url).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.blob();}).then(b=>{if(tok!==this.loadTok)return;if(this.blobUrl)URL.revokeObjectURL(this.blobUrl);this.blobUrl=URL.createObjectURL(b.type===type?b:new Blob([b],{type}));start(this.blobUrl);}).catch(()=>start(url));}
  play(){if(this.current==='off'||!this.context||this.manualPause||document.hidden)return;this.audio.play().catch(()=>{this.status='Press Play to start audio';this.refresh();});}
  pauseToggle(){if(this.current==='off')return;if(this.audio.paused){this.manualPause=false;this.play();}else{this.manualPause=true;this.audio.pause();}this.refresh();}
  skip(dir){const s=STATIONS.find(s=>s.id===this.current),p=this.resume[this.current];if(!s?.tracks.length||!p)return;
    if(s.id==='podcast'&&dir<0&&this.audio.readyState>0){this.audio.currentTime=Math.max(0,this.audio.currentTime-30);return;}
    p.index=nextTrack(p.index,s.tracks.length,dir);p.time=0;this.manualPause=false;this.status='';this.load();this.refresh();}
  refresh(){const s=STATIONS.find(s=>s.id===this.current),p=this.resume[this.current];this.button.textContent=s.id==='off'?'♫ Radio':'♫ '+s.name;
    this.el.querySelectorAll('.station').forEach(b=>{b.classList.toggle('on',b.dataset.id===this.selected);b.setAttribute('aria-pressed',String(b.dataset.id===this.current));});
    this.el.querySelector('.radio-track').textContent=p?s.tracks[p.index][0]:'Radio off';
    this.el.querySelector('.radio-meta').textContent=this.status||s.kind+(p?' • '+(p.index+1)+' / '+s.tracks.length:'');this.refreshProgress();}
  refreshProgress(){this.el.querySelector('progress').value=this.current!=='off'&&Number.isFinite(this.audio.duration)&&this.audio.duration>0?this.audio.currentTime/this.audio.duration:0;}
}
