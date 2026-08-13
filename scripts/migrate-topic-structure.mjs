import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const docsRoot = path.join(repoRoot, 'docs');
const metadataRoot = path.join(
  repoRoot,
  '.docusaurus',
  'docusaurus-plugin-content-docs',
  'default',
);
const apply = process.argv.includes('--apply');

const toPosix = (value) => value.split(path.sep).join('/');
const fromPosix = (value) => path.join(...value.split('/'));
const stripNumberPrefix = (segment) => segment.replace(/^\d+[-_]/, '');
const normalizeRoute = (value) => {
  let route = value.split('#', 1)[0].split('?', 1)[0];
  try {
    route = decodeURI(route);
  } catch {
    // Docusaurus will report malformed routes during the final build.
  }
  return route.length > 1 ? route.replace(/\/+$/, '') : route;
};
const docIdForTarget = (relativeTarget) =>
  relativeTarget
    .replace(/\.(md|mdx)$/i, '')
    .split('/')
    .map(stripNumberPrefix)
    .join('/');
const permalinkForTarget = (relativeTarget) =>
  `/docs/${docIdForTarget(relativeTarget)}`;

const walkFiles = (root) => {
  const result = [];
  for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(absolute));
    if (entry.isFile()) result.push(absolute);
  }
  return result;
};

const sourceFiles = walkFiles(docsRoot)
  .filter((file) => /\.(md|mdx|json)$/i.test(file))
  .map((file) => toPosix(path.relative(docsRoot, file)))
  .sort();

const metadataBySource = new Map();
const metadataByPermalink = new Map();
const metadataById = new Map();

if (!fs.existsSync(metadataRoot)) {
  throw new Error('Docusaurus metadata is missing. Run npm run build first.');
}

for (const file of fs.readdirSync(metadataRoot)) {
  if (!file.endsWith('.json')) continue;
  let metadata;
  try {
    metadata = JSON.parse(fs.readFileSync(path.join(metadataRoot, file), 'utf8'));
  } catch {
    continue;
  }
  if (
    typeof metadata.source !== 'string' ||
    !metadata.source.startsWith('@site/docs/')
  ) {
    continue;
  }
  const source = metadata.source.slice('@site/docs/'.length);
  if (!fs.existsSync(path.join(docsRoot, fromPosix(source)))) continue;
  metadataBySource.set(source, metadata);
  metadataByPermalink.set(normalizeRoute(metadata.permalink), metadata);
  metadataById.set(metadata.id, metadata);
}

const directPrefix = (source, oldPrefix, newPrefix) => {
  if (!source.startsWith(oldPrefix)) return null;
  return `${newPrefix}${source.slice(oldPrefix.length)}`;
};

const computeArticleTargets = new Map([
  ['01-GPU 基础知识：从计算核心到显存.md', 'gpu/fundamentals/01-GPU基础知识：从计算核心到显存.md'],
  ['02-HBM显存原理：容量、带宽与访问效率.md', 'gpu/memory/01-HBM显存原理：容量、带宽与访问效率.md'],
  ['03-GPU 服务器硬件拓扑与 NUMA.md', 'gpu/pcie-numa/04-GPU服务器硬件拓扑与NUMA.md'],
  ['04-CPU与GPU之间的数据搬运.md', 'gpu/pcie-numa/05-CPU与GPU之间的数据搬运.md'],
  ['05-NVLink与NVSwitch原理.md', 'gpu/nvlink-nvswitch/01-NVLink与NVSwitch原理.md'],
  ['06-nvidia-smi 常用命令与指标说明.md', 'gpu/commands/01-nvidia-smi常用命令与指标说明.md'],
  ['07-NVIDIA 驱动、CUDA 与容器运行时的关系.md', 'gpu/driver-runtime/01-NVIDIA驱动CUDA与容器运行时的关系.md'],
  ['08-CUDA执行模型与Kernel性能基础.md', 'gpu/cuda/01-CUDA执行模型与Kernel性能基础.md'],
  ['09-GPU Roofline性能模型.md', 'gpu/performance/01-GPU-Roofline性能模型.md'],
  ['10-NUMA、PCIe与中断亲和性实验.md', 'gpu/labs/01-NUMA-PCIe与中断亲和性实验.md'],
]);

