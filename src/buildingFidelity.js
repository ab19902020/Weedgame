// Stable street architecture. Inferred choices are explicitly not a survey of the real facade.
// Material codes: wall 1 red brick, 2 dark brick, 3 render, 4 pebble dash, 5 buff brick,
// 6 stone, 7 concrete, 8 cladding; roof 1 slate, 2 clay, 3 felt.
// Low 5 bits: wall material; next 3 bits: roof material; bit 8: party wall.
export function frontageScore(distance, alignment, length, blocked, publicSpace=false) {
  return distance + (1-Math.max(0,alignment))*22 + (blocked?70:0) - Math.min(length,12)*0.25 - (publicSpace?5:0);
}
export function buildingStyle({cls, wallH, roof, seed, streetX, streetZ, tagged=0}) {
  const wall=tagged&31, roofMat=(tagged>>5)&7;
  // A terrace or estate is usually built as a group, not a random checkerboard of materials.
  const ix=Math.floor(streetX/96), iz=Math.floor(streetZ/96);
  const group=((Math.imul(ix,73856093)^Math.imul(iz,19349663))>>>0)%100;
  const house=cls===1||cls===2;
  let inferredWall=0,inferredRoof=0;
  if(house){
    inferredWall=cls===2?(group<68?1:group<90?2:3):(group<53?1:group<70?3:group<82?5:group<93?2:4);
    inferredRoof=roof?(cls===2||group<42?1:2):3;
  } else if(cls===4||cls===5){inferredWall=1;inferredRoof=roof?2:3;}
  return {code:(wall||inferredWall)|((roofMat||inferredRoof)<<5), bay:house&&wallH>=2.4&&cls===2&&group<50&&seed%5!==0, hood:house&&cls!==2&&group>=45};
}
// A projected segment in front of a facade, including its direction relative to the outward normal.
export function nearestFrontage(x,z,nx,nz,segments) {
  let best=null,score=Infinity;
  for(let i=0;i<segments.length;i+=5){
    const ax=segments[i],az=segments[i+1],dx=segments[i+2]-ax,dz=segments[i+3]-az;
    const t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1)));
    const qx=ax+dx*t,qz=az+dz*t,d=Math.hypot(qx-x,qz-z);
    const alignment=d>0.01?((qx-x)*nx+(qz-z)*nz)/d:1;
    const cost=d+(1-Math.max(0,alignment))*22;
    if(cost<score){score=cost;best={x:qx,z:qz,d,alignment};}
  }
  return best;
}
