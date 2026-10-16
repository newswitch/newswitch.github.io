import fs from 'node:fs';
import path from 'node:path';

const repositoryRoot = process.cwd();
const docsRoot = path.resolve(repositoryRoot, 'docs');

const products = [
  {
    root: 'docs/networking/load-balancing-proxy/nginx',
    groups: [
      ['01-core', '01. 架构、配置与源码', ['01', '03', '07', '08', '13', '14', '21']],
      ['02-proxy-content', '02. 部署、代理与内容服务', ['02', '04', '05', '06']],
      ['03-protocols', '03. 协议、服务发现与四层代理', ['15', '16', '17', '18']],
      ['04-production', '04. 安全、性能与生产运维', ['09', '10', '11', '12', '19', '20']],
    ],
  },
  {
    root: 'docs/networking/security/tls-pki',
    groups: [
      ['01-protocol', '01. 密码学与 TLS 协议', ['01', '02', '03', '04', '05', '06']],
      ['02-pki-certificates', '02. PKI、证书与文件格式', ['07', '08', '09', '10']],
      ['03-architecture-automation', '03. 加密架构、身份与自动化', ['11', '12', '13', '14', '15']],
      ['04-operations', '04. 分析、性能与故障排查', ['16', '17', '18', '19']],
    ],
  },
  {
    root: 'docs/data-systems/databases/postgresql',
    groups: [
      ['01-foundations-sql', '01. 基础、部署与 SQL', ['01', '02', '03', '04', '05']],
      ['02-storage-concurrency', '02. 存储、事务与索引', ['06', '07', '08', '09', '10']],
      ['03-performance', '03. 执行计划与资源性能', ['11', '12']],
      ['04-ha-dr', '04. 复制、高可用、备份与容灾', ['13', '14', '15', '16', '19']],
      ['05-operations-internals', '05. 生产运维与内核扩展', ['17', '18']],
    ],
  },
  {
    root: 'docs/data-systems/search/elasticsearch',
    groups: [
      ['01-search-storage', '01. 搜索、索引与存储原理', ['01', '02', '03', '04', '05']],
      ['02-cluster-data', '02. 集群、部署与数据生命周期', ['06', '07', '08', '09', '10']],
      ['03-vector-performance', '03. 向量检索、容量与性能', ['11', '12', '13']],
      ['04-security-operations', '04. 安全、灾备与生产运维', ['14', '15', '16', '17']],
    ],
  },
  {
    root: 'docs/data-systems/vector-databases/milvus',
    groups: [
      ['01-foundations-data', '01. 向量基础与数据模型', ['01', '02', '03', '04']],
      ['02-storage-index', '02. Segment、索引与组件原理', ['05', '06', '07', '08', '09']],
      ['03-deployment-scaling', '03. 部署、分片与弹性扩展', ['10', '11']],
      ['04-performance-operations', '04. 容量、性能与生产运维', ['12', '13', '14', '15', '16']],
    ],
  },
  {
    root: 'docs/sre/observability/prometheus',
    groups: [
      ['01-model-query', '01. 指标模型、存储与 PromQL', ['01', '02', '03', '04', '05']],
      ['02-alerting-visualization', '02. 规则、告警与可视化', ['06', '07', '08']],
      ['03-deployment-scaling', '03. 部署、采集与长期存储', ['09', '10', '11']],
      ['04-production', '04. 容量、安全与生产运维', ['12', '13', '14', '15']],
    ],
  },
  {
    root: 'docs/sre/observability/telemetry',
    groups: [
      ['01-otel-foundations', '01. 统一证据链与 OpenTelemetry', ['01', '02', '03', '04', '05']],
      ['02-logging', '02. 日志、Loki 与 LogQL', ['06', '07', '08', '12']],
      ['03-tracing', '03. Trace、Tempo 与 Jaeger', ['09', '10', '13']],
      ['04-production', '04. 部署、关联分析与生产治理', ['11', '14', '15']],
    ],
  },
  {
    root: 'docs/automation/ansible',
    groups: [
      ['01-foundations-playbook', '01. 基础、Inventory 与 Playbook', ['01', '02', '03', '04', '05', '06']],
      ['02-reuse-security', '02. Role、Collection 与安全', ['07', '08']],
      ['03-production-scale', '03. 发布、扩展与大规模运行', ['09', '10', '11', '14']],
      ['04-quality-platform', '04. 测试、平台与综合项目', ['12', '13', '15']],
    ],
  },
  {
    root: 'docs/data-systems/cache/redis',
    groups: [
      ['01-client-data', '01. 协议、客户端与数据结构', ['01', '02', '03', '04']],
      ['02-engine-persistence', '02. 执行、内存与持久化', ['05', '06', '07']],
      ['03-ha-cluster', '03. 复制、高可用、集群与部署', ['08', '09', '10', '11']],
      ['04-patterns-operations', '04. 应用模式与生产运维', ['12', '13', '14', '15']],
    ],
  },
  {
    root: 'docs/data-systems/analytics/clickhouse',
    groups: [
      ['01-foundations-storage', '01. 数据模型与存储引擎', ['01', '02', '03', '05']],
      ['02-query-ingest', '02. 查询执行与数据写入', ['06', '07', '08']],
      ['03-cluster-replication', '03. 部署、复制与分片', ['09', '10', '11']],
      ['04-production', '04. 存储治理、性能与运维', ['12', '13', '14', '15', '16']],
    ],
  },
  {
    root: 'docs/cloud-native/kubernetes/extensions/platform',
    groups: [
      ['01-api-operators', '01. API 扩展、控制器与 Operator', ['01', '02', '03', '04', '05', '06', '07', '08']],
      ['02-admission', '02. Admission Webhook', ['09', '10']],
      ['03-scheduling', '03. 调度扩展、DRA 与 AI 调度', ['11', '12', '13', '14']],
    ],
  },
  {
    root: 'docs/linux/system-internals/07-network-stack',
    groups: [
      ['01-packet-path', '01. Socket、SKB 与收发路径', ['01', '02', '03', '04']],
      ['02-routing-transport', '02. 路由、TCP、UDP 与 ICMP', ['05', '06', '07', '08']],
      ['03-netfilter-queues', '03. Netfilter、队列与流量控制', ['09', '10', '11', '12']],
      ['04-virtual-troubleshooting', '04. 虚拟网络与分层排障', ['13', '14']],
    ],
  },
  {
    root: 'docs/automation/python',
    groups: [
      ['01-language-project', '01. 语言、项目与数据处理', ['01', '02', '03', '04']],
      ['02-cli-api-remote', '02. CLI、API 与远程执行', ['05', '06', '08', '09']],
      ['03-concurrency-quality', '03. 并发、可观测性与测试', ['07', '10', '11']],
      ['04-framework-delivery', '04. 框架、交付与综合项目', ['12', '13', '14']],
    ],
  },
  {
    root: 'docs/data-systems/orchestration/airflow',
    groups: [
      ['01-architecture-semantics', '01. 架构、调度语义与执行器', ['01', '02', '03', '04', '05']],
      ['02-deployment-ha', '02. 部署、高可用与 Kubernetes', ['06', '07', '08', '09']],
      ['03-governance-capacity', '03. 资源治理、安全与容量', ['10', '11', '12']],
      ['04-upgrade-troubleshooting', '04. 升级与生产故障排查', ['13', '14']],
    ],
  },
  {
    root: 'docs/data-systems/messaging/rocketmq',
    groups: [
      ['01-architecture-storage', '01. 架构、资源与存储原理', ['01', '02', '03', '04']],
      ['02-messaging-semantics', '02. 生产消费与消息语义', ['05', '06', '07', '08', '09']],
      ['03-deployment-reliability', '03. 部署、复制与可用性', ['10', '11']],
      ['04-production', '04. 容量、安全与生产运维', ['12', '13', '14']],
    ],
  },
  {
    root: 'docs/cloud-native/service-mesh/istio',
    groups: [
      ['01-architecture-install', '01. 架构、安装与数据面', ['01', '02', '03', '04']],
      ['02-traffic', '02. 流量治理与入口出口', ['05', '06', '07']],
      ['03-security-observability', '03. 身份、安全与可观测性', ['08', '09', '10']],
      ['04-production', '04. 性能、多集群与生产运维', ['11', '12', '13', '14']],
    ],
  },
  {
    root: 'docs/data-systems/messaging/rabbitmq',
    groups: [
      ['01-model-delivery', '01. AMQP 模型与可靠投递', ['01', '02', '03', '04', '05']],
      ['02-queues-cluster', '02. 队列类型与集群原理', ['06', '07']],
      ['03-deployment-security', '03. 部署、安全与多租户', ['08', '09']],
      ['04-production', '04. 容量、监控与生产运维', ['10', '11', '12', '13', '14']],
    ],
  },
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

const movedFiles = new Map();
const categories = [];

for (const product of products) {
  const prefixToDirectory = new Map();
  product.groups.forEach(([directory, label, prefixes], index) => {
    categories.push({path: `${product.root}/${directory}/_category_.json`, label, position: index + 1});
    for (const prefix of prefixes) {
      if (prefixToDirectory.has(prefix)) {
        throw new Error(`Duplicate prefix ${prefix} in ${product.root}`);
      }
      prefixToDirectory.set(prefix, directory);
    }
  });

  for (const oldPath of directMarkdownFiles(product.root)) {
    if (path.posix.basename(oldPath).startsWith('00-')) continue;
    const prefix = numericPrefix(oldPath);
    const directory = prefixToDirectory.get(prefix);
    if (!directory) throw new Error(`Unclassified document: ${oldPath}`);
    movedFiles.set(oldPath, `${product.root}/${directory}/${path.posix.basename(oldPath)}`);
  }
}

if (movedFiles.size === 0) {
  console.log('The product directories have already been migrated; no changes were made.');
  process.exit(0);
}

if (movedFiles.size !== 265) {
  throw new Error(`Expected 265 documents to move, found ${movedFiles.size}. Review the classification before continuing.`);
}

for (const [oldRelative, newRelative] of movedFiles) {
  const oldPath = safeAbsolute(oldRelative);
  const newPath = safeAbsolute(newRelative);
  if (!fs.existsSync(oldPath)) throw new Error(`Source does not exist: ${oldRelative}`);
  if (fs.existsSync(newPath)) throw new Error(`Target already exists: ${newRelative}`);
  fs.mkdirSync(path.dirname(newPath), {recursive: true});
  fs.renameSync(oldPath, newPath);
}

for (const category of categories) {
  const categoryPath = safeAbsolute(category.path);
  if (fs.existsSync(categoryPath)) throw new Error(`Category already exists: ${category.path}`);
  fs.writeFileSync(categoryPath, `${JSON.stringify({
    label: category.label,
    position: category.position,
    collapsed: true,
  }, null, 2)}\n`, 'utf8');
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
  if (relative === 'scripts/restructure-product-directories-2026.mjs') continue;

  let content = fs.readFileSync(file, 'utf8');
  if (relative.endsWith('.md') || relative.endsWith('.mdx')) {
    content = rewriteMarkdownLinks(content, relative);
  }
  for (const [oldValue, newValue] of literalReplacements) {
    content = content.replaceAll(oldValue, newValue);
  }
  fs.writeFileSync(file, content, 'utf8');
}

console.log(`Moved ${movedFiles.size} documents into ${categories.length} product topic directories.`);
