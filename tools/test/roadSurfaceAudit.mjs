// Independent rendered-surface audit. Every drivable edge is sampled at <=8 m intervals
// across its centre and both lanes. All road triangles from every loaded tile are tested
// against a global sample grid (a long deck may be owned by a neighbouring tile).
const CELL = 16, TILE = 256, key = (x,z,s) => Math.floor(x/s)+','+Math.floor(z/s);
export function heightInTriangle(x,z,P,i) {
  const ax=P[i], az=P[i+2], bx=P[i+3], bz=P[i+5], cx=P[i+6], cz=P[i+8];
  const ux=bx-ax, uz=bz-az, vx=cx-ax, vz=cz-az, det=ux*vz-uz*vx;
  if(Math.abs(det)<1e-8) return null;
  const u=((x-ax)*vz-(z-az)*vx)/det, v=(ux*(z-az)-uz*(x-ax))/det;
  if(u < -1e-5 || v < -1e-5 || u+v > 1.00001) return null;
  return P[i+1]+u*(P[i+4]-P[i+1])+v*(P[i+7]-P[i+1]);
}
export class RoadSurfaceAudit {
  constructor(net, keys) {
    this.net=net; this.grid=new Map(); this.keys=new Set(keys.map(k=>k.replace('_',',')));
    this.edges=new Set(); this.samples=0; this.badPoints=[];
    this.gradeIssues=[]; this.endpointIssues=[]; this.tunnels=new Set();
    const P=net.pts, ends=new Map();
    for(let e=0;e<net.nEdges;e++){
      if(!(net.flags[e]&16)) continue;
      const s=net.pstart[e], c=net.pcount[e], width=net.width[e], name=net.roadName(e);
      for(let k=0;k+1<c;k++){
        const a=(s+k)*3,b=a+3, dx=P[b]-P[a], dz=P[b+2]-P[a+2], dy=P[b+1]-P[a+1], l=Math.hypot(dx,dz);
        if(l<0.05) continue;
        const n=Math.ceil(l/8), offsets=width>=3 ? [0,-width*0.25,width*0.25] : [0];
        if(Math.abs(dy/l)>0.15 && this.keys.has(key(P[a],P[a+2],TILE))) this.gradeIssues.push({edge:e,name,grade:dy/l,x:P[a],z:P[a+2]});
        for(let q=0;q<n;q++){
          const t=(q+0.5)/n;
          for(const offset of offsets){
            const x=P[a]+dx*t-dz/l*offset,z=P[a+2]+dz*t+dx/l*offset,y=P[a+1]+dy*t+0.045;
            if(!this.keys.has(key(x,z,TILE))) continue;
            const cell=key(x,z,CELL); let list=this.grid.get(cell); if(!list)this.grid.set(cell,list=[]);
            list.push({x,z,y,e,best:Infinity}); this.samples++; this.edges.add(e);
            if(net.flags[e]&8)this.tunnels.add(e);
          }
        }
      }
      for(const [node,i] of [[net.ea[e],s*3],[net.eb[e],(s+c-1)*3]]){
        if(c<1 || !this.keys.has(key(P[i],P[i+2],TILE))) continue;
        const y=P[i+1]; if(!ends.has(node))ends.set(node,[]); ends.get(node).push({e,y});
      }
    }
    for(const [node,list] of ends){
      const ys=list.map(v=>v.y); if(Math.max(...ys)-Math.min(...ys)>0.35)
        this.endpointIssues.push({node,edges:list,range:Math.max(...ys)-Math.min(...ys)});
    }
  }
  consume(out){
    const G=out.ground; if(!G?.position || !G.extra)return;
    const P=G.position;
    for(let i=0;i+8<P.length;i+=9){
      const surf=G.extra[i/3]; if(surf!==0 && surf!==5)continue;
      const x0=Math.min(P[i],P[i+3],P[i+6])+out.ox,x1=Math.max(P[i],P[i+3],P[i+6])+out.ox;
      const z0=Math.min(P[i+2],P[i+5],P[i+8])+out.oz,z1=Math.max(P[i+2],P[i+5],P[i+8])+out.oz;
      for(let cx=Math.floor(x0/CELL);cx<=Math.floor(x1/CELL);cx++)
        for(let cz=Math.floor(z0/CELL);cz<=Math.floor(z1/CELL);cz++)
          for(const s of this.grid.get(cx+','+cz)||[]){
            if(s.best<0.02||s.x<x0-1e-5||s.x>x1+1e-5||s.z<z0-1e-5||s.z>z1+1e-5)continue;
            const y=heightInTriangle(s.x-out.ox,s.z-out.oz,P,i);
            if(y!==null)s.best=Math.min(s.best,Math.abs(s.y-y));
          }
    }
  }
  report(){
    const net=this.net, badEdges=new Map(), totals={samples:this.samples,edges:this.edges.size,tunnelEdges:this.tunnels.size,
      noSurface:0,heightMismatch:0,gradeCandidates:this.gradeIssues.length,junctionCandidates:this.endpointIssues.length,
      idrSamples:0,idrFailures:0};
    for(const list of this.grid.values())for(const s of list){
      const name=net.roadName(s.e), ref=net.names[net.ref[s.e]]||'';
      const idr=/inner distribution|\bIDR\b/i.test(name)||(/\bA329\b/.test(ref)&&s.x>-8500&&s.x<-6800&&s.z>-3400&&s.z<-1000);
      if(idr)totals.idrSamples++;
      if(s.best<=0.35)continue;
      if(idr)totals.idrFailures++;
      if(Number.isFinite(s.best))totals.heightMismatch++;else totals.noSurface++;
      let row=badEdges.get(s.e);
      if(!row){row={edge:s.e,name,ref,tunnel:!!(net.flags[s.e]&8),bridge:!!(net.flags[s.e]&4),idr,failures:0,missing:0,maxError:0,x:Math.round(s.x),z:Math.round(s.z)};badEdges.set(s.e,row);}
      row.failures++; if(Number.isFinite(s.best))row.maxError=Math.max(row.maxError,s.best);else row.missing++;
    }
    const issues=[...badEdges.values()].sort((a,b)=>Number(b.idr)-Number(a.idr)||b.failures-a.failures);
    return {totals,roadIssues:issues,gradeIssues:this.gradeIssues,junctionIssues:this.endpointIssues};
  }
}
