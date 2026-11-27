// Collision samples the same triangles the player sees, rather than a coarse landcover
// classification (which can be on the wrong side of a kerb) or an approximate road width.
const CELL = 16;
export function triangleHeight(P,i,x,z) {
  const ax=P[i],az=P[i+2],ux=P[i+3]-ax,uz=P[i+5]-az,vx=P[i+6]-ax,vz=P[i+8]-az;
  const det=ux*vz-uz*vx; if(Math.abs(det)<1e-8)return null;
  const u=((x-ax)*vz-(z-az)*vx)/det,v=(ux*(z-az)-uz*(x-ax))/det;
  if(u< -1e-5||v< -1e-5||u+v>1.00001)return null;
  return P[i+1]+u*(P[i+4]-P[i+1])+v*(P[i+7]-P[i+1]);
}
export function buildSurfaceIndex(data) {
  const P=data.ground?.position, types=data.ground?.extra, grid=new Map();
  if(!P||!types)return {P,types,grid};
  for(let i=0;i+8<P.length;i+=9){
    const type=types[i/3]; if(![0,1,3,4,5,6].includes(type))continue; // roads, pavements, paths, plazas, road/foot decks
    const x0=Math.min(P[i],P[i+3],P[i+6]),x1=Math.max(P[i],P[i+3],P[i+6]);
    const z0=Math.min(P[i+2],P[i+5],P[i+8]),z1=Math.max(P[i+2],P[i+5],P[i+8]);
    for(let cx=Math.floor(x0/CELL);cx<=Math.floor(x1/CELL);cx++)
      for(let cz=Math.floor(z0/CELL);cz<=Math.floor(z1/CELL);cz++){
        const k=cx*65536+cz;let list=grid.get(k);if(!list)grid.set(k,list=[]);list.push(i);
      }
  }
  return {P,types,grid};
}
export function sampleSurfaces(index,x,z,out) {
  const list=index.grid.get(Math.floor(x/CELL)*65536+Math.floor(z/CELL));
  for(const i of list||[]){
    const y=triangleHeight(index.P,i,x,z);if(y!==null)out.push(y);
  }
}
// Prefer the uppermost surface at the current driving level. Do not climb a flyover
// from the road underneath it, or fall onto a lower level when the deck is still present.
export function chooseSurface(terrain,surfaces,ref) {
  if(!Number.isFinite(ref))return terrain;
  let best=null, distance=Infinity;
  for(const y of surfaces){
    if(!Number.isFinite(y)||y>ref+1.4)continue;
    const d=Math.abs(y-ref);
    if(d<distance){best=y;distance=d;}
  }
  if(!Number.isFinite(terrain))return best;
  if(best===null)return terrain;
  if(Math.abs(terrain-best)<=0.65)return Math.max(terrain,best);
  // A road triangle far below a hillside is not the driving surface unless the
  // vehicle is already on that lower level (e.g. an underpass).
  if(Math.abs(terrain-ref)+0.25<distance)return terrain;
  return best;
}
export function terrainMeshHeight(mesh,x,z) {
  const P=mesh?.position;if(!P)return null;
  const n=Math.round(Math.sqrt(P.length/3));if(n<2||n*n*3!==P.length)return null;
  const step=256/(n-1),gx=Math.max(0,Math.min(n-1.000001,x/step)),gz=Math.max(0,Math.min(n-1.000001,z/step));
  const i=Math.floor(gx),j=Math.floor(gz),u=gx-i,v=gz-j;
  const a=P[(j*n+i)*3+1],b=P[(j*n+i+1)*3+1],c=P[((j+1)*n+i)*3+1],d=P[((j+1)*n+i+1)*3+1];
  return u>=v?a+u*(b-a)+v*(d-b):a+v*(c-a)+u*(d-c);
}
// Contact plane through the actual four wheel positions. A positive residual at a
// wheel or crest raises the chassis instead of averaging that wheel below the surface.
export function wheelPose(fl,fr,rl,rr,centre,a,w,o=0) {
  const pitchSlope=(fl+fr-rl-rr)/(4*a),rollSlope=(fl+rl-fr-rr)/(4*w);
  const pitch=Math.atan(pitchSlope),roll=Math.atan(rollSlope);
  const mid=(fl+fr+rl+rr)/4;
  const residual=Math.max(0,fl-mid-a*pitchSlope-w*rollSlope,fr-mid-a*pitchSlope+w*rollSlope,
    rl-mid+a*pitchSlope-w*rollSlope,rr-mid+a*pitchSlope+w*rollSlope);
  const y=Math.max(mid+residual-o*pitchSlope,Number.isFinite(centre)?centre:-Infinity);
  return {y,pitch,roll,grade:pitchSlope};
}