const mapCompute = (source) => {
  const prefix = 'foundations/compute/';
  if (!source.startsWith(prefix)) return null;
  const rest = source.slice(prefix.length);
  if (rest === '_category_.json') return 'gpu/_category_.json';
  if (rest === '00-计算与加速器学习路线.md') {
    return 'gpu/00-GPU与加速计算学习路线.md';
  }
  if (rest.startsWith('commands/')) {
    return `gpu/commands/${rest.slice('commands/'.length)}`;
  }
  if (rest === 'gpu/_category_.json') return null;
  if (rest.startsWith('gpu/')) {
    const name = rest.slice('gpu/'.length);
    if (!computeArticleTargets.has(name)) {
      throw new Error(`Unmapped compute article: ${source}`);
    }
    return computeArticleTargets.get(name);
  }
  if (rest === 'pcie/_category_.json') return 'gpu/pcie-numa/_category_.json';
  if (rest.startsWith('pcie/')) {
    return `gpu/pcie-numa/${rest.slice('pcie/'.length)}`;
  }
  throw new Error(`Unmapped compute file: ${source}`);
};

const mapGpuCluster = (source) => {
  const prefix = 'platform/gpu-cluster/';
  if (!source.startsWith(prefix)) return null;
  const rest = source.slice(prefix.length);
  if (rest === '_category_.json') return 'gpu/cluster/_category_.json';
  if (rest === '00-Kubernetes-GPU集群学习路线.md') {
    return 'gpu/cluster/00-Kubernetes-GPU集群学习路线.md';
  }
  if (rest === 'commands/_category_.json') return null;
  if (rest === 'commands/00-GPU调度命令参考库.md') {
    return 'gpu/commands/20-GPU调度命令参考库.md';
  }
  if (rest === 'commands/01-Volcano-vcctl命令详解.md') {
    return 'gpu/commands/21-Volcano-vcctl命令详解.md';
  }
  if (rest === 'commands/02-Kueue命令详解.md') {
    return 'gpu/commands/22-Kueue命令详解.md';
  }
  if (rest.startsWith('device-runtime/')) {
    return `gpu/cluster/device-management/${rest.slice('device-runtime/'.length)}`;
  }
  if (rest === 'scheduling-sharing/_category_.json') return null;
  if (rest.startsWith('scheduling-sharing/')) {
    const name = rest.slice('scheduling-sharing/'.length);
    const number = Number.parseInt(name, 10);
    const group = number >= 7 && number <= 11 ? 'sharing' : 'scheduling';
    return `gpu/cluster/${group}/${name}`;
  }
  for (const directory of ['dra', 'governance', 'troubleshooting']) {
    const mapped = directPrefix(
      rest,
      `${directory}/`,
      `gpu/cluster/${directory}/`,
    );
    if (mapped) return mapped;
  }
  throw new Error(`Unmapped GPU cluster file: ${source}`);
};

const mapTraditionalNetworking = (source) => {
  const prefix = 'foundations/networking/traditional/';
  if (!source.startsWith(prefix)) return undefined;
  const rest = source.slice(prefix.length);
  if (rest === '_category_.json') return null;
  if (rest === '00-传统网络从零到精通学习路线.md') {
    return 'networking/fundamentals/00-传统网络从零到精通学习路线.md';
  }
  const partOne = 'PartI-网络基础与路由/';
  if (rest.startsWith(partOne)) {
    const name = rest.slice(partOne.length);
    if (name === '_category_.json') return null;
    if (name === '00-第一阶段学习路线.md') {
      return 'networking/fundamentals/01-网络基础与路由学习路线.md';
    }
    const number = Number.parseInt(name, 10);
    if ([1, 2, 5].includes(number)) return `networking/fundamentals/${name}`;
    if ([3, 4, 6, 7, 8, 9].includes(number)) {
      return `networking/routing-switching/${name}`;
    }
    if (number === 10) return `networking/troubleshooting/${name}`;
    if (number === 11) return `networking/labs/${name}`;
  }
  const partTwo = 'PartII-数据中心与云/';
  if (rest.startsWith(partTwo)) {
    const name = rest.slice(partTwo.length);
    if (name === '_category_.json') return 'networking/datacenter/_category_.json';
    if (name === '08-GTM实现跨网访问加速与故障切换.md') {
      return `networking/load-balancing-proxy/${name}`;
    }
    if (name === '09-VXLAN-EVPN故障排查.md') {
      return `networking/troubleshooting/${name}`;
    }
    if (name === '10-数据中心Fabric综合项目.md') {
      return `networking/labs/${name}`;
    }
    return `networking/datacenter/${name}`;
  }
  const partThree = 'PartIII-自动化与智能管控/';
  if (rest.startsWith(partThree)) {
    return `networking/automation/${rest.slice(partThree.length)}`;
  }
  throw new Error(`Unmapped traditional networking file: ${source}`);
};

