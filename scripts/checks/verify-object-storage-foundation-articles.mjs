// Offline documentation checks. Never executes the article's AWS/curl commands.
// Optional isolated browser rendering loads local Mermaid only, not the website.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import {compile} from '@mdx-js/mdx';
import yaml from 'js-yaml';
import {docIdFromSource} from '../../src/data/domains.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const base = 'docs/storage/object-storage/';
const specs = [
  {file: '00-对象存储学习路线.md', questions: 3, diagrams: 1},
  {file: 'fundamentals/01-对象存储原理与完整读写路径.md', questions: 4, diagrams: 1},
  {file: 'fundamentals/02-对象存储一致性与并发更新.md', questions: 5, diagrams: 1},
  {file: 'fundamentals/03-S3访问寻址签名与授权.md', questions: 5, diagrams: 0},
];
const option = name => {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  assert(process.argv[index + 1], `Missing value: ${name}`);
  return process.argv[index + 1];
};
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n');
const parser = unified().use(remarkParse);
const plain = node => node.value ?? node.children?.map(plain).join('') ?? '';
const docs = [];
let questions = 0;
let bashBlocks = 0;
let jsonBlocks = 0;

for (const spec of specs) {
  const file = base + spec.file;
  const source = read(file);
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert(match, `Missing front matter: ${file}`);
  const meta = yaml.load(match[1]);
  assert.equal(meta.sidebar_position, Number(path.basename(spec.file).slice(0, 2)));
  assert(meta.sidebar_label.startsWith(`${path.basename(spec.file).slice(0, 2)}. `));
  await compile(match[2]);
  const nodes = parser.parse(match[2]).children;
  assert.equal(nodes.filter(node => node.type === 'heading' && node.depth === 1).length, 1);
  assert.equal(plain(nodes.find(node => node.type === 'heading' && node.depth === 1)), meta.title);
  const start = nodes.findIndex(node => node.type === 'heading' && node.depth === 2 && /练习与答案$/.test(plain(node)));
  const end = nodes.findIndex((node, index) => index > start && node.type === 'heading' && node.depth <= 2);
  assert(start >= 0 && end > start, `Missing answer section: ${file}`);
  const section = nodes.slice(start + 1, end);
  const positions = section.flatMap((node, index) => node.type === 'heading' && node.depth === 3 ? [index] : []);
  assert.equal(positions.length, spec.questions, `Question count: ${file}`);
  for (const [index, position] of positions.entries()) {
    const answer = section.slice(position + 1, positions[index + 1] ?? section.length);
    assert(answer.some(node => node.type === 'paragraph' && plain(node).startsWith('答案：')),
      `Missing explicit answer: ${plain(section[position])}`);
  }
  questions += positions.length;
  const code = nodes.filter(node => node.type === 'code');
  assert.equal(code.filter(node => node.lang === 'mermaid').length, spec.diagrams);
  const json = code.filter(node => node.lang === 'json').map(node => JSON.parse(node.value));
  const bash = code.filter(node => node.lang === 'bash').map(node => node.value);
  jsonBlocks += json.length;
  bashBlocks += bash.length;
  // -n parses input only. It does not contact AWS, read credentials or write lab files.
  if (option('--bash') && bash.length) execFileSync(path.resolve(option('--bash')), ['-n'], {
    input: bash.join('\n\n'), encoding: 'utf8', cwd: root, timeout: 10000,
  });
  assert(!/面试|岗位职责|本批文章|网站与本地|一眼找到对应目录/.test(match[2]), `Editorial scaffolding: ${file}`);
  docs.push({file, source, meta, code, json, bash});
}

