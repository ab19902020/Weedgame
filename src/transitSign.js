import * as T from 'three/webgpu';

// Canvas signs have stable physical sizes; upload new pixels only when the service changes.
export class TransitSign extends T.Mesh {
  constructor(width,height,led=false){
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
    const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;
    super(new T.PlaneGeometry(width,height),new T.MeshBasicMaterial({map}));
    this.ctx=canvas.getContext('2d');this.led=led;
  }
  write(label,name){
    const key=label+'\n'+name;if(this.key===key)return;this.key=key;
    const c=this.ctx;c.fillStyle=this.led?'#101918':'#0e454b';c.fillRect(0,0,512,128);
    c.fillStyle=this.led?'#ffcc64':'#86ddc4';c.font='bold 26px sans-serif';c.fillText(label,17,34,478);
    c.fillStyle=this.led?'#ffbf45':'#fff9e6';c.font='bold 53px sans-serif';c.fillText(name||'Bus stop',15,99,481);
    c.fillStyle=this.led?'#424136':'#85cdbc';c.fillRect(0,120,512,8);this.material.map.needsUpdate=true;
  }
  dispose(){this.material.map.dispose();this.material.dispose();this.geometry.dispose();}
}