const mapAiNetworking = (source) => {
  const prefix = 'foundations/networking/ai-cluster/';
  if (!source.startsWith(prefix)) return undefined;
  const rest = source.slice(prefix.length);
  if (rest === '_category_.json') return 'networking/ai-fabric/_category_.json';
  if (rest === '00-AI集群网络从零到精通学习路线.md') {
    return 'networking/ai-fabric/00-AI集群网络从零到精通学习路线.md';
  }
  const partOne = 'PartI-通信与RDMA基础/';
  if (rest.startsWith(partOne)) {
    return `networking/rdma-roce/ai-cluster/${rest.slice(partOne.length)}`;
  }
  const partTwo = 'PartII-AI-Fabric与无损网络/';
  if (rest.startsWith(partTwo)) {
    return `networking/ai-fabric/fabric/${rest.slice(partTwo.length)}`;
  }
  const partThree = 'PartIII-云原生与生产运维/';
  if (rest.startsWith(partThree)) {
    return `networking/ai-fabric/production/${rest.slice(partThree.length)}`;
  }
  throw new Error(`Unmapped AI networking file: ${source}`);
};

const mapNetworking = (source) => {
  const prefix = 'foundations/networking/';
  if (!source.startsWith(prefix)) return null;
  const traditional = mapTraditionalNetworking(source);
  if (traditional !== undefined) return traditional;
  const ai = mapAiNetworking(source);
  if (ai !== undefined) return ai;
  const rest = source.slice(prefix.length);
  if (rest === '_category_.json') return 'networking/_category_.json';
  if (rest === '00-网络技术学习路线.md') return 'networking/00-网络学习路线.md';
  if (rest.startsWith('commands/')) return `networking/commands/${rest.slice(9)}`;
  if (rest.startsWith('linux-high-performance/')) {
    return `networking/high-performance/${rest.slice('linux-high-performance/'.length)}`;
  }
  if (rest.startsWith('rdma/')) {
    return `networking/rdma-roce/${rest.slice('rdma/'.length)}`;
  }
  if (rest.startsWith('nginx/')) {
    return `networking/load-balancing-proxy/nginx/${rest.slice('nginx/'.length)}`;
  }
  throw new Error(`Unmapped networking file: ${source}`);
};

const mapCeph = (source) => {
  const prefix = 'foundations/storage/ceph/';
  if (!source.startsWith(prefix)) return undefined;
  const rest = source.slice(prefix.length);
  if (rest === '_category_.json') return 'storage/ceph/_category_.json';
  if (rest === '00-Ceph学习路线.md') return 'storage/ceph/00-Ceph学习路线.md';
  const partMappings = [
    ['PartI-认识Ceph/', 'storage/ceph/01-overview/'],
    ['PartII-核心原理/', 'storage/ceph/02-architecture/'],
    ['PartIII-集群规划与部署/', 'storage/ceph/03-deployment/'],
    ['PartIV-存储使用实战/', 'storage/ceph/04-client-usage/'],
    ['PartV-日常运维与监控/', 'storage/ceph/05-operations/'],
    ['PartVI-故障排查/', 'storage/ceph/06-troubleshooting/'],
    ['PartVII-生产优化/', 'storage/ceph/07-performance/'],
    ['PartIX-AI场景/', 'storage/ceph/08-ai-workloads/'],
    ['PartVIII-综合项目/', 'projects/ceph-cluster/'],
  ];
  for (const [oldPrefix, newPrefix] of partMappings) {
    if (rest.startsWith(oldPrefix)) return `${newPrefix}${rest.slice(oldPrefix.length)}`;
  }
  throw new Error(`Unmapped Ceph file: ${source}`);
};

