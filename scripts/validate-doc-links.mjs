import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(scriptDir, '..', 'docs');

const walk = (root) => {
  const files = [];
  for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute));
    if (entry.isFile() && /\.(md|mdx)$/i.test(entry.name)) files.push(absolute);
  }
  return files;
};

const broken = [];
for (const file of walk(docsRoot)) {
  const content = fs.readFileSync(file, 'utf8');
  const relativeSource = path.relative(docsRoot, file);
  for (const match of content.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g)) {
    if (match[0].startsWith('!')) continue;
    let target = match[1].trim();
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
    target = target.split('#', 1)[0].split('?', 1)[0];
    if (
      target === '' ||
      target.startsWith('#') ||
      target.startsWith('/') ||
      /^(https?:|mailto:|tel:|data:)/i.test(target)
    ) {
      continue;
    }
    let decoded = target;
    try {
      decoded = decodeURI(target);
    } catch {
      continue;
    }
    if (!/\.(md|mdx)$/i.test(decoded)) continue;
    const absoluteTarget = path.resolve(path.dirname(file), decoded);
    if (!fs.existsSync(absoluteTarget)) {
      broken.push(`${relativeSource} -> ${target}`);
    }
  }
}

if (broken.length > 0) {
  console.error(`Broken relative document links: ${broken.length}`);
  for (const item of broken) console.error(item);
  process.exit(1);
}

console.log('All relative Markdown document links resolve.');
