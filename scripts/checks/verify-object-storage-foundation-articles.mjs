// Offline documentation checks. Never executes the article's AWS/curl commands.
// Optional isolated browser rendering loads local Mermaid only, not the website.
// --check-upstream reads pinned public sources; no storage or cluster is contacted.
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
const foundationSpecs = [
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
const series = option('--series') ?? 'foundations';
assert(['foundations', 's3fs', 'completion'].includes(series), 'Unknown article series.');
const s3fsSpecs = [
  {file: 's3fs-fuse/01-s3fs-fuse原理与文件访问路径.md', questions: 4, diagrams: 1},
  {file: 's3fs-fuse/02-s3fs-fuse安装挂载与配置.md', questions: 5, diagrams: 0},
  {file: 's3fs-fuse/03-s3fs-fuse缓存写入与文件语义.md', questions: 6, diagrams: 1},
  {file: 's3fs-fuse/04-s3fs-fuse的Kubernetes接入与故障排查.md', questions: 6, diagrams: 1},
];
const completionSpecs = [
  {file: 'clients/01-Mountpoint-for-Amazon-S3原理与访问边界.md', questions: 4, diagrams: 1},
  {file: 'clients/02-Python-fsspec与s3fs对象访问.md', questions: 5, diagrams: 1},
  {file: 'clients/03-对象存储接入方式选型.md', questions: 4, diagrams: 1},
  {file: 'cloud-services/01-Amazon-S3架构存储类别与访问.md', questions: 5, diagrams: 0},
  {file: 'cloud-services/02-华为OBS架构接入与兼容性.md', questions: 5, diagrams: 0},
  {file: '06-对象存储访问链路排障.md', questions: 6, diagrams: 1},
  {file: '../commands/06-object-storage/27-rclone命令详解.md', questions: 6, diagrams: 1},
  {file: 'minio/03-S3-Put-Get-List-Delete-Multipart-Range-ETag与Checksum.md', questions: 6, diagrams: 1},
];
const specs = {foundations: foundationSpecs, s3fs: s3fsSpecs, completion: completionSpecs}[series];
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n');
const parser = unified().use(remarkParse);
const plain = node => node.value ?? node.children?.map(plain).join('') ?? '';
const docs = [];
let questions = 0;
let bashBlocks = 0;
let jsonBlocks = 0;
let yamlBlocks = 0;

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
  const yml = code.filter(node => node.lang === 'yaml').flatMap(node => yaml.loadAll(node.value));
  const bash = code.filter(node => node.lang === 'bash').map(node => node.value);
  jsonBlocks += json.length;
  yamlBlocks += yml.length;
  bashBlocks += bash.length;
  // -n parses input only. It does not contact AWS, read credentials or write lab files.
  if (option('--bash') && bash.length) execFileSync(path.resolve(option('--bash')), ['-n'], {
    input: bash.join('\n\n'), encoding: 'utf8', cwd: root, timeout: 10000,
  });
  assert(!/面试|岗位职责|本批文章|网站与本地|一眼找到对应目录/.test(match[2]), `Editorial scaffolding: ${file}`);
  docs.push({file, source, meta, code, json, yml, bash});
}