const mapStorage = (source) => {
  const prefix = 'foundations/storage/';
  if (!source.startsWith(prefix)) return null;
  const ceph = mapCeph(source);
  if (ceph !== undefined) return ceph;
  return `storage/${source.slice(prefix.length)}`;
};

const kubernetesDirectories = new Map([
  ['K8s学习-PartI-Kubernetes架构/', 'cloud-native/kubernetes/architecture/'],
  ['K8s学习-PartI-Pod/', 'cloud-native/kubernetes/pods-workloads/'],
  ['K8s学习-PartI-控制器/', 'cloud-native/kubernetes/controllers/'],
  ['K8s学习-PartI-身份与权限认证/', 'cloud-native/kubernetes/security/identity/'],
  ['K8s学习-PartI-集群资源管理/', 'cloud-native/kubernetes/scheduling/'],
  ['K8s学习-PartII-命令与调试/', 'cloud-native/kubernetes/troubleshooting/'],
  ['K8s学习-PartII-多集群管理/', 'cloud-native/kubernetes/multi-cluster/'],
  ['K8s学习-PartII-访问集群/', 'cloud-native/kubernetes/operations/access/'],
  ['K8s学习-PartII-部署应用/', 'cloud-native/kubernetes/operations/application-delivery/'],
  ['K8s学习-PartII-集群运维/', 'cloud-native/kubernetes/operations/cluster/'],
  ['K8s学习-PartII-开发指南/', 'cloud-native/kubernetes/extensions/development/'],
  ['K8s学习-PartII-扩展Kubernetes/', 'cloud-native/kubernetes/extensions/platform/'],
  ['K8s学习-PartIII-AI原生/', 'cloud-native/kubernetes/ai-native/'],
  ['K8s学习-PartIII-云原生/', 'cloud-native/fundamentals/'],
  ['K8s学习-PartIII-Serverless/', 'cloud-native/serverless-edge/serverless/'],
  ['K8s学习-PartIII-边缘计算/', 'cloud-native/serverless-edge/edge/'],
  ['K8s学习-PartII-服务网格/', 'cloud-native/service-mesh/'],
  ['commands/', 'cloud-native/kubernetes/commands/'],
]);

const mapKubernetes = (source) => {
  const prefix = 'platform/kubernetes/';
  if (!source.startsWith(prefix)) return null;
  const rest = source.slice(prefix.length);
  if (rest === '_category_.json') return 'cloud-native/kubernetes/_category_.json';
  if (rest === '00-Kubernetes学习路线.md') {
    return 'cloud-native/kubernetes/00-Kubernetes学习路线.md';
  }
  if (rest.startsWith('K8s学习-PartI-网络/')) {
    return `networking/kubernetes/cni/${rest.slice('K8s学习-PartI-网络/'.length)}`;
  }
  if (rest.startsWith('K8s学习-PartI-服务发现与路由/')) {
    return `networking/kubernetes/service-routing/${rest.slice('K8s学习-PartI-服务发现与路由/'.length)}`;
  }
  if (rest.startsWith('K8s学习-PartI-存储/')) {
    return `storage/kubernetes/volumes/${rest.slice('K8s学习-PartI-存储/'.length)}`;
  }
  if (rest.startsWith('K8s学习-PartII-可观测性/')) {
    return `sre/observability/kubernetes/${rest.slice('K8s学习-PartII-可观测性/'.length)}`;
  }
  const openInterfaces = 'K8s学习-PartI-开放接口/';
  if (rest.startsWith(openInterfaces)) {
    const name = rest.slice(openInterfaces.length);
    if (name === '02-容器运行时接口-CRI.md') {
      return `cloud-native/containers/interfaces/${name}`;
    }
    if (name === '03-容器网络接口-CNI.md') {
      return `networking/kubernetes/interfaces/${name}`;
    }
    if (name === '04-容器存储接口-CSI.md') {
      return `storage/kubernetes/interfaces/${name}`;
    }
    return `cloud-native/kubernetes/interfaces/${name}`;
  }
  const security = 'K8s学习-PartII-安全/';
  if (rest.startsWith(security)) {
    const name = rest.slice(security.length);
    if (name === '04-NetworkPolicy.md') {
      return `networking/kubernetes/security/${name}`;
    }
    return `cloud-native/kubernetes/security/cluster/${name}`;
  }
  for (const [oldPrefix, newPrefix] of kubernetesDirectories) {
    if (rest.startsWith(oldPrefix)) return `${newPrefix}${rest.slice(oldPrefix.length)}`;
  }
  throw new Error(`Unmapped Kubernetes file: ${source}`);
};

