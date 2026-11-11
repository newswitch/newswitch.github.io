import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

// One-time, explicit migration. Default is a read-only plan; never run from CI.
const root = process.cwd();
const apply = process.argv.includes('--apply');
const resolve = relative => {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error(`Unsafe relative path: ${relative}`);
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(path.resolve(root) + path.sep)) throw new Error(`Outside repository: ${relative}`);
  return absolute;
};
const walk = folder => fs.readdirSync(resolve(folder), {withFileTypes:true}).flatMap(entry => {
  const file = path.posix.join(folder, entry.name);
  return entry.isDirectory() ? walk(file) : [file];
});
const idOf = file => file.replace(/^docs\//, '').replace(/\.mdx?$/, '').split('/').map(part => part.replace(/^\d+-/, '')).join('/');
const fileMoves = new Map();
const groups = [
  ['docs/networking/commands', [
    ['01-interface-routing','01. 接口、路由与链路管理',[1,2,3,5,8,21,22,23,24]],
    ['02-diagnostics-performance','02. 连通性、抓包与性能诊断',[4,6,7,9,10,11,12,15,16]],
    ['03-dns-http-tls','03. DNS、HTTP 与 TLS',[13,14,25,26]],
    ['04-firewall-conntrack','04. 防火墙与连接跟踪',[17,18,19,20]],
    ['05-rdma','05. RDMA 与 InfiniBand',[27,28,29]],
  ]],
  ['docs/storage/commands', [
    ['01-devices-filesystems','01. 设备、文件系统与挂载',[1,2,3,4,5,6,7,8]],
    ['02-performance-health','02. 性能与设备健康',[9,10,11,12]],
    ['03-lvm-raid','03. LVM 与 RAID',[13,14,15,16]],
    ['04-nfs','04. NFS 与 RPC',[17,18,19,20]],
    ['05-ceph','05. Ceph、RADOS 与 RBD',[21,22,23,24]],
    ['06-object-storage','06. S3 与对象存储',[25,26,27,28]],
  ]],
];
for (const [base, categories] of groups) {
  const files = fs.readdirSync(resolve(base)).filter(file => /^\d+-.*\.md$/.test(file));
  for (const file of files) {
    const number = Number(file.match(/^\d+/)[0]);
    if (number === 0) continue;
    const matches = categories.filter(([, , numbers]) => numbers.includes(number));
    if (matches.length !== 1) throw new Error(`Missing or ambiguous group: ${base}/${file}`);
    fileMoves.set(`${base}/${file}`, `${base}/${matches[0][0]}/${file}`);
  }
}
for (const file of walk('docs/cloud-native/kubernetes/extensions/platform')) {
  if (file.endsWith('/_category_.json') && path.posix.dirname(file).endsWith('/platform')) continue;
  fileMoves.set(file, file.replace('/extensions/platform/', '/extensions/'));
}
for (const file of fs.readdirSync(resolve('scripts')).filter(file => file.endsWith('.mjs'))) {
  const group = /^(migrate|restructure)-/.test(file) ? 'migrations' : file.startsWith('generate-') ? 'generators' : 'checks';
  fileMoves.set(`scripts/${file}`, `scripts/${group}/${file}`);
}
const exampleMoves = new Map([
  ['examples/java/first-batch', 'examples/java/language-lab'],
  ['examples/java/second-batch', 'examples/java/standard-library-lab'],
  ['examples/java/third-batch/concurrency', 'examples/java/concurrency-lab'],
  ['examples/java/third-batch/build-lab', 'examples/java/build-testing-lab/build-lab'],
  ['examples/java/third-batch/multi-module', 'examples/java/build-testing-lab/multi-module'],
  ['examples/java/fourth-batch', 'examples/java/jvm-diagnostics-lab'],
]);
for (const [from,to] of [...fileMoves,...exampleMoves]) {
  if (!fs.existsSync(resolve(from))) throw new Error(`Missing source; migration may already be applied: ${from}`);
  if (fs.existsSync(resolve(to))) throw new Error(`Refusing to replace destination: ${to}`);
}
const docMoves = [...fileMoves].filter(([file]) => /^docs\/.*\.mdx?$/.test(file));
const ids = new Map(docMoves.map(([from,to]) => [idOf(from), idOf(to)]));
const replacements = [...fileMoves, ...exampleMoves, ['examples/java/third-batch','examples/java/build-testing-lab']]
  .sort(([a],[b]) => b.length - a.length);
const replaceLiteral = (text, from,to) => text.split(from).join(to);
const mapFile = file => {
  if (fileMoves.has(file)) return fileMoves.get(file);
  for (const [from,to] of exampleMoves) if (file.startsWith(from + '/')) return to + file.slice(from.length);
  return file;
};
const tracked = execFileSync('git', ['-c','core.quotepath=false','ls-files','-z'], {encoding:'utf8',cwd:root}).split('\0').filter(Boolean);
const edits = [];
for (const from of tracked) {
  if (!/\.(?:md|mdx|mjs|js|json|ya?ml|css|py|xml|kts|txt)$/.test(from)) continue;
  const to = mapFile(from);
  let source = fs.readFileSync(resolve(from), 'utf8');
  const original = source;
  if (/\.mdx?$/.test(from)) {
    source = source.replace(/(!?\[[^\]]*\]\()([^\s)]+)(\))/g, (all,left,target,right) => {
      if (/^(?:[a-z]+:|\/|#)/i.test(target)) return all;
      const match = target.match(/^([^?#]+)(.*)$/);
      if (!match) return all;
      let decoded;
      try { decoded = decodeURI(match[1]); } catch { return all; }
      if (!/\.mdx?$/.test(decoded)) return all;
      const destination = path.posix.normalize(path.posix.join(path.posix.dirname(from), decoded));
      const mapped = fileMoves.get(destination) ?? destination;
      const relative = path.posix.relative(path.posix.dirname(to), mapped);
      const href = relative.startsWith('.') ? relative : './' + relative;
      return left + href.replaceAll(' ', '%20') + match[2] + right;
    });
  }
  for (const [oldId,newId] of ids) {
    source = replaceLiteral(source, oldId, newId);
    source = replaceLiteral(source, encodeURI(oldId), encodeURI(newId));
  }
  for (const [oldPath,newPath] of replacements) source = replaceLiteral(source, oldPath,newPath);
  if (from.startsWith('scripts/') && fileMoves.has(from)) {
    source = source
      .replace(/new URL\('\.\.\/', import\.meta\.url\)/g, "new URL('../../', import.meta.url)")
      .replace(/path\.resolve\(scriptDir, '\.\.'\)/g, "path.resolve(scriptDir, '../..')")
      .replace(/path\.resolve\(scriptDir, '\.\.', 'docs'\)/g, "path.resolve(scriptDir, '../..', 'docs')")
      .replace(/(path\.resolve\(path\.dirname\(fileURLToPath\(import\.meta\.url\)\),\s*)'\.\.'\)/g, "$1'../..')");
  }
  if (source !== original) edits.push({from,to,source});
}
const summary = {date:'2026-11-12',articleMoves:docMoves.length,scriptMoves:[...fileMoves].filter(([file])=>file.startsWith('scripts/')).length,referenceEdits:edits.length,fileMoves:Object.fromEntries(fileMoves),exampleMoves:Object.fromEntries(exampleMoves)};
console.log(JSON.stringify(summary,null,2));
if (!apply) { console.log('Read-only plan. --apply performs these exact in-repository moves and reference rewrites.'); process.exit(0); }

for (const [from,to] of fileMoves) {
  fs.mkdirSync(path.dirname(resolve(to)), {recursive:true});
  fs.renameSync(resolve(from),resolve(to));
}
// These six exact directories have been resolved and checked above. Move, never delete, existing build artifacts.
for (const [from,to] of exampleMoves) {
  fs.mkdirSync(path.dirname(resolve(to)), {recursive:true});
  fs.renameSync(resolve(from),resolve(to));
}
for (const {to,source} of edits) fs.writeFileSync(resolve(to),source);
for (const [base,categories] of groups) for (const [name,label] of categories) {
  const folder = `${base}/${name}`;
  fs.writeFileSync(resolve(`${folder}/_category_.json`), JSON.stringify({label,position:Number(name.slice(0,2)),collapsed:true,link:{type:'generated-index',slug:'/'+folder.replace(/^docs\//,'').split('/').map(part=>part.replace(/^\d+-/,'')).join('/')}},null,2)+'\n');
}
const oldMetadata='docs/cloud-native/kubernetes/extensions/platform/_category_.json';
fs.unlinkSync(resolve(oldMetadata));
const removeEmpty = folder => {
  for (const entry of fs.readdirSync(resolve(folder),{withFileTypes:true})) if(entry.isDirectory()) removeEmpty(`${folder}/${entry.name}`);
  if(fs.readdirSync(resolve(folder)).length===0) fs.rmdirSync(resolve(folder));
};
removeEmpty('docs/cloud-native/kubernetes/extensions/platform');
removeEmpty('examples/java/third-batch');
fs.mkdirSync(resolve('contributing/migrations'),{recursive:true});
fs.writeFileSync(resolve('contributing/migrations/2026-11-12.json'),JSON.stringify(summary,null,2)+'\n');
console.log('Applied. Validate references and configuration before committing. This migration is intentionally not repeatable.');
