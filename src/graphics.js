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
  // a preset that asks for more than 60 (low: 120) gets what the screen can show
  if (preset > 60) return device.hz >= 119 ? 120 : device.hz >= 89 ? 90 : 60;
  if (device.mode === 'performance' && device.hz >= 89) return device.hz >= 119 ? 120 : 90;
  return 60;
}
// The controller runs once per three-second window of actual rendered frames.
// v0.36: it never drops below 60 (a 30/60 flip-flop is the worst kind of judder; Low and Medium are 60 fps
// presets, High asks for 30 itself), lowers the internal resolution only after two slow windows in a row, and
// tries a higher frame rate (120 on Low) once: if that doesn't hold it stays where it was for the session instead
// of trying again every 20 seconds.
export function tuneGraphics(state, ms, target, current, low, high, increment) {
  const budget = 1000 / state.fps;
  if (ms > budget*1.15) {
    state.quiet = 0; state.slow = (state.slow || 0) + 1;
    if (state.fps > 60 && state.fps > (state.floor || 0)) { state.fps = 60; state.noProbe = true; state.slow = 0; return current; }
    if (state.slow >= 2 && current > low+.01) { state.slow = 0; return Math.max(low,current-increment); }
    if (state.fps < 60 && target < 60) state.fps = target;
  } else if (ms <= budget*1.05) {
    state.quiet++; state.slow = 0;
    if (state.fps < target && !state.noProbe && state.quiet >= 6) {
      state.fps = target; state.quiet = 0;
    } else if (state.fps >= Math.min(target, 60) && state.quiet >= 3 && current < high-.01) {
      state.quiet = 0; return Math.min(high,current+increment/2);
    }
  } else { state.quiet = 0; state.slow = 0; }
  return current;
}
