import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {compile} from '@mdx-js/mdx';

function walk(folder) {
  return fs.readdirSync(folder, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(folder, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

const totals = {articles: 0, guides: 0, answers: 0, diagrams: 0, categories: 0};
for (const file of walk('docs/development/java-components')) {
  if (file.endsWith('_category_.json')) {
    const category = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(category.collapsed, true, file + ': category must default collapsed');
    totals.categories++;
    continue;
  }
  if (!file.endsWith('.md')) continue;
  const source = fs.readFileSync(file, 'utf8');
  const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  const title = source.match(/^title: (".*")\r?$/m);
  assert(title && body.includes('# ' + JSON.parse(title[1])), file + ': title and H1 mismatch');
  assert.match(body, /## \d+\. 练习与答案/, file + ': missing answers');
  const section = body.split(/## \d+\. 练习与答案\r?\n/)[1].split(/\r?\n## /)[0];
  const questions = [...section.matchAll(/^### \d+\.\d+ .+\r?\n\r?\n([^#][\s\S]*?)(?=\r?\n### |$)/gm)];
  assert.equal(questions.length, 3, file + ': expected three exercises');
  assert(questions.every(question => question[1].trim().length > 20), file + ': missing answer');
  assert(!/面试|岗位职责|一眼找到|网站与本地|待补充|TODO|TBD/.test(body), file + ': editorial placeholder');
  await compile(body, {format: 'mdx'});
  totals[path.basename(file).startsWith('00-') ? 'guides' : 'articles']++;
  totals.answers += questions.length;
  totals.diagrams += (body.match(/```mermaid/g) ?? []).length;
}
assert.equal(totals.articles, 17);
assert.equal(totals.guides, 1);
assert.equal(totals.diagrams, 18);
console.log('PASS ' + JSON.stringify(totals) + '; MDX, titles, answers and collapsed categories.');
