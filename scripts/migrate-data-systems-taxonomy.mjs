import fs from 'node:fs';
import path from 'node:path';

const repositoryRoot = process.cwd();
const dataSystemsRoot = path.resolve(repositoryRoot, 'docs/data-systems');

const directoryMoves = new Map([
  ['docs/data-systems/mysql', 'docs/data-systems/databases/mysql'],
  ['docs/data-systems/postgresql', 'docs/data-systems/databases/postgresql'],
  ['docs/data-systems/redis', 'docs/data-systems/cache/redis'],
  ['docs/data-systems/kafka', 'docs/data-systems/messaging/kafka'],
  ['docs/data-systems/rocketmq', 'docs/data-systems/messaging/rocketmq'],
  ['docs/data-systems/elasticsearch', 'docs/data-systems/search/elasticsearch'],
  ['docs/data-systems/milvus', 'docs/data-systems/vector-databases/milvus'],
  ['docs/data-systems/clickhouse', 'docs/data-systems/analytics/clickhouse'],
  ['docs/data-systems/olap', 'docs/data-systems/analytics/olap'],
  ['docs/data-systems/foundations', 'docs/data-systems/big-data/foundations'],
  ['docs/data-systems/hadoop-hive', 'docs/data-systems/big-data/hadoop-hive'],
  ['docs/data-systems/spark', 'docs/data-systems/big-data/spark'],
  ['docs/data-systems/flink', 'docs/data-systems/big-data/flink'],
  ['docs/data-systems/lakehouse', 'docs/data-systems/big-data/lakehouse'],
  ['docs/data-systems/engineering-governance', 'docs/data-systems/big-data/engineering-governance'],
  ['docs/data-systems/projects', 'docs/data-systems/big-data/projects'],
]);

const fileMoves = new Map([
  ['docs/data-systems/00-大数据技术学习地图.md', 'docs/data-systems/big-data/00-大数据技术学习地图.md'],
  ['docs/data-systems/commands/01-Hadoop-HDFS-YARN-MapReduce命令手册.md', 'docs/data-systems/big-data/hadoop-hive/90-Hadoop-HDFS-YARN-MapReduce命令手册.md'],
  ['docs/data-systems/commands/02-Hive-Beeline与Metastore命令手册.md', 'docs/data-systems/big-data/hadoop-hive/91-Hive-Beeline与Metastore命令手册.md'],
  ['docs/data-systems/commands/03-Kafka-Topic-Producer-Consumer与Group命令手册.md', 'docs/data-systems/messaging/kafka/13-Kafka-Topic-Producer-Consumer与Group命令手册.md'],
  ['docs/data-systems/commands/04-Spark-Submit-SQL-History与排障命令手册.md', 'docs/data-systems/big-data/spark/90-Spark-Submit-SQL-History与排障命令手册.md'],
  ['docs/data-systems/commands/05-Flink-CLI-REST-Checkpoint与Savepoint命令手册.md', 'docs/data-systems/big-data/flink/90-Flink-CLI-REST-Checkpoint与Savepoint命令手册.md'],
  ['docs/data-systems/commands/06-Iceberg-Spark-SQL快照与维护命令手册.md', 'docs/data-systems/big-data/lakehouse/90-Iceberg-Spark-SQL快照与维护命令手册.md'],
  ['docs/data-systems/commands/07-Trino-CLI-EXPLAIN-System表与查询排障.md', 'docs/data-systems/analytics/olap/90-Trino-CLI-EXPLAIN-System表与查询排障.md'],
  ['docs/data-systems/commands/08-ClickHouse-Client-System表与运维命令手册.md', 'docs/data-systems/analytics/clickhouse/15-ClickHouse-Client-System表与运维命令手册.md'],
  ['docs/data-systems/commands/09-Doris-SQL-Load-Tablet与诊断命令手册.md', 'docs/data-systems/analytics/olap/91-Doris-SQL-Load-Tablet与诊断命令手册.md'],
  ['docs/data-systems/commands/10-Airflow-DAG-Task-Backfill与恢复命令手册.md', 'docs/data-systems/big-data/engineering-governance/90-Airflow-DAG-Task-Backfill与恢复命令手册.md'],
]);

