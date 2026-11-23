// Summarise perf logs (perf-*.json from the flythrough or "Save perf log") as a Markdown table.
// Usage: node tools/test/perf-summary.js perf-*.json
const fs = require('fs');
const rows = [];
for (const f of process.argv.slice(2)) {
  let j; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { console.error('skip', f, e.message); continue; }
  const s = j.summary || {};
  const model = (j.userAgent || '').match(/Android [^;]+; ([^)]+)\)/)?.[1] || (j.userAgent || '').slice(0, 40);
  rows.push([f.split('/').pop(), model, j.gpu || '?', j.backend, j.quality, j.kind, j.completed ?? '', s.fps ?? '', s.p50 ?? '', s.p95 ?? '', s.p99 ?? '', s.stalls ?? j.stalls ?? '', s.heapMaxMB ?? '', s.drawCallsP95 ?? '', s.trisP95 ?? '']);
}
const head = ['file', 'device', 'gpu', 'backend', 'quality', 'kind', 'completed', 'fps', 'p50 ms', 'p95 ms', 'p99 ms', 'stalls', 'heap max MB', 'draws p95', 'tris p95'];
console.log('| ' + head.join(' | ') + ' |\n|' + head.map(() => '---').join('|') + '|');
for (const r of rows) console.log('| ' + r.join(' | ') + ' |');
