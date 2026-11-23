// Merge a targeted re-run (ONLY=...) into the main acceptance log. Replaced steps keep the
// original result under `firstAttempt` and are marked with the re-run time and reason.
// Usage: node tools/test/merge-rerun.js docs/captures <rerunDir> "<reason>"
const fs = require('fs'), path = require('path');
const [main, rerun, reason] = process.argv.slice(2);
const A = JSON.parse(fs.readFileSync(path.join(main, 'acceptance.json')));
const B = JSON.parse(fs.readFileSync(path.join(rerun, 'acceptance.json')));
A.reruns = A.reruns || [];
A.reruns.push({ started: B.started, finished: B.finished, reason, steps: B.steps.filter(s => !s.name.startsWith('Launch')).map(s => s.name) });
for (const s of B.steps) {
  if (s.name.startsWith('Launch')) continue;
  const i = A.steps.findIndex(x => x.name === s.name || x.name.split(' (')[0] === s.name.split(' (')[0]);
  const first = i >= 0 ? A.steps[i] : null;
  const merged = { ...s, rerun: { at: B.started, reason }, firstAttempt: first ? { ok: first.ok, fail: first.fail, error: first.error, notes: first.notes } : null };
  if (i >= 0) A.steps[i] = merged; else A.steps.push(merged);
  for (const f of s.shots || []) if (fs.existsSync(path.join(rerun, f))) fs.copyFileSync(path.join(rerun, f), path.join(main, f));
}
for (const f of fs.readdirSync(rerun)) if (/^14a-/.test(f)) fs.copyFileSync(path.join(rerun, f), path.join(main, f));
fs.writeFileSync(path.join(main, 'acceptance.json'), JSON.stringify(A, null, 1));
console.log(A.steps.map(s => `${s.ok ? 'PASS' : 'FAIL'}${s.rerun ? ' (re-run)' : ''} ${s.name}`).join('\n'));