const mapEngineering = (source) => {
  if (source === 'engineering/00-工程能力学习地图.md') {
    return 'sre/00-SRE与生产工程学习路线.md';
  }
  const prefixRules = [
    ['engineering/observability/', 'sre/observability/'],
    ['engineering/reliability/', 'sre/reliability/'],
    ['engineering/performance/', 'sre/performance/'],
    ['engineering/incidents/', 'sre/incidents/'],
    ['engineering/automation/', 'automation/'],
  ];
  for (const [oldPrefix, newPrefix] of prefixRules) {
    if (source.startsWith(oldPrefix)) {
      return `${newPrefix}${source.slice(oldPrefix.length)}`;
    }
  }
  if (source === 'engineering/notes/Prompt-从输入到输出.md') {
    return 'ai-systems/inference/fundamentals/01-Prompt-从输入到输出.md';
  }
  if (source === 'engineering/notes/_category_.json') return null;
  return null;
};

const mapTarget = (source) => {
  if (source === 'intro.mdx' || source.startsWith('learning/')) return source;
  if (source === 'foundations/00-基础技术学习地图.md') {
    return 'learning/01-基础设施技术学习地图.md';
  }
  if (source.startsWith('foundations/compute/')) return mapCompute(source);
  if (source.startsWith('foundations/networking/')) return mapNetworking(source);
  if (source.startsWith('foundations/storage/')) return mapStorage(source);
  if (source.startsWith('foundations/linux/')) {
    return `linux/${source.slice('foundations/linux/'.length)}`;
  }
  if (source.startsWith('platform/gpu-cluster/')) return mapGpuCluster(source);
  if (source.startsWith('platform/kubernetes/')) return mapKubernetes(source);
  if (source.startsWith('platform/kubernetes-extensions/')) {
    return `cloud-native/kubernetes/extensions/ecosystem/${source.slice('platform/kubernetes-extensions/'.length)}`;
  }
  if (source === 'platform/00-平台工程学习地图.md') {
    return 'cloud-native/00-云原生与平台工程学习路线.md';
  }
  if (source.startsWith('engineering/')) return mapEngineering(source);
  if (source.startsWith('ai-systems/')) return source;
  if (source.startsWith('data-systems/hadoop/')) {
    return `data-systems/hadoop-hive/${source.slice('data-systems/hadoop/'.length)}`;
  }
  if (source.startsWith('data-systems/engineering/')) {
    return `data-systems/engineering-governance/${source.slice('data-systems/engineering/'.length)}`;
  }
  if (source.startsWith('data-systems/')) return source;
  if (source.startsWith('projects/end-to-end/')) {
    return `projects/ai-infra-end-to-end/${source.slice('projects/end-to-end/'.length)}`;
  }
  if (source.startsWith('projects/gpu-cluster/')) {
    return `projects/production-gpu-cluster/${source.slice('projects/gpu-cluster/'.length)}`;
  }
  if (source.startsWith('projects/heterogeneous-pool/')) {
    return `projects/heterogeneous-cluster/${source.slice('projects/heterogeneous-pool/'.length)}`;
  }
  if (source === 'projects/00-综合项目学习地图.md') return source;
  throw new Error(`Unmapped docs file: ${source}`);
};

