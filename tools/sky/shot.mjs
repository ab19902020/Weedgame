// headless screenshot of a page that exposes window.ready (a promise resolving to a status string)
import { chromium } from 'playwright';
const [, , url, out] = process.argv;
const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', e => console.log('pageerror:', e.message));
p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log(m.type() + ':', m.text().slice(0, 400)); });
await p.goto(url);
console.log(await p.evaluate(() => window.ready));
const c = await p.$('canvas'); await (c || p).screenshot({ path: out });
await b.close();
