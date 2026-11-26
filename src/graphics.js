// Auto uses the Android host's public hardware and Game Mode information, when available.
export const presets = ['auto','low','medium','high'];
export const preferenceKey = 'greenCounty.graphics';
export function deviceProfile(host = globalThis.GCNative) {
  return { mode:host?.gameMode?.() || 'unavailable', chip:host?.chipset?.() || '', hz:Number(host?.refreshRate?.()) || 60 };
}
export function qualityFor(choice, device, touch) {
  if (presets.includes(choice) && choice !== 'auto') return choice;
  if (device.mode === 'battery') return 'low';
  if (!touch || device.mode === 'performance' || /SM(?:8750|8850)|Snapdragon.*8.*Elite/i.test(device.chip)) return 'high';
  return 'medium';
}
// preset: the quality preset's own target (high is a 30 fps preset: the richest image, held steady)
export function frameTarget(device, requested, preset = 60) {
  if (device.mode === 'battery') return 30;
  if (Number(requested)>0) return Math.max(15,Math.min(144,Number(requested)));
  if (preset < 60) return preset;
  if (device.mode === 'performance' && device.hz >= 89) return device.hz >= 119 ? 120 : 90;
  return 60;
}
// The controller runs once per three-second window of actual rendered frames.
// Vsync hides spare GPU time. Probe a higher target after a stable capped interval.
export function tuneGraphics(state, ms, target, current, low, high, increment) {
  const budget = 1000 / state.fps;
  if (ms > budget*1.15) {
    state.quiet = 0;
    if (current > low+.01) return Math.max(low,current-increment);
    state.fps = state.fps > 60 ? 60 : Math.min(state.fps,30);
  } else if (ms <= budget*1.05) {
    state.quiet++;
    if (state.fps < target && state.quiet >= 6) {
      state.fps = Math.min(target,state.fps < 60 ? 60 : target); state.quiet = 0;
    } else if (state.fps === target && state.quiet >= 2 && current < high-.01) {
      state.quiet = 0; return Math.min(high,current+increment/2);
    }
  } else state.quiet = 0;
  return current;
}