const legacyEntries = [...directoryMoves.keys(), ...fileMoves.keys()];
if (!legacyEntries.some((entry) => fs.existsSync(path.resolve(repositoryRoot, entry)))) {
  console.log('The data-systems taxonomy has already been migrated; no changes were made.');
  process.exit(0);
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function absolute(relativePath) {
  const result = path.resolve(repositoryRoot, relativePath);
  const relativeToDataSystems = path.relative(dataSystemsRoot, result);
  if (relativeToDataSystems.startsWith('..') || path.isAbsolute(relativeToDataSystems)) {
    throw new Error(`Migration path escapes data-systems: ${relativePath}`);
  }
  return result;
}

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(entryPath) : [entryPath];
  });
}

const movedFiles = new Map();
for (const [oldDirectory, newDirectory] of directoryMoves) {
  for (const oldFile of walkFiles(absolute(oldDirectory))) {
    const suffix = path.relative(absolute(oldDirectory), oldFile);
    const oldRelative = toPosix(path.relative(repositoryRoot, oldFile));
    const newRelative = toPosix(path.join(newDirectory, suffix));
    movedFiles.set(oldRelative, newRelative);
  }
}
for (const [oldFile, newFile] of fileMoves) movedFiles.set(oldFile, newFile);

function move(oldRelative, newRelative) {
  const oldPath = absolute(oldRelative);
  const newPath = absolute(newRelative);
  if (!fs.existsSync(oldPath)) return;
  if (fs.existsSync(newPath)) throw new Error(`Target already exists: ${newRelative}`);
  fs.mkdirSync(path.dirname(newPath), {recursive: true});
  fs.renameSync(oldPath, newPath);
}

for (const [oldDirectory, newDirectory] of directoryMoves) move(oldDirectory, newDirectory);
for (const [oldFile, newFile] of fileMoves) move(oldFile, newFile);

const obsoleteCategory = absolute('docs/data-systems/commands/_category_.json');
if (fs.existsSync(obsoleteCategory)) fs.unlinkSync(obsoleteCategory);
const obsoleteCommands = absolute('docs/data-systems/commands');
if (fs.existsSync(obsoleteCommands)) fs.rmdirSync(obsoleteCommands);

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
    const result = `${relativeTarget}${suffix}`;
    return `](${wrapped ? `<${result}>` : result})`;
  });
}

const literalReplacements = [
  ['data-systems/大数据技术学习地图', 'data-systems/big-data/大数据技术学习地图'],
  ...[...directoryMoves].map(([oldPath, newPath]) => [
    oldPath.replace(/^docs\//u, ''),
    newPath.replace(/^docs\//u, ''),
  ]),
];

function walkRepository(directory) {
  const ignored = new Set(['.git', 'node_modules', 'build', '.docusaurus']);
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
    if (entry.isDirectory() && ignored.has(entry.name)) return [];
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkRepository(entryPath) : [entryPath];
  });
}

const textExtensions = new Set(['.md', '.mdx', '.json', '.js', '.mjs', '.ts', '.tsx']);
for (const file of walkRepository(repositoryRoot)) {
  if (!textExtensions.has(path.extname(file))) continue;
  const relative = toPosix(path.relative(repositoryRoot, file));
  if (relative === 'scripts/migrate-data-systems-taxonomy.mjs') continue;
  let content = fs.readFileSync(file, 'utf8');
  if (relative.endsWith('.md') || relative.endsWith('.mdx')) {
    content = rewriteMarkdownLinks(content, relative);
  }
  for (const [oldValue, newValue] of literalReplacements) {
    content = content.replaceAll(oldValue, newValue);
  }
  fs.writeFileSync(file, content, 'utf8');
}

console.log(`Moved ${movedFiles.size} files into the new data-systems taxonomy.`);
