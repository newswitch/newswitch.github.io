import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {domains, docIdFromSource} from '../../src/data/domains.mjs';
import {stripPathNumberPrefixes, DefaultNumberPrefixParser} from '@docusaurus/plugin-content-docs/lib/numberPrefix.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const json = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const global = json('.docusaurus/globalData.json');
const routes = global['docusaurus-plugin-content-docs'].default.versions.flatMap(version => version.docs);
// Docusaurus includes generated category indices in globalData.docs, with
// slash-prefixed IDs. They are routes, not additional source articles.
const documents = routes.filter(doc => !doc.id.startsWith('/'));
const byId = new Map(documents.map(doc => [doc.id, doc]));
const base = '.docusaurus/docusaurus-plugin-content-docs/default/p';
const versions = fs.readdirSync(path.join(root, base)).filter(file => file.endsWith('.json'))
  .map(file => json(`${base}/${file}`)).filter(data => data.version?.docsSidebars);
assert.equal(versions.length, 1, 'Expected one current documentation version');
const sidebar = versions[0].version.docsSidebars.docsSidebar;
assert.equal(sidebar[0].docId, 'intro');
assert.deepEqual(sidebar.slice(1).map(item => item.label), domains.map(domain => domain.title));
const seen = new Set(['intro']);
let folders = 0;
function resolveId(relative, id) {
  return byId.has(id) ? id : path.posix.join(docIdFromSource(relative), id);
}
function verifyFolder(relative, item, entryId) {
  folders++;
  assert.equal(item.type, 'category', `Physical folder must remain a category: ${relative}`);
  assert.equal(item.collapsed, true, `Default collapse: ${relative}`);
  const folder = path.join(root, 'docs', relative);
  const entries = fs.readdirSync(folder, {withFileTypes:true});
  const metadata = json(`docs/${relative}/_category_.json`);
  const linkedId = entryId ?? (metadata.link?.type === 'doc' ? resolveId(relative, metadata.link.id) : undefined);
  if (linkedId) {
    assert(byId.has(linkedId), `Missing linked route: ${linkedId}`);
    assert.equal(decodeURI(item.href), decodeURI(byId.get(linkedId).path), `Category entry: ${relative}`);
    seen.add(linkedId);
  }
  const children = entries.filter(entry => entry.isDirectory());
  const files = entries.filter(entry => entry.isFile() && /\.mdx?$/.test(entry.name))
    .map(entry => stripPathNumberPrefixes(`${relative}/${entry.name}`.replace(/\.mdx?$/, ''), DefaultNumberPrefixParser));
  const retainSoleFile = !children.length && files.length === 1;
  const expectedDocs = files.filter(id => retainSoleFile || id !== linkedId);
  const actualDocs = item.items.filter(child => child.type === 'link').map(child => child.docId);
  assert.deepEqual(actualDocs.slice().sort(), expectedDocs.sort(), `Article placement: ${relative}`);
  for (const id of actualDocs) {
    assert(!seen.has(id) || id === linkedId, `Duplicate sidebar article: ${id}`);
    seen.add(id);
  }
  const actualChildren = item.items.filter(child => child.type === 'category');
  assert.equal(actualChildren.length, children.length, `Folder count: ${relative}`);
  for (const child of children) {
    const childRelative = `${relative}/${child.name}`;
    const childMetadata = json(`docs/${childRelative}/_category_.json`);
    const matches = actualChildren.filter(candidate => candidate.label === childMetadata.label);
    assert.equal(matches.length, 1, `Category label: ${childRelative}`);
    verifyFolder(childRelative, matches[0]);
  }
}
for (const [index, domain] of domains.entries()) verifyFolder(domain.directory, sidebar[index + 1], domain.docId);
assert.equal(seen.size, documents.length, 'Every source article must be reachable in the sidebar');
for (const doc of routes) {
  if (!doc.id.startsWith('/')) assert(seen.has(doc.id), `Unreachable article: ${doc.id}`);
  const pathname = decodeURIComponent(doc.path).replace(/^\//, '');
  assert(fs.existsSync(path.join(root, 'build', pathname, 'index.html')), `Missing built HTML: ${doc.path}`);
}
assert(fs.existsSync(path.join(root, 'build/lab/index.html')), 'Keep the style reference');
assert(!fs.existsSync(path.join(root, 'build/markdown-page/index.html')), 'Default scaffold route must not ship');
const search = fs.readdirSync(path.join(root, 'build')).filter(file => /^search-index.*\.json$/.test(file));
assert(search.length > 0, 'Build must generate a local search index');
const indexBytes = search.reduce((sum, file) => sum + fs.statSync(path.join(root, 'build', file)).size, 0);
assert(indexBytes > 1000, 'Search index appears empty');
assert(indexBytes < 32 * 1048576, 'Local navigation search must stay below 32 MiB; review indexing scope');
console.log(`PASS ${documents.length} rendered articles, ${routes.length - documents.length} category indices, ${folders} matching physical folders; local search ${(indexBytes / 1048576).toFixed(1)} MiB.`);