const migration = new Map();
const targetOwners = new Map();
for (const source of sourceFiles) {
  const target = mapTarget(source);
  migration.set(source, target);
  if (target === null) continue;
  if (targetOwners.has(target)) {
    throw new Error(`Target collision: ${source} and ${targetOwners.get(target)} -> ${target}`);
  }
  targetOwners.set(target, source);
}

const sourceByPermalink = new Map();
for (const [source, metadata] of metadataBySource) {
  sourceByPermalink.set(normalizeRoute(metadata.permalink), source);
}

const splitTarget = (rawTarget) => {
  let target = rawTarget.trim();
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
  const hashIndex = target.indexOf('#');
  const queryIndex = target.indexOf('?');
  let cutIndex = target.length;
  if (hashIndex >= 0) cutIndex = Math.min(cutIndex, hashIndex);
  if (queryIndex >= 0) cutIndex = Math.min(cutIndex, queryIndex);
  return {
    pathPart: target.slice(0, cutIndex),
    suffix: target.slice(cutIndex),
  };
};

const resolveLinkedSource = (source, rawTarget) => {
  const {pathPart} = splitTarget(rawTarget);
  if (
    pathPart === '' ||
    pathPart.startsWith('#') ||
    /^(https?:|mailto:|tel:|data:)/i.test(pathPart)
  ) {
    return null;
  }
  if (pathPart.startsWith('/docs/')) {
    return sourceByPermalink.get(normalizeRoute(pathPart)) ?? null;
  }
  if (pathPart.startsWith('/')) return null;
  let decodedPath = pathPart;
  try {
    decodedPath = decodeURI(pathPart);
  } catch {
    return null;
  }
  if (/\.(md|mdx)$/i.test(decodedPath)) {
    const absolute = path.resolve(
      docsRoot,
      fromPosix(path.posix.dirname(source)),
      fromPosix(decodedPath),
    );
    const relative = toPosix(path.relative(docsRoot, absolute));
    return migration.has(relative) ? relative : null;
  }
  if (path.posix.extname(decodedPath) !== '') return null;
  const metadata = metadataBySource.get(source);
  if (!metadata) return null;
  const resolved = new URL(
    decodedPath,
    `https://docs.local${metadata.permalink}`,
  ).pathname;
  return sourceByPermalink.get(normalizeRoute(resolved)) ?? null;
};

const unresolvedLinks = [];
const rewriteMarkdownLinks = (source, content) => {
  const destination = migration.get(source);
  if (!destination) return content;
  return content.replace(
    /(!?\[[^\]]*]\()([^)]+)(\))/g,
    (full, opening, rawTarget, closing) => {
      if (opening.startsWith('!')) return full;
      const {pathPart, suffix} = splitTarget(rawTarget);
      if (
        pathPart === '' ||
        /^(https?:|mailto:|tel:|data:)/i.test(pathPart) ||
        (pathPart.startsWith('/') && !pathPart.startsWith('/docs/'))
      ) {
        return full;
      }
      const linkedSource = resolveLinkedSource(source, rawTarget);
      if (!linkedSource) {
        if (
          pathPart.startsWith('/docs/') ||
          (!pathPart.startsWith('/') &&
            !pathPart.startsWith('#') &&
            path.posix.extname(pathPart) === '')
        ) {
          unresolvedLinks.push({source, target: rawTarget});
        }
        return full;
      }
      const linkedTarget = migration.get(linkedSource);
      if (!linkedTarget) {
        unresolvedLinks.push({source, target: rawTarget});
        return full;
      }
      let relative = path.posix.relative(
        path.posix.dirname(destination),
        linkedTarget,
      );
      if (!relative.startsWith('.')) relative = `./${relative}`;
      relative = relative.replace(/ /g, '%20');
      return `${opening}${relative}${suffix}${closing}`;
    },
  );
};

const rewriteCategory = (source, content) => {
  const parsed = JSON.parse(content);
  const linkId = parsed?.link?.id;
  if (typeof linkId === 'string') {
    const metadata = metadataById.get(linkId);
    if (!metadata) throw new Error(`Unknown category link id ${linkId} in ${source}`);
    const linkedSource = metadata.source.slice('@site/docs/'.length);
    const linkedTarget = migration.get(linkedSource);
    if (!linkedTarget) throw new Error(`Category points to deleted document: ${source}`);
    parsed.link.id = docIdForTarget(linkedTarget);
  }
  return `${JSON.stringify(parsed, null, 2)}\n`;
};

