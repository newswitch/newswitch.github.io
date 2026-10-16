import fs from 'node:fs';
import path from 'node:path';

const repositoryRoot = process.cwd();
const docsRoot = path.resolve(repositoryRoot, 'docs');

const vllmGroups = new Map([
  ['01-architecture', new Set(['01', '02', '03', '04', '07', '13'])],
  ['02-execution', new Set(['05', '06', '08', '09', '10', '12', '24'])],
  ['03-performance', new Set(['14', '15', '16', '17', '18', '19', '20', '21', '22', '26', '27', '37'])],
  ['04-parameters', new Set(['25', '28', '29', '30', '31', '32', '33', '34', '35', '36', '38'])],
  ['05-operations', new Set(['11', '23'])],
  ['90-source-notes', new Set(['91', '92', '93', '94', '95', '96'])],
]);

const heterogeneousClusterGroups = [
  ['01-foundations', 1, 6],
  ['02-planning', 7, 9],
  ['03-cluster', 10, 13],
  ['04-scheduling', 14, 16],
  ['05-storage', 17, 20],
  ['06-inference', 21, 28],
  ['07-operations', 29, 32],
  ['90-appendix', 90, 99],
];

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function safeAbsolute(relativePath) {
  const result = path.resolve(repositoryRoot, relativePath);
  const relativeToDocs = path.relative(docsRoot, result);
  if (relativeToDocs.startsWith('..') || path.isAbsolute(relativeToDocs)) {
    throw new Error(`Migration path escapes docs/: ${relativePath}`);
  }
  return result;
}

function directMarkdownFiles(relativeDirectory) {
  const directory = safeAbsolute(relativeDirectory);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, {withFileTypes: true})
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => `${relativeDirectory}/${entry.name}`);
}

function numericPrefix(relativePath) {
  const match = path.posix.basename(relativePath).match(/^(\d{2})-/u);
  if (!match) throw new Error(`Document has no two-digit prefix: ${relativePath}`);
  return match[1];
}

function vllmTarget(relativePath) {
  const prefix = numericPrefix(relativePath);
  for (const [directory, prefixes] of vllmGroups) {
    if (prefixes.has(prefix)) {
      return `docs/ai-systems/inference/vllm/${directory}/${path.posix.basename(relativePath)}`;
    }
  }
  throw new Error(`Unclassified vLLM document: ${relativePath}`);
}

function heterogeneousClusterTarget(relativePath) {
  const number = Number(numericPrefix(relativePath));
  for (const [directory, first, last] of heterogeneousClusterGroups) {
    if (number >= first && number <= last) {
      return `docs/projects/heterogeneous-cluster/${directory}/${path.posix.basename(relativePath)}`;
    }
  }
  throw new Error(`Unclassified heterogeneous-cluster document: ${relativePath}`);
}

const movedFiles = new Map();

for (const oldPath of directMarkdownFiles('docs/ai-systems/inference/vllm')) {
  if (path.posix.basename(oldPath) === '00-vLLM学习路线.md') continue;
  movedFiles.set(oldPath, vllmTarget(oldPath));
}

for (const oldPath of directMarkdownFiles('docs/projects/heterogeneous-cluster')) {
  if (path.posix.basename(oldPath) === '00-专栏目录.md') continue;
  movedFiles.set(oldPath, heterogeneousClusterTarget(oldPath));
}

if (movedFiles.size === 0) {
  console.log('The navigation structure has already been migrated; no changes were made.');
  process.exit(0);
}

if (movedFiles.size !== 86) {
  throw new Error(`Expected 86 documents to move, found ${movedFiles.size}. Review the classification before continuing.`);
}

for (const [oldRelative, newRelative] of movedFiles) {
  const oldPath = safeAbsolute(oldRelative);
  const newPath = safeAbsolute(newRelative);
  if (!fs.existsSync(oldPath)) throw new Error(`Source does not exist: ${oldRelative}`);
  if (fs.existsSync(newPath)) throw new Error(`Target already exists: ${newRelative}`);
  fs.mkdirSync(path.dirname(newPath), {recursive: true});
  fs.renameSync(oldPath, newPath);
}

const reverseMovedFiles = new Map([...movedFiles].map(([oldPath, newPath]) => [newPath, oldPath]));

function splitLinkTarget(rawTarget) {
  const hashIndex = rawTarget.indexOf('#');
  const queryIndex = rawTarget.indexOf('?');
  const candidates = [hashIndex, queryIndex].filter((index) => index >= 0);
  const suffixIndex = candidates.length > 0 ? Math.min(...candidates) : rawTarget.length;
  return [rawTarget.slice(0, suffixIndex), rawTarget.slice(suffixIndex)];
}

function rewriteMarkdownLinks(content, currentRelative) {
  const oldSource = reverseMovedFiles.get(currentRelative) ?? currentRelative;
  const sourceMoved = oldSource !== currentRelative;

  return content.replace(/\]\(([^)\n]+)\)/gu, (fullMatch, originalTarget) => {
    const target = originalTarget.trim();
    const wrapped = target.startsWith('<') && target.endsWith('>');
    const unwrapped = wrapped ? target.slice(1, -1) : target;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/iu.test(unwrapped) || /\s/u.test(unwrapped)) {
      return fullMatch;
    }

    const [linkPath, suffix] = splitLinkTarget(unwrapped);
    if (!linkPath) return fullMatch;
    const oldTarget = path.posix.normalize(path.posix.join(path.posix.dirname(oldSource), linkPath));
    const newTarget = movedFiles.get(oldTarget) ?? oldTarget;
    if (!sourceMoved && newTarget === oldTarget) return fullMatch;

    let relativeTarget = path.posix.relative(path.posix.dirname(currentRelative), newTarget);
    if (!relativeTarget.startsWith('.')) relativeTarget = `./${relativeTarget}`;
    return `](${wrapped ? `<${relativeTarget}${suffix}>` : `${relativeTarget}${suffix}`})`;
  });
}

function walkRepository(directory) {
  const ignored = new Set(['.git', 'node_modules', 'build', '.docusaurus']);
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
    if (entry.isDirectory() && ignored.has(entry.name)) return [];
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkRepository(entryPath) : [entryPath];
  });
}

const literalReplacements = [...movedFiles].map(([oldPath, newPath]) => [
  oldPath.replace(/^docs\//u, ''),
  newPath.replace(/^docs\//u, ''),
]);
const textExtensions = new Set(['.md', '.mdx', '.json', '.js', '.mjs', '.ts', '.tsx']);

for (const file of walkRepository(repositoryRoot)) {
  if (!textExtensions.has(path.extname(file))) continue;
  const relative = toPosix(path.relative(repositoryRoot, file));
  if (relative === 'scripts/restructure-navigation-2026.mjs') continue;

  let content = fs.readFileSync(file, 'utf8');
  if (relative.endsWith('.md') || relative.endsWith('.mdx')) {
    content = rewriteMarkdownLinks(content, relative);
  }
  for (const [oldValue, newValue] of literalReplacements) {
    content = content.replaceAll(oldValue, newValue);
  }
  fs.writeFileSync(file, content, 'utf8');
}

console.log(`Moved ${movedFiles.size} documents and recalculated repository links.`);
