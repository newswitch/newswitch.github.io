import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const option = name => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const modules = option('--node-modules');
const executable = option('--browser');
assert(modules && executable, 'Supply --node-modules and --browser');
const {chromium} = createRequire(path.join(path.resolve(modules), 'package.json'))('playwright');
const data = JSON.parse(fs.readFileSync('.docusaurus/globalData.json', 'utf8'));
const docs = data['docusaurus-plugin-content-docs'].default.versions.flatMap(v => v.docs)
  .filter(doc => /^development\/(?:python|fastapi)\//u.test(doc.id));
assert.equal(docs.length, 62);
const base = option('--base-url') ?? 'http://127.0.0.1:4173';
const output = path.resolve('.python-article-checks/browser');
fs.mkdirSync(output, {recursive: true});
const browser = await chromium.launch({headless: true, executablePath: path.resolve(executable)});
function sourceFor(id) {
  const pieces = id.split('/');
  let target = 'docs';
  for (const [index, piece] of pieces.entries()) {
    const name = fs.readdirSync(target).find(name =>
      name.replace(/^\d+-/u, '').replace(/\.md$/u, '') === piece);
    assert(name, 'Source missing: ' + id);
    target = path.join(target, name);
    if (index === pieces.length - 1) assert(target.endsWith('.md'));
  }
  return fs.readFileSync(target, 'utf8');
}
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 1050}});
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  let diagramCount = 0;
  for (const doc of docs) {
    const expected = sourceFor(doc.id).split('```mermaid').length - 1;
    const response = await page.goto(base + doc.path, {waitUntil: 'networkidle', timeout: 45000});
    assert.equal(response.status(), 200, doc.path);
    await page.locator('main article h1').waitFor();
    assert.equal(await page.locator('main article h1').count(), 1);
    if (expected) {
      await page.waitForFunction(count =>
        document.querySelectorAll('main article svg[id^="mermaid"]').length === count,
      expected, {timeout: 20000});
    }
    const result = await page.evaluate(() => ({
      syntaxError: /Syntax error in text|mermaid version/i.test(
        document.querySelector('main article')?.textContent ?? ''),
      brokenImages: [...document.querySelectorAll('main article img')]
        .filter(image => !image.complete || image.naturalWidth === 0).length,
      labels: [...document.querySelectorAll('main article svg[id^="mermaid"] .node')]
        .map(node => {
          const shape = node.querySelector('rect,polygon');
          const label = node.querySelector('.label');
          if (!shape || !label) return null;
          const a = shape.getBoundingClientRect();
          const b = label.getBoundingClientRect();
          return {text: label.textContent, clipped:
            b.left < a.left - 2 || b.right > a.right + 2 ||
            b.top < a.top - 2 || b.bottom > a.bottom + 2};
        }).filter(Boolean),
    }));
    assert(!result.syntaxError && result.brokenImages === 0, JSON.stringify(result));
    assert(!result.labels.some(label => label.clipped), JSON.stringify(result.labels));
    diagramCount += expected;
    console.log('PASS PAGE ' + doc.id + ' diagrams=' + expected);
    if (expected) {
      const diagram = page.locator('main article svg[id^="mermaid"]').first();
      await diagram.screenshot({path: path.join(output, doc.id.split('/').at(-1) + '.png')});
    }
  }
  assert.equal(diagramCount, 8);
  await page.setViewportSize({width: 390, height: 1000});
  for (const keyword of ['变量对象引用', 'Uvicorn-ASGI', '请求依赖响应与清理源码']) {
    const preview = docs.find(doc => doc.id.includes(keyword));
    assert(preview, 'Mobile preview missing: ' + keyword);
    await page.goto(base + preview.path, {waitUntil: 'networkidle'});
    await page.locator('main article h1').waitFor();
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > window.innerWidth + 2);
    assert(!overflow, 'Unexpected mobile horizontal overflow: ' + preview.path);
    await page.screenshot({path: path.join(output, keyword + '-mobile.png')});
  }
  assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
  console.log('PASS: 62 rendered pages, 8 Mermaid diagrams and mobile layout');
} finally {
  await browser.close();
}
