import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const option = name => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
if (!option('--node-modules') || !option('--browser')) {
  throw new Error('Supply --node-modules and --browser.');
}
const {chromium} = createRequire(path.join(path.resolve(option('--node-modules')), 'package.json'))('playwright');
const root = path.resolve('build');
const server = http.createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    let file = path.resolve(root, '.' + pathname);
    if (file !== root && !file.startsWith(root + path.sep)) {
      response.writeHead(403).end();
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2'};
    response.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
    response.end(fs.readFileSync(file));
  } catch {
    response.writeHead(400).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  const data = JSON.parse(fs.readFileSync('.docusaurus/globalData.json', 'utf8'));
  const docs = data['docusaurus-plugin-content-docs'].default.versions.flatMap(version => version.docs)
    .filter(doc => doc.id.startsWith('development/java-components/'));
  assert.equal(docs.length, 6);
  function sources(folder) {
    return fs.readdirSync(folder, {withFileTypes: true}).flatMap(entry => {
      const file = path.join(folder, entry.name);
      return entry.isDirectory() ? sources(file) : file.endsWith('.md') ? [file] : [];
    });
  }
  const byId = new Map(sources('docs/development/java-components').map(file => [
    path.relative('docs', file).replaceAll('\\', '/').replace(/\.md$/, '').split('/').map(part => part.replace(/^\d+-/, '')).join('/'),
    fs.readFileSync(file, 'utf8'),
  ]));
  const output = path.resolve('.java-article-checks/components-browser');
  fs.mkdirSync(output, {recursive: true});
  const base = 'http://127.0.0.1:' + server.address().port;
  const figures = [];
  browser = await chromium.launch({headless: true, executablePath: path.resolve(option('--browser'))});
  for (const width of [1440, 390]) {
    const page = await browser.newPage({viewport: {width, height: 1000}});
    let errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    for (const doc of docs) {
      errors = [];
      const response = await page.goto(base + doc.path, {waitUntil: 'networkidle', timeout: 45000});
      assert.equal(response.status(), 200, doc.id);
      await page.waitForSelector('main article h1');
      const source = byId.get(doc.id);
      assert(source, 'Missing source: ' + doc.id);
      const expected = (source.match(/```mermaid/g) ?? []).length;
      if (expected) {
        await page.waitForFunction(count => document.querySelectorAll('main article svg[id^="mermaid"]').length === count, expected, {timeout: 15000});
      }
      const text = await page.locator('main article').innerText();
      assert(text.includes('练习与答案') && !/Syntax error in text|mermaid version/u.test(text), doc.id);
      const state = await page.evaluate(() => ({
        images: [...document.querySelectorAll('main article img')].filter(image => !image.complete || !image.naturalWidth).length,
        overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
      }));
      assert(!state.images && !state.overflow && !errors.length, doc.id + ': ' + JSON.stringify({state, errors}));
      const sizes = await page.locator('main article svg[id^="mermaid"]').evaluateAll(items => items.map((svg, index) => {
        const box = svg.getBoundingClientRect(), scale = Math.abs(svg.getScreenCTM()?.a ?? 1);
        const fonts = [...svg.querySelectorAll('.nodeLabel,.edgeLabel')].map(label => parseFloat(getComputedStyle(label).fontSize) * scale).filter(Number.isFinite);
        return {index, width: Math.round(box.width), height: Math.round(box.height), minFontPx: fonts.length ? Math.round(Math.min(...fonts) * 10) / 10 : null};
      }));
      if (width === 390) assert(sizes.every(figure => figure.minFontPx === null || figure.minFontPx >= 12.5), doc.id + ': mobile diagram too small ' + JSON.stringify(sizes));
      figures.push({id: doc.id, viewport: width, diagrams: sizes});
      const name = doc.id.split('/').at(-1);
      await page.screenshot({path: path.join(output, name + '-' + width + '.png'), fullPage: true});
      const overlay = await page.addStyleTag({content: '.navbar { visibility: hidden !important; }'});
      try {
        const diagrams = page.locator('main article svg[id^="mermaid"]');
        for (let index = 0; index < await diagrams.count(); index++) {
          await diagrams.nth(index).screenshot({path: path.join(output, name + '-diagram-' + index + '-' + width + '.png')});
        }
      } finally {
        await overlay.evaluate(element => element.remove());
      }
      console.log('PASS ' + width + ' ' + doc.id);
    }
    if (width === 1440) {
      const navigation = await page.locator('.theme-doc-sidebar-container').innerText();
      assert(navigation.includes('Java 生态组件'), 'Missing sidebar entry');
    }
    await page.close();
  }
  fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({builtPages: docs.length, viewportChecks: docs.length * 2, figures}, null, 2) + '\n');
  console.log('PASS 6 routes, 12 desktop/mobile page checks; browser and local server closing.');
} finally {
  if (browser) await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
