import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {domains, docIdFromSource} from '../../src/data/domains.mjs';
import {stripPathNumberPrefixes, DefaultNumberPrefixParser} from '@docusaurus/plugin-content-docs/lib/numberPrefix.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const docs = path.join(root, 'docs');
const read = file => fs.readFileSync(file, 'utf8');
const dirs = folder => fs.readdirSync(folder, {withFileTypes:true}).filter(item => item.isDirectory()).map(item => item.name);
const articles = new Map();
const categories = [];
function visit(relative = '') {
  const folder = path.join(docs, relative);
  if (relative) {
    const file = path.join(folder, '_category_.json');
    assert(fs.existsSync(file), `Missing category metadata: docs/${relative}`);
    const metadata = JSON.parse(read(file));
    assert.equal(metadata.collapsed, true, `Category must default collapsed: ${relative}`);
    assert(metadata.label?.trim(), `Missing category label: ${relative}`);
    categories.push({relative, ...metadata});
  }
  for (const item of fs.readdirSync(folder, {withFileTypes:true})) {
    const source = path.posix.join(relative, item.name);
    if (item.isDirectory()) visit(source);
    else if (/\.mdx?$/.test(item.name)) {
      // This repository uses filename-derived IDs; reject silent exceptions.
      const frontmatter = read(path.join(folder, item.name)).match(/^---\r?\n([\s\S]*?)\r?\n---/);
      assert(!frontmatter || !/^id:/m.test(frontmatter[1]), `Explicit id requires updating the structure check: ${source}`);
      // Use the framework parser: e.g. 02-8021X is deliberately not stripped.
      const id = stripPathNumberPrefixes(source.replace(/\.mdx?$/, ''), DefaultNumberPrefixParser);
      assert.equal(docIdFromSource(source), id, `Shared prefix parser differs from Docusaurus: ${source}`);
      assert(!articles.has(id), `Duplicate article ID: ${id}`);
      articles.set(id, source);
    }
  }
}
visit();
assert.deepEqual(dirs(docs).sort(), domains.map(item => item.directory).sort(), 'Every physical root must have a domain entry');
assert.equal(new Set(domains.map(item => item.docId)).size, domains.length);
for (const domain of domains) assert.equal(articles.get(domain.docId), domain.source, `Invalid domain entry: ${domain.directory}`);
const slugs = new Set();
for (const category of categories) {
  if (category.link?.type === 'doc') {
    const id = category.link.id;
    const localId = path.posix.join(docIdFromSource(category.relative), id);
    assert(articles.has(id) || articles.has(localId), `Missing linked document: ${category.relative} -> ${id}`);
  }
  if (category.link?.slug) {
    assert(!slugs.has(category.link.slug), `Duplicate generated category slug: ${category.link.slug}`);
    slugs.add(category.link.slug);
  }
}
for (const base of ['networking/commands', 'storage/commands']) {
  const direct = fs.readdirSync(path.join(docs, base)).filter(file => /\.mdx?$/.test(file));
  assert.equal(direct.length, 1, `Command articles must be grouped: ${base}`);
  assert(direct[0].startsWith('00-'), `Missing command guide: ${base}`);
}
for (const obsolete of ['docs/cloud-native/kubernetes/extensions/platform', 'examples/java/first-batch', 'examples/java/second-batch', 'examples/java/fourth-batch']) {
  assert(!fs.existsSync(path.join(root, obsolete)), `Obsolete directory: ${obsolete}`);
}
assert(!fs.existsSync(path.join(root, 'src/pages/markdown-page.mdx')), 'Default example page returned');
assert(fs.existsSync(path.join(root, 'src/pages/lab/index.js')) || fs.existsSync(path.join(root, 'src/pages/lab.js')), 'Preserve the style reference page');
const synchronized = spawnSync(process.execPath, [path.join(root, 'scripts/generators/sync-domain-metadata.mjs')], {cwd:root, encoding:'utf8'});
assert.equal(synchronized.status, 0, synchronized.stdout + synchronized.stderr);
let scripts = 0;
for (const group of ['checks', 'generators', 'migrations']) {
  for (const file of fs.readdirSync(path.join(root, 'scripts', group)).filter(file => file.endsWith('.mjs'))) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, 'scripts', group, file)], {encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr);
    scripts++;
  }
}
assert(!fs.readdirSync(path.join(root, 'scripts')).some(file => file.endsWith('.mjs')), 'Group scripts by purpose');
console.log(`PASS ${articles.size} documents, ${categories.length} physical categories, ${domains.length} domains, ${scripts} script syntax checks.`);
