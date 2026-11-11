import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {domains, docIdFromSource} from '../../src/data/domains.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const write = process.argv.includes('--write');
const changes = [];
function sync(relative, update) {
  const file = path.join(root, relative);
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const metadata = before ? JSON.parse(before) : {};
  update(metadata);
  const after = JSON.stringify(metadata, null, 2) + '\n';
  if (before.replaceAll('\r\n', '\n') === after) return;
  changes.push(relative);
  if (write) fs.writeFileSync(file, after);
}
for (const [index, domain] of domains.entries()) {
  sync(`docs/${domain.directory}/_category_.json`, metadata => Object.assign(metadata, {
    label:domain.title, position:index + 1, collapsed:true,
    link:{type:'doc', id:domain.docId},
  }));
}
function visit(relative) {
  const entries = fs.readdirSync(path.join(root, 'docs', relative), {withFileTypes:true});
  const children = entries.filter(entry => entry.isDirectory());
  const articles = entries.filter(entry => entry.isFile() && /\.mdx?$/.test(entry.name));
  if (!children.length && articles.length === 1) {
    sync(`docs/${relative}/_category_.json`, metadata => Object.assign(metadata, {
      collapsed:true, link:{type:'doc', id:docIdFromSource(`${relative}/${articles[0].name}`)},
    }));
  }
  for (const child of children) visit(`${relative}/${child.name}`);
}
visit('development/java-components');
console.log(`${write ? 'Synchronized' : 'Metadata differences'}: ${changes.length}`);
if (changes.length) console.log(changes.join('\n'));
if (!write && changes.length) process.exitCode = 1;
