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
const normalizeRoute = (value) => {
  let route = value.split('#', 1)[0].split('?', 1)[0];
  try {
    route = decodeURI(route);
  } catch {
    // Keep the original value. Docusaurus will report malformed URLs later.
  }
  return route.length > 1 ? route.replace(/\/+$/, '') : route;
};

const stripNumberPrefix = (segment) => segment.replace(/^\d+[-_]/, '');
const docIdForTarget = (relativeTarget) => {
  const withoutExtension = relativeTarget.replace(/\.(md|mdx)$/i, '');
  return withoutExtension.split('/').map(stripNumberPrefix).join('/');
};
const permalinkForTarget = (relativeTarget) =>
  `/docs/${docIdForTarget(relativeTarget)}`;

const assertInsideDocs = (absolutePath) => {
  const relative = path.relative(docsRoot, absolutePath);
  if (
    relative === '' ||
    relative.startsWith(`..${path.sep}`) ||
    relative === '..' ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Path escapes docs root: ${absolutePath}`);
  }
};

const walkFiles = (root) => {
  const result = [];
  for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkFiles(absolute));
    } else if (entry.isFile()) {
      result.push(absolute);
    }
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

for (const file of fs.readdirSync(metadataRoot)) {
  if (!file.endsWith('.json')) continue;
  const absolute = path.join(metadataRoot, file);
  let metadata;
  try {
    metadata = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  } catch {
    continue;
  }
  if (
    typeof metadata.source !== 'string' ||
    !metadata.source.startsWith('@site/docs/')
  ) {
    continue;
  }
  const relativeSource = metadata.source.slice('@site/docs/'.length);
  const absoluteSource = path.join(docsRoot, fromPosix(relativeSource));
  if (!fs.existsSync(absoluteSource)) continue;

  metadataBySource.set(relativeSource, metadata);
  metadataByPermalink.set(normalizeRoute(metadata.permalink), metadata);
  metadataById.set(metadata.id, metadata);
}

const gpuGroups = new Map();
const addGpuGroup = (targetDir, sourceNames) => {
  sourceNames.forEach((sourceName, index) => {
    const cleanTitle = sourceName
      .replace(/\.md$/i, '')
      .replace(/^\d+[a-z]?-/i, '');
    const targetName = `${String(index + 1).padStart(2, '0')}-${cleanTitle}.md`;
    gpuGroups.set(sourceName, `${targetDir}/${targetName}`);
  });
};

addGpuGroup('foundations/compute/gpu', [
  '01-GPU 基础知识：从计算核心到显存.md',
  '01b-HBM显存原理：容量、带宽与访问效率.md',
  '02-GPU 服务器硬件拓扑与 NUMA.md',
  '02b-CPU与GPU之间的数据搬运.md',
  '02c-NVLink与NVSwitch原理.md',
  '03-nvidia-smi 常用命令与指标说明.md',
  '04-NVIDIA 驱动、CUDA 与容器运行时的关系.md',
]);

addGpuGroup('platform/gpu-cluster/device-runtime', [
  '05-Kubernetes 如何识别和管理 GPU.md',
  '05b-NVIDIA-Device-Plugin部署与配置.md',
  '06-Pod如何使用上GPU：Device Plugin与Container Toolkit.md',
  '07-Kubernetes GPU Pod 配置详解.md',
  '09-NVIDIA GPU Operator 架构与组件说明.md',
  '10-使用 Helm 部署 GPU Operator.md',
  '11-GPU Operator 两种驱动管理模式.md',
  '12-GPU Operator 升级、回滚与节点维护.md',
]);

addGpuGroup('platform/gpu-cluster/scheduling-sharing', [
  '13-Kubernetes GPU 节点标签与调度策略.md',
  '14-GPU 节点 Taint 与 Toleration 实践.md',
  '15-GPU 集群优先级与抢占策略.md',
  '16-Volcano GPU 调度器入门.md',
  '17-Volcano Queue 与 GPU 配额管理.md',
  '18-Gang Scheduling 在分布式训练中的作用.md',
  '19-GPU 整卡独占、Time-Slicing、MPS 与 MIG 对比.md',
  '20-Kubernetes GPU Time-Slicing 配置实践.md',
  '21-MIG 原理与 Kubernetes 配置.md',
  '22-HAMi vGPU 原理与实践.md',
  '22b-HAMi-Core与Memory隔离测试.md',
  '35-GPU 集群拓扑感知调度.md',
]);

addGpuGroup('ai-systems/inference/serving', [
  '23-Kubernetes 部署 vLLM 推理服务.md',
  '24-vLLM GPU 显存组成与容量规划.md',
  '25-vLLM Tensor Parallel 多卡部署.md',
  '26-大模型服务 Kubernetes 探针设计.md',
  '27-大模型推理服务滚动升级与优雅退出.md',
  '28-大模型推理服务性能指标设计.md',
]);

addGpuGroup('ai-systems/training/distributed', [
  '29-Kubernetes 分布式训练基础.md',
  '30-PyTorch DDP 在 Kubernetes 中的部署.md',
  '31-DeepSpeed ZeRO 与 GPU 显存优化.md',
  '32-训练任务 Checkpoint 与断点恢复.md',
  '33-NCCL 通信原理与常见问题.md',
]);

addGpuGroup('foundations/networking/ai-cluster', [
  '34-InfiniBand、RoCE 与 GPU 集群网络.md',
  '34b-GPUDirect-RDMA原理与实践.md',
]);

addGpuGroup('foundations/storage/ai-workloads', [
  '36b-AI工作负载的存储IO模型.md',
  '36c-GPUDirect-Storage原理与实践.md',
  '36d-本地NVMe与Local-PV实践.md',
  '36g-对象存储与模型仓库设计.md',
  '36h-Kubernetes-CSI挂载链路与故障排查.md',
  '36-大模型文件在 Kubernetes 中的存储方案.md',
  '37-大模型冷启动优化.md',
]);

addGpuGroup('engineering/observability/gpu', [
  '38-DCGM Exporter GPU 监控指标详解.md',
  '39-Prometheus GPU 告警策略设计.md',
  '40-Grafana GPU 集群总览看板设计.md',
  '41-GPU 利用率低但显存占满怎么分析.md',
  '42-大模型业务指标与 GPU 指标关联分析.md',
]);

addGpuGroup('platform/gpu-cluster/troubleshooting', [
  '08-GPU Pod 一直 Pending 的排查流程.md',
  '43-GPU 集群六层排障模型.md',
  '44-nvidia-smi 失败排查.md',
  '45-Pod 分配 GPU 后看不到 GPU.md',
  '46-CUDA OOM 排查与优化.md',
  '47-NVIDIA Xid 错误排查.md',
  '48-NCCL Timeout 排查流程.md',
  '49-GPU 节点 NotReady 的处理流程.md',
  '50-GPU Pod 启动但服务无法响应的排查.md',
]);

addGpuGroup('platform/gpu-cluster/governance', [
  '51-生产 GPU 集群节点池规划.md',
  '52-GPU 多租户与资源配额设计.md',
  '53-GPU 集群容量规划方法.md',
  '54-GPU 集群成本与利用率分析.md',
  '55-GPU 集群升级与变更管理.md',
  '56-GPU 节点巡检体系设计.md',
]);

addGpuGroup('projects/gpu-cluster', [
  '57-生产级 Kubernetes GPU 集群架构设计.md',
  '58-GPU 集群完整部署实录.md',
  '59-GPU 集群故障演练记录.md',
  '60-Kubernetes GPU 集群学习总结.md',
]);

addGpuGroup('projects/end-to-end', [
  '57b-一个GPU-Pod从提交到开始计算经历了什么.md',
  '57c-模型文件从存储加载到GPU显存的完整路径.md',
  '57d-单机八卡训练的完整路径.md',
  '57e-多机训练的完整路径.md',
  '57f-GPU网卡存储联合拓扑调度.md',
]);

addGpuGroup('platform/gpu-cluster/dra', [
  '61-Kubernetes DRA 概念与核心 API（v1.35+）.md',
  '62-DRA 集群安装与设备分配实践（v1.34+）.md',
]);

gpuGroups.set(
  '00-Kubernetes-GPU集群学习路线.md',
  'platform/gpu-cluster/00-Kubernetes-GPU集群学习路线.md',
);
gpuGroups.set(
  '36e-NFS在AI集群中的使用与性能分析.md',
  'foundations/storage/nfs/01-NFS在AI集群中的使用与性能分析.md',
);
gpuGroups.set(
  '36f-Ceph三种接口在AI集群中的选型.md',
  'foundations/storage/ceph/PartIX-AI场景/30-AI集群中的Ceph接口选型.md',
);

const reliabilityRenames = new Map([
  ['09-LLM服务SLI-SLO-SLA工程化.md', '01-LLM服务SLI-SLO-SLA工程化.md'],
  ['10-Error-Budget与多窗口燃烧率告警.md', '02-Error-Budget与多窗口燃烧率告警.md'],
  ['11-AI平台事件响应证据链与RCA.md', '03-AI平台事件响应证据链与RCA.md'],
  ['12-Toil量化与安全自动修复.md', '04-Toil量化与安全自动修复.md'],
]);

const deletedSources = new Set([
  'cloud-native-ai/k8s-gpu/_category_.json',
  'infrastructure/_category_.json',
]);

const mapTarget = (source) => {
  if (source === 'intro.mdx') return source;
  if (deletedSources.has(source)) return null;

  if (source === 'cloud-native-ai/00-AI-Infra技术模块学习地图.md') {
    return 'learning/00-AI-Infra技术模块学习地图.md';
  }

  const k8sPrefix = 'cloud-native-ai/k8s/';
  if (source.startsWith(k8sPrefix)) {
    const rest = source.slice(k8sPrefix.length);
    const observabilityPrefix = 'K8s学习-PartII-可观测性/';
    if (rest.startsWith(observabilityPrefix)) {
      const name = rest.slice(observabilityPrefix.length);
      if (reliabilityRenames.has(name)) {
        return `engineering/reliability/${reliabilityRenames.get(name)}`;
      }
    }
    return `platform/kubernetes/${rest}`;
  }

  const gpuPrefix = 'cloud-native-ai/k8s-gpu/';
  if (source.startsWith(gpuPrefix)) {
    const name = source.slice(gpuPrefix.length);
    if (!gpuGroups.has(name)) {
      throw new Error(`Unmapped k8s-gpu file: ${source}`);
    }
    return gpuGroups.get(name);
  }

  const prefixRules = [
    ['cloud-native-ai/vllm/', 'ai-systems/inference/vllm/'],
    ['cloud-native-ai/mlops/', 'ai-systems/mlops/'],
    ['cloud-native-ai/hetero-pool/', 'projects/heterogeneous-pool/'],
    ['cloud-native-ai/cloud-native/', 'platform/kubernetes-extensions/'],
    ['network-hardware/traditional-networking/', 'foundations/networking/traditional/'],
    ['network-hardware/linux-hpn/', 'foundations/networking/linux-high-performance/'],
    ['network-hardware/rdma/', 'foundations/networking/rdma/'],
    ['network-hardware/ai-networking/', 'foundations/networking/ai-cluster/'],
    ['network-hardware/nginx/', 'foundations/networking/nginx/'],
    ['infrastructure/ceph/', 'foundations/storage/ceph/'],
    ['infrastructure/nfs/', 'foundations/storage/nfs/'],
    ['infrastructure/storage/', 'foundations/storage/'],
    ['infrastructure/pcie/', 'foundations/compute/pcie/'],
    ['engineering/ops/', 'engineering/incidents/'],
  ];

  for (const [oldPrefix, newPrefix] of prefixRules) {
    if (source.startsWith(oldPrefix)) {
      return `${newPrefix}${source.slice(oldPrefix.length)}`;
    }
  }

  if (source.startsWith('engineering/')) return source;
  throw new Error(`Unmapped docs file: ${source}`);
};

const migration = new Map();
const targetOwners = new Map();
for (const source of sourceFiles) {
  const target = mapTarget(source);
  migration.set(source, target);
  if (target === null) continue;
  if (targetOwners.has(target)) {
    throw new Error(
      `Target collision: ${source} and ${targetOwners.get(target)} -> ${target}`,
    );
  }
  targetOwners.set(target, source);
}

if (gpuGroups.size !== 81) {
  throw new Error(`Expected 81 k8s-gpu docs, mapped ${gpuGroups.size}`);
}

const sourceByPermalink = new Map();
for (const [source, metadata] of metadataBySource) {
  sourceByPermalink.set(normalizeRoute(metadata.permalink), source);
}

const splitTarget = (rawTarget) => {
  let target = rawTarget.trim();
  let angleWrapped = false;
  if (target.startsWith('<') && target.endsWith('>')) {
    angleWrapped = true;
    target = target.slice(1, -1);
  }
  const hashIndex = target.indexOf('#');
  const queryIndex = target.indexOf('?');
  let cutIndex = target.length;
  if (hashIndex >= 0) cutIndex = Math.min(cutIndex, hashIndex);
  if (queryIndex >= 0) cutIndex = Math.min(cutIndex, queryIndex);
  return {
    target,
    pathPart: target.slice(0, cutIndex),
    suffix: target.slice(cutIndex),
    angleWrapped,
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
    if (!metadata) {
      throw new Error(`Unknown category link id ${linkId} in ${source}`);
    }
    const linkedSource = metadata.source.slice('@site/docs/'.length);
    const linkedTarget = migration.get(linkedSource);
    if (!linkedTarget) {
      throw new Error(`Category points to deleted document: ${source}`);
    }
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
  if (/\.(md|mdx)$/i.test(source)) {
    content = rewriteMarkdownLinks(source, content);
  } else if (source.endsWith('_category_.json')) {
    content = rewriteCategory(source, content);
  }
  rewrittenContent.set(source, content);
}

const moves = [...migration.entries()].filter(
  ([source, target]) => target !== null && source !== target,
);
const unchanged = [...migration.entries()].filter(
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

for (const item of unresolvedLinks.slice(0, 40)) {
  console.log(`UNRESOLVED ${item.source} -> ${item.target}`);
}

if (!apply) {
  console.log('Dry run complete. Re-run with --apply to migrate.');
  process.exit(0);
}

for (const [, target] of moves) {
  const absoluteTarget = path.join(docsRoot, fromPosix(target));
  assertInsideDocs(absoluteTarget);
  if (fs.existsSync(absoluteTarget)) {
    throw new Error(`Refusing to overwrite target: ${absoluteTarget}`);
  }
}

for (const [source, target] of moves) {
  const absoluteSource = path.join(docsRoot, fromPosix(source));
  const absoluteTarget = path.join(docsRoot, fromPosix(target));
  assertInsideDocs(absoluteSource);
  assertInsideDocs(absoluteTarget);
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
  const absolute = path.join(docsRoot, fromPosix(source));
  assertInsideDocs(absolute);
  fs.unlinkSync(absolute);
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
  if (fs.readdirSync(directory).length === 0) {
    fs.rmdirSync(directory);
  }
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

const projectTextFiles = [
  path.join(repoRoot, 'src', 'pages', 'index.js'),
  path.join(repoRoot, 'README.md'),
].filter(fs.existsSync);

for (const file of projectTextFiles) {
  let content = fs.readFileSync(file, 'utf8');
  const original = content;
  for (const [oldRoute, newRoute] of routeReplacements) {
    content = content.split(oldRoute).join(newRoute);
  }
  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
  }
}

console.log('Migration applied successfully.');
