// Full-tank fractions use elapsed driving seconds. A full store lasts at least an hour
// under sustained maximum load, and several hours in slower traffic.
export const batteryCapacity = {evsaloon:74,evsuv:82,ebike:.65,escooter:.5};
export const isElectric = model => Object.hasOwn(batteryCapacity,model);
export const isCycle = model => model==='bicycle' || model==='ebike';
export const quietDrive = model => model==='bicycle' || isElectric(model);
export function energyUsed(model,dt,speed,throttle) {
  if (model==='bicycle') return 0;
  const pace=Math.min(1,Math.abs(speed)/(isCycle(model)||model==='escooter'?9:42));
  const load=Math.min(1,Math.abs(throttle));
  const idle=isElectric(model)?0:.035;
  return Math.max(0,dt)*(idle+(1-idle)*(.35*load+.65*pace))/3600;
}