const rewrittenContent = new Map();
for (const source of sourceFiles) {
  const target = migration.get(source);
  if (target === null) continue;
  const absolute = path.join(docsRoot, fromPosix(source));
  let content = fs.readFileSync(absolute, 'utf8');
  if (/\.(md|mdx)$/i.test(source)) content = rewriteMarkdownLinks(source, content);
  if (source.endsWith('_category_.json')) content = rewriteCategory(source, content);
  rewrittenContent.set(source, content);
}

const moves = [...migration.entries()].filter(
  ([source, target]) => target !== null && source !== target,
);
const unchanged = [...migration.entries()].filter(([, target]) => target !== null).filter(
  ([source, target]) => source === target,
);
const deleted = [...migration.entries()].filter(([, target]) => target === null);

console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);
console.log(`Source files: ${sourceFiles.length}`);
console.log(`Moves: ${moves.length}`);
console.log(`Unchanged: ${unchanged.length}`);
console.log(`Deleted obsolete category files: ${deleted.length}`);
console.log(`Resolved metadata: ${metadataBySource.size}`);
console.log(`Unresolved candidate links: ${unresolvedLinks.length}`);
for (const item of unresolvedLinks.slice(0, 50)) {
  console.log(`UNRESOLVED ${item.source} -> ${item.target}`);
}

if (!apply) {
  console.log('Dry run complete. Re-run with --apply to migrate.');
  process.exit(0);
}

for (const [, target] of moves) {
  const absoluteTarget = path.join(docsRoot, fromPosix(target));
  if (fs.existsSync(absoluteTarget)) {
    throw new Error(`Refusing to overwrite target: ${absoluteTarget}`);
  }
}

for (const [source, target] of moves) {
  const absoluteSource = path.join(docsRoot, fromPosix(source));
  const absoluteTarget = path.join(docsRoot, fromPosix(target));
  fs.mkdirSync(path.dirname(absoluteTarget), {recursive: true});
  fs.renameSync(absoluteSource, absoluteTarget);
  const content = rewrittenContent.get(source);
  if (fs.readFileSync(absoluteTarget, 'utf8') !== content) {
    fs.writeFileSync(absoluteTarget, content, 'utf8');
  }
}

for (const [source] of unchanged) {
  const absolute = path.join(docsRoot, fromPosix(source));
  const content = rewrittenContent.get(source);
  if (fs.readFileSync(absolute, 'utf8') !== content) {
    fs.writeFileSync(absolute, content, 'utf8');
  }
}

for (const [source] of deleted) {
  fs.unlinkSync(path.join(docsRoot, fromPosix(source)));
}

const directories = [];
const collectDirectories = (root) => {
  for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
    if (!entry.isDirectory()) continue;
    const absolute = path.join(root, entry.name);
    collectDirectories(absolute);
    directories.push(absolute);
  }
};
collectDirectories(docsRoot);
for (const directory of directories) {
  if (fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
}

const routeReplacements = [...metadataBySource.entries()]
  .map(([source, metadata]) => {
    const target = migration.get(source);
    if (!target) return null;
    return [metadata.permalink, permalinkForTarget(target)];
  })
  .filter(Boolean)
  .filter(([oldRoute, newRoute]) => oldRoute !== newRoute)
  .sort((a, b) => b[0].length - a[0].length);

for (const relativeFile of ['src/pages/index.js', 'README.md']) {
  const file = path.join(repoRoot, fromPosix(relativeFile));
  if (!fs.existsSync(file)) continue;
  let content = fs.readFileSync(file, 'utf8');
  const original = content;
  for (const [oldRoute, newRoute] of routeReplacements) {
    content = content.split(oldRoute).join(newRoute);
  }
  if (content !== original) fs.writeFileSync(file, content, 'utf8');
}

console.log('Topic-oriented migration applied successfully.');