const payload = docs[1].bash.join('\n').match(/printf '([^']+)' > "\$LAB_DIR\/config\.json"/)?.[1];
assert(payload);
const payloadText = payload.replaceAll('\\n', '\n');
assert.equal(Buffer.byteLength(payloadText), 33);
assert.deepEqual(JSON.parse(payloadText), {revision: 'r1', batch_size: 8});
assert.deepEqual(docs[1].json[0], {Bytes: 33, Type: 'application/json', Meta: {revision: 'r1'}});
assert.deepEqual(docs[2].json[0], {revision: 'r2-a', batch_size: 16, timeout: 30});
const conditional = docs[2].bash.join('\n');
assert(conditional.includes("--if-none-match '*'"));
assert.equal(conditional.match(/--if-match "\$ETAG_BEFORE"/g)?.length, 2);
assert.equal(conditional.match(/--query ETag --output text/g)?.length, 1);
const policy = docs[3].json[0];
assert.equal(policy.Version, '2012-10-17');
assert.equal(policy.Statement.length, 2);
assert.deepEqual(policy.Statement[0], {
  Sid: 'ListDemoPrefix', Effect: 'Allow', Action: 's3:ListBucket',
  Resource: 'arn:aws:s3:::example-ai-models',
  Condition: {StringLike: {'s3:prefix': ['models/demo/*']}},
});
assert.deepEqual(policy.Statement[1], {
  Sid: 'ReadDemoObjects', Effect: 'Allow', Action: 's3:GetObject',
  Resource: 'arn:aws:s3:::example-ai-models/models/demo/*',
});
const category = JSON.parse(read(`${base}_category_.json`));
assert.equal(category.collapsed, true);
assert.equal(category.link.type, 'doc');
assert.equal(category.link.id, docIdFromSource(`${base}${specs[0].file}`.slice('docs/'.length)));
assert.equal(JSON.parse(read(`${base}fundamentals/_category_.json`)).collapsed, true);
console.log(`PASS ${docs.length} MDX articles, ${questions} explicit answers, ${jsonBlocks} JSON blocks, payload/policy/conditional-command contracts.`);
console.log(option('--bash') ? `PASS ${bashBlocks} Bash blocks parsed with bash -n; none executed.` : 'SKIP Bash syntax: supply --bash /path/to/bash.');

const modules = option('--node-modules');
const executable = option('--browser');
assert(Boolean(modules) === Boolean(executable), 'Supply both --node-modules and --browser.');
if (!modules) {
  console.log('SKIP Mermaid browser rendering: supply --node-modules and --browser.');
} else {
  const {chromium} = createRequire(path.join(path.resolve(modules), 'package.json'))('playwright');
  const errors = [];
  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<!doctype html><meta charset="utf-8"><style>body{margin:24px;font-family:Arial,sans-serif}.diagram{margin-bottom:32px}svg{max-width:100%;height:auto}</style><main></main><script type="module">import mermaid from "/node_modules/mermaid/dist/mermaid.esm.min.mjs";mermaid.initialize({startOnLoad:false,securityLevel:"strict",theme:"default"});window.mermaid=mermaid;</script>');
      return;
    }
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    const file = path.resolve(root, `.${decodeURIComponent(pathname)}`);
    const allowed = path.join(root, 'node_modules', 'mermaid') + path.sep;
    if (!file.startsWith(allowed) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    fs.createReadStream(file).pipe(res);
  });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    browser = await chromium.launch({headless: true, executablePath: path.resolve(executable)});
    const page = await browser.newPage({viewport: {width: 1440, height: 1100}});
    page.on('pageerror', error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.route('**/*', route => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort());
    await page.goto(origin, {waitUntil: 'networkidle', timeout: 30000});
    await page.waitForFunction(() => Boolean(window.mermaid), null, {timeout: 15000});
    let count = 0;
    for (const doc of docs) {
      for (const diagram of doc.code.filter(node => node.lang === 'mermaid')) {
        const id = `object-storage-${++count}`;
        const rendered = await page.evaluate(async ({source, id}) => {
          await window.mermaid.parse(source);
          const {svg} = await window.mermaid.render(id, source);
          const container = document.createElement('section');
          container.className = 'diagram';
          container.innerHTML = svg;
          document.querySelector('main').appendChild(container);
          await document.fonts.ready;
          const element = container.querySelector('svg');
          return {width: element.getBoundingClientRect().width,
            height: element.getBoundingClientRect().height,
            text: container.textContent,
            viewBox: element.getAttribute('viewBox')};
        }, {source: diagram.value, id});
        assert(rendered.width > 0 && rendered.height > 0 && rendered.viewBox);
        assert(!/Syntax error in text/.test(rendered.text));
        if (option('--screenshots')) {
          const directory = path.resolve(option('--screenshots'));
          fs.mkdirSync(directory, {recursive: true});
          await page.locator(`svg#${id}`).screenshot({path: path.join(directory, `${id}.png`)});
        }
      }
    }
    assert.deepEqual(errors, []);
    assert.equal(count, 3);
    console.log(`PASS ${count} Mermaid diagrams parsed and rendered in one isolated browser; no page errors.`);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
}