if (series === 'foundations') {
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
} else if (series === 's3fs') {
  const exampleRoot = 'examples/storage/s3fs-lab/';
  const launcher = read(`${exampleRoot}run-readonly.sh`);
  assert(!fs.readFileSync(path.join(root, exampleRoot, 'run-readonly.sh'), 'utf8').includes('\r'), 'Linux launcher requires LF line endings.');
  assert(read(`${exampleRoot}.gitattributes`).includes('*.sh text eol=lf'));
  const docker = read(`${exampleRoot}Dockerfile`);
  const unit = read(`${exampleRoot}s3fs-readonly.service`);
  const python = read(`${exampleRoot}write-probe.py`);
  const pod = yaml.load(read(`${exampleRoot}pod-readonly.yaml`));
  const container = pod.spec.containers[0];
  const category = JSON.parse(read(`${base}s3fs-fuse/_category_.json`));
  assert.equal(category.collapsed, true);
  assert.equal(category.link.type, 'generated-index');
  assert.equal(pod.metadata.namespace, 'storage-lab');
  assert.equal(pod.metadata.name, 's3fs-readonly-lab');
  assert.equal(pod.spec.automountServiceAccountToken, false);
  assert.equal(pod.spec.containers.length, 1);
  assert(!pod.spec.initContainers && !pod.spec.hostPID && !pod.spec.hostNetwork);
  assert.equal(pod.spec.nodeSelector['kubernetes.io/os'], 'linux');
  assert.equal(pod.spec.nodeSelector['storage.example.com/fuse-lab'], 'true');
  assert.deepEqual(container.securityContext, docs[3].yml[0].securityContext);
  assert.deepEqual(container.securityContext, {privileged: true, runAsUser: 0});
  assert.equal(container.image, 'registry.example.com/storage/s3fs-lab:1.97');
  assert.equal(container.resources.limits['ephemeral-storage'], '5Gi');
  assert(!container.livenessProbe && !container.envFrom);
  assert.equal(container.startupProbe.exec.command.at(-1), '/mnt/s3');
  assert.equal(container.readinessProbe.exec.command.at(-1), '/mnt/s3/health/ready.txt');
  assert.equal(container.readinessProbe.exec.command[1], '5');
  const volumes = new Map(pod.spec.volumes.map(volume => [volume.name, volume]));
  assert.deepEqual(volumes.get('fuse-device').hostPath, {path: '/dev/fuse', type: 'CharDevice'});
  assert.equal([...volumes.values()].filter(volume => volume.hostPath).length, 1);
  assert.equal(volumes.get('credentials').secret.secretName, 's3fs-credentials');
  assert.equal(volumes.get('credentials').secret.defaultMode, 0o400);
  assert.deepEqual(volumes.get('cache').emptyDir, {sizeLimit: '4Gi'});
  for (const mount of container.volumeMounts) {
    assert(volumes.has(mount.name));
    assert(!mount.mountPropagation);
  }
  assert(container.volumeMounts.some(mount => mount.name === 'credentials' && mount.readOnly));
  assert(container.volumeMounts.some(mount => mount.name === 'cache' && mount.mountPath === '/var/cache/s3fs'));
  assert(container.env.every(entry => !entry.valueFrom && !/KEY|TOKEN|SECRET/.test(entry.name)));
  assert(docker.includes('ARG S3FS_VERSION=1.97'));
  assert(docker.includes('libfuse3-dev') && docker.includes('make -j2'));
  assert(docker.includes('COPY run-readonly.sh /usr/local/bin/run-readonly.sh'));
  assert(docker.includes('ENTRYPOINT ["/usr/local/bin/run-readonly.sh"]'));
  assert(!/passwd|ACCESS_KEY|SESSION_TOKEN/.test(docker));
  assert(launcher.includes('-o ro -o "passwd_file=$S3FS_CRED_FILE"'));
  assert(launcher.includes('-o use_cache=/var/cache/s3fs/data -o tmpdir=/var/cache/s3fs/tmp'));
  assert(launcher.includes('FUSE_PID=$!') && launcher.includes('wait "$FUSE_PID"'));
  assert(launcher.includes('trap cleanup EXIT') && launcher.includes('timeout 10 fusermount3 -u /mnt/s3'));
  assert(launcher.includes('if [[ -n "$FUSE_PID" ]] && mountpoint -q /mnt/s3; then'));
  assert(!/killall|pkill|allow_other|curldbg|no_check_certificate/.test(launcher));
  assert(/Type=simple/.test(unit) && /User=s3reader/.test(unit));
  assert(/ExecStart=\/opt\/s3fs\/1\.97\/bin\/s3fs .* -f -o ro /.test(unit));
  assert(unit.includes('ExecStop=/usr/bin/fusermount3 -u /srv/s3fs-models'));
  assert(!/allow_other|PrivateMounts|NoNewPrivileges/.test(unit));
  assert.equal(Buffer.byteLength('s3fs-write-check\n'), 17);
  assert.equal(docs[2].json[0].bytes, 17);
  assert.equal(4 * 6 + 8 + 8, 40);
  assert.equal(300 * 4, 1200);
  const pythonSnippet = docs[2].code.find(node => node.lang === 'python').value;
  const normalizeIndent = source => source.split('\n').map(line => line.trim()).join('\n').trim();
  assert(normalizeIndent(python).includes(normalizeIndent(pythonSnippet)));
  if (option('--python')) {
    execFileSync(path.resolve(option('--python')), ['-c',
      'import ast,json,sys\nsrc=json.load(sys.stdin)\ntree=ast.parse(src)\nvalues=[n.value for n in ast.walk(tree) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=="payload" for t in n.targets)]\nassert len(values)==1 and len(ast.literal_eval(values[0]))==17\n'],
    {input: JSON.stringify(python), encoding: 'utf8', timeout: 10000});
    console.log('PASS write-probe Python AST and 17-byte payload; probe not executed.');
  } else {
    console.log('SKIP Python AST: supply --python /path/to/python.');
  }
  if (option('--bash')) {
    execFileSync(path.resolve(option('--bash')), ['-n'], {input: launcher, encoding: 'utf8', timeout: 10000});
    bashBlocks++;
  }
  if (process.argv.includes('--check-upstream')) {
    const origin = 'https://raw.githubusercontent.com/s3fs-fuse/s3fs-fuse/v1.97/';
    const fetchSource = async file => {
      const response = await fetch(origin + file, {signal: AbortSignal.timeout(20000)});
      assert(response.ok, `Cannot read pinned upstream: ${file}`);
      return response.text();
    };
    const [manual, configure] = await Promise.all([
      fetchSource('doc/man/s3fs.1.in'), fetchSource('configure.ac'),
    ]);
    const options = ['passwd_file', 'url', 'endpoint', 'use_path_request_style', 'sigv4',
      'complement_stat', 'use_cache', 'tmpdir', 'stat_cache_expire', 'disable_negative_cache',
      'ensure_diskfree', 'max_thread_count', 'connect_timeout', 'readwrite_timeout', 'retries'];
    for (const name of options) assert(manual.includes(name), `Unknown pinned option: ${name}`);
    assert(configure.includes('fuse3 >= ${min_fuse_version}'));
    console.log(`PASS ${options.length} example S3FS option names and FUSE 3 build dependency against v1.97 source; not a runtime test.`);
  }
} else {
  const exampleRoot = 'examples/storage/object-clients/';
  const {makeFixture, makeCompletion} = await import(new URL('../../examples/storage/object-clients/multipart_fixture.mjs', import.meta.url));
  const fixture = makeFixture();
  assert.equal(fixture.first.length, 6 * 1024 * 1024);
  assert(fixture.first.equals(Buffer.alloc(fixture.first.length, 'A')));
  assert.equal(fixture.last.toString(), 'END\n');
  assert.equal(fixture.expected.bytes, 6291460);
  assert.match(fixture.expected.sha256, /^[a-f0-9]{64}$/);
  assert.equal(fixture.first.subarray(0, 16).toString(), 'AAAAAAAAAAAAAAAA');
  assert.deepEqual(makeCompletion({ETag: '"test-part-one"'}, {ETag: '"test-part-two"'}), {
    Parts: [{ETag: '"test-part-one"', PartNumber: 1}, {ETag: '"test-part-two"', PartNumber: 2}],
  });
  assert.throws(() => makeCompletion({}, {ETag: '"test-part-two"'}));
  assert.equal(100 * 40, 4000);
  assert.equal(4000 / 1024, 3.90625);
  assert.equal(16 * 8, 128);
  assert.equal(3 * 20 + 2 + 4, 66);
  for (const index of [6, 7]) {
    const relative = path.posix.normalize((base + specs[index].file).replace(/^docs\//, 'docs/'));
    const baseline = execFileSync('git', ['show', `ad03014:${relative}`], {encoding: 'utf8', cwd: root}).replaceAll('\r\n', '\n');
    const before = baseline.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    const metadata = yaml.load(before[1]);
    for (const field of ['title', 'sidebar_label', 'sidebar_position']) assert.equal(docs[index].meta[field], metadata[field]);
    const old = parser.parse(before[2]).children.filter(node => node.type === 'heading' && node.depth === 2).map(plain);
    const current = parser.parse(docs[index].source.replace(/^---\n[\s\S]*?\n---\n/, '')).children
      .filter(node => node.type === 'heading' && node.depth === 2).map(plain);
    let previous = -1;
    for (const heading of old) {
      const next = current.indexOf(heading);
      assert(next > previous, `Lost/reordered legacy topic: ${heading}`);
      previous = next;
    }
    for (const match of baseline.matchAll(/\{\/\*\s*#([^*]+)\*\/\}/g)) assert(docs[index].source.includes(match[0]));
  }
  assert(docs[6].source.includes('--vfs-cache-mode full'));
  assert(docs[6].source.includes('v1.76.0'));
  assert(docs[7].source.includes('RELEASE.2025-10-15T17-29-55Z'));
  assert(docs[7].source.includes('--range bytes=0-15'));
  assert.deepEqual(docs[7].json[0].Parts.map(part => part.PartNumber), [1, 2]);
  assert(docs[7].json[0].Parts.every(part => typeof part.ETag === 'string' && part.ETag.startsWith('"')));
  assert(read(`${exampleRoot}requirements.txt`).includes('s3fs==2026.9.0'));
  assert(read(`${exampleRoot}requirements.txt`).includes('fsspec==2026.9.0'));
  for (const directory of ['clients', 'cloud-services']) assert.equal(JSON.parse(read(`${base}${directory}/_category_.json`)).collapsed, true);
  if (option('--python')) {
    const sources = docs.flatMap(doc => doc.code.filter(node => node.lang === 'python').map(node => node.value));
    for (const file of ['read_window.py', 'test_read_window.py']) sources.push(read(exampleRoot + file));
    execFileSync(path.resolve(option('--python')), ['-B', '-c', 'import ast,json,sys\nfor src in json.load(sys.stdin): ast.parse(src)\n'], {
      input: JSON.stringify(sources), encoding: 'utf8', cwd: root, timeout: 10000,
    });
    const result = execFileSync(path.resolve(option('--python')), ['-B', '-c',
      'import unittest,sys\nsuite=unittest.defaultTestLoader.discover("examples/storage/object-clients",pattern="test_read_window.py")\nassert suite.countTestCases()==12\nresult=unittest.TextTestRunner().run(suite)\nprint("executed",suite.countTestCases(),"offline cases")\nsys.exit(not result.wasSuccessful())\n'],
    {encoding: 'utf8', cwd: root, timeout: 15000});
    if (result.trim()) console.log(result.trim());
    console.log('PASS Python AST and 12 BytesIO-backed unit tests; s3fs SDK and remote requests not executed.');
  } else {
    console.log('SKIP Python tests: supply --python /path/to/python.');
  }
  console.log('PASS in-memory Multipart fixture, response-manifest contracts, four arithmetic examples and two legacy article outlines; no object service contacted.');
}
console.log(`PASS ${docs.length} ${series} MDX articles, ${questions} explicit answers, ${jsonBlocks} JSON and ${yamlBlocks} YAML blocks; scoped example contracts.`);
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
        const id = `${series}-${++count}`;
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
    assert.equal(count, specs.reduce((sum, spec) => sum + spec.diagrams, 0));
    await page.setViewportSize({width: 390, height: 900});
    const fits = await page.evaluate(() => [...document.querySelectorAll('main svg')].every(svg => {
      const box = svg.getBoundingClientRect();
      return box.width > 0 && box.left >= 0 && box.right <= innerWidth;
    }));
    assert(fits, 'Diagram exceeds the isolated mobile viewport.');
    console.log(`PASS ${count} Mermaid diagrams parsed and rendered in one isolated browser; no page errors.`);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
}
