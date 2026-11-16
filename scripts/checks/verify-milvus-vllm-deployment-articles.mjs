// Offline article contracts and finite teaching models only.
// Does not render Helm, contact Kubernetes/S3/etcd, load a model or inject faults.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import {compile} from '@mdx-js/mdx';
import yaml from 'js-yaml';

const specifications = [
  {file: 'docs/data-systems/vector-databases/milvus/02-storage-index/09-etcd-Woodpecker与S3-MinIO依赖原理.md', exercise: '6. 验收题'},
  {file: 'docs/ai-systems/inference/serving/01-Kubernetes 部署 vLLM 推理服务.md', exercise: '10. 验收题'},
];
const parser = unified().use(remarkParse);
const plain = node => node.value ?? node.children?.map(plain).join('') ?? '';
const body = source => source.replace(/^---\n[\s\S]*?\n---\n/, '');
const anchors = source => [...source.matchAll(/\{\/\*\s*#([^*]+)\*\/\}/g)].map(match => match[1].trim());
const topics = nodes => nodes.filter(node => node.type === 'heading' && node.depth === 2)
  .map(node => plain(node).replace(/^\d+\.\s+/, ''));
const articles = [];
let answers = 0;
let yamlBlocks = 0;

for (const specification of specifications) {
  const source = fs.readFileSync(specification.file, 'utf8').replaceAll('\r\n', '\n');
  const old = execFileSync('git', ['show', `3e931c4:${specification.file}`], {encoding: 'utf8'}).replaceAll('\r\n', '\n');
  await compile(body(source));
  const nodes = parser.parse(body(source)).children;
  const currentTopics = topics(nodes);
  let previous = -1;
  for (const topic of topics(parser.parse(body(old)).children)) {
    const position = currentTopics.indexOf(topic);
    assert(position > previous, `Lost or reordered topic: ${topic}`);
    previous = position;
  }
  for (const anchor of anchors(old)) assert(anchors(source).includes(anchor), `Lost anchor: ${anchor}`);
  for (const field of ['title', 'sidebar_label', 'sidebar_position']) {
    const pattern = new RegExp(`^${field}:.*$`, 'm');
    assert.equal(source.match(pattern)?.[0], old.match(pattern)?.[0]);
  }
  const start = nodes.findIndex(node => node.type === 'heading' && node.depth === 2 && plain(node).startsWith(specification.exercise));
  assert(start >= 0);
  let end = nodes.findIndex((node, index) => index > start && node.type === 'heading' && node.depth <= 2);
  if (end < 0) end = nodes.length;
  const section = nodes.slice(start + 1, end);
  const questions = section.flatMap((node, index) => node.type === 'heading' && node.depth === 3 ? [index] : []);
  assert.equal(questions.length, 10);
  for (const [index, position] of questions.entries()) {
    const response = section.slice(position + 1, questions[index + 1] ?? section.length);
    assert(response.some(node => node.type === 'paragraph' && plain(node).startsWith('答案：') && plain(node).length > 3));
  }
  answers += questions.length;
  const yamlCode = nodes.filter(node => node.type === 'code' && node.lang === 'yaml');
  const documents = yamlCode.flatMap(node => yaml.loadAll(node.value));
  yamlBlocks += yamlCode.length;
  const json = nodes.filter(node => node.type === 'code' && node.lang === 'json').map(node => JSON.parse(node.value));
  articles.push({source, nodes, documents, json});
}

const [milvus, vllm] = articles;
assert(milvus.source.includes('v3.0.6') && milvus.source.includes('v0.1.46'));
assert.deepEqual(milvus.documents, [{mq: {type: 'woodpecker'}, woodpecker: {storage: {type: 'minio'}}, common: {storage: {useLoonFFI: false}}}]);
assert.equal(milvus.json.length, 1);
assert.equal(milvus.json[0].Bytes / 2 ** 20, 100);
assert.equal(4 * 7200, 28800);
assert.equal(28800 / 1024, 28.125);
assert(milvus.source.includes('28.125 GiB'));

// One fictional WAL, not a simulation of Milvus recovery or a TSO subtraction.
const states = [
  {time: 'T0', ack: 104, objects: 100, checkpoint: 100, indexed: false, loaded: false},
  {time: 'T1', ack: 104, objects: 104, checkpoint: 100, indexed: false, loaded: false},
  {time: 'T2', ack: 104, objects: 104, checkpoint: 104, indexed: false, loaded: false},
  {time: 'T3', ack: 104, objects: 104, checkpoint: 104, indexed: true, loaded: false},
  {time: 'T4', ack: 104, objects: 104, checkpoint: 104, indexed: true, loaded: true},
];
for (const state of states) {
  assert(state.checkpoint <= state.objects && state.objects <= state.ack);
  assert(!state.loaded || state.indexed);
  assert(milvus.source.includes(`| ${state.time} |`));
}
const needed = state => Array.from({length: state.ack - state.checkpoint}, (_, index) => state.checkpoint + index + 1);
assert.deepEqual(needed(states[0]), [101, 102, 103, 104]);
assert.deepEqual(needed(states[1]), [101, 102, 103, 104]);
assert.deepEqual(needed(states[2]), []);
// Toy Aq examples: three contacted replicas do not define the acknowledgment rule.
const acknowledged = (entry, results, aq) => results.filter(result => !result.error && result.synced >= entry).length >= aq;
assert.equal(acknowledged(104, [{synced: 104}, {synced: 103}, {synced: 104}], 3), false);
assert.equal(acknowledged(104, [{synced: 104}, {synced: 103}, {synced: 104}], 2), true);
assert.equal(acknowledged(104, [{synced: 104, error: true}], 1), false);
const accepted = [1001, 1002, 1003];
const restored = new Set([1001, 1003]);
assert.equal(Math.max(...accepted), Math.max(...restored));
assert.deepEqual(accepted.filter(id => !restored.has(id)), [1002]);

const namespace = vllm.documents.find(doc => doc.kind === 'Namespace');
const pvc = vllm.documents.find(doc => doc.kind === 'PersistentVolumeClaim');
const deployment = vllm.documents.find(doc => doc.kind === 'Deployment');
const service = vllm.documents.find(doc => doc.kind === 'Service');
assert(namespace && pvc && deployment && service);
for (const object of [pvc, deployment, service]) assert.equal(object.metadata.namespace, namespace.metadata.name);
assert(!Object.hasOwn(pvc.spec, 'storageClassName'), 'Public default-SC example must not assume an SC literally called default');
assert.deepEqual(pvc.spec.accessModes, ['ReadWriteOnce']);
assert.equal(deployment.spec.replicas, 1);
assert.equal(deployment.spec.strategy.type, 'Recreate');
const pod = deployment.spec.template.spec;
const container = pod.containers[0];
assert.equal(container.image, 'vllm/vllm-openai:v0.31.0');
assert.deepEqual(container.command, ['vllm', 'serve']);
assert(container.args.every(arg => typeof arg === 'string'));
const flag = name => container.args[container.args.indexOf(name) + 1];
const revision = '7ae557604adf67be50417f59c2c2f167def9a775';
assert.equal(flag('--revision'), revision);
assert.equal(container.args[0], 'Qwen/Qwen2.5-0.5B-Instruct');
assert.equal(flag('--served-model-name'), service.metadata.name);
assert.equal(flag('--dtype'), 'half');
assert(!container.args.includes('--trust-remote-code'));
assert(!JSON.stringify(pod).includes('secretKeyRef'), 'Public variant must start without a Secret dependency');
const secret = vllm.documents.find(doc => Array.isArray(doc) && doc[0]?.name === 'HF_TOKEN')[0];
assert.deepEqual(secret.valueFrom.secretKeyRef, {name: 'hf-token-secret', key: 'token'});
assert.equal(container.resources.requests['nvidia.com/gpu'], container.resources.limits['nvidia.com/gpu']);
assert.equal(Number(flag('--tensor-parallel-size')), Number(container.resources.limits['nvidia.com/gpu']));
assert(Number(flag('--gpu-memory-utilization')) > 0 && Number(flag('--gpu-memory-utilization')) <= 1);
assert(Number(flag('--max-num-seqs')) > 0);
assert(Number(flag('--max-num-batched-tokens')) >= Number(flag('--max-model-len')));
assert.equal(pod.volumes.find(volume => volume.name === 'cache-volume').persistentVolumeClaim.claimName, pvc.metadata.name);
const cachePath = container.volumeMounts.find(volume => volume.name === 'cache-volume').mountPath;
assert(container.env.find(env => env.name === 'HF_HOME').value.startsWith(`${cachePath}/`));
assert.deepEqual(pod.volumes.find(volume => volume.name === 'shm').emptyDir, {medium: 'Memory', sizeLimit: '2Gi'});
assert.equal(container.volumeMounts.find(volume => volume.name === 'shm').mountPath, '/dev/shm');
assert(!pod.hostIPC && !pod.hostNetwork && !container.securityContext?.privileged);
assert.deepEqual(service.spec.selector, deployment.spec.selector.matchLabels);
assert.deepEqual(service.spec.selector, deployment.spec.template.metadata.labels);
assert.equal(service.spec.type, 'ClusterIP');
assert.equal(service.spec.ports[0].targetPort, container.ports[0].name);
assert.equal(container.ports[0].containerPort, Number(flag('--port')));
for (const name of ['startupProbe', 'readinessProbe', 'livenessProbe']) {
  assert.equal(container[name].httpGet.path, '/health');
  assert.equal(container[name].httpGet.port, container.ports[0].name);
}
assert.equal(container.startupProbe.failureThreshold * container.startupProbe.periodSeconds, 1200);
assert.equal(deployment.spec.progressDeadlineSeconds, 1800);
const grpc = vllm.documents.find(doc => doc.startupProbe?.grpc);
for (const name of ['startupProbe', 'readinessProbe', 'livenessProbe']) assert.equal(grpc[name].grpc.port, grpc.ports[0].containerPort);
const endpoints = vllm.documents.find(doc => doc.endpoints);
assert.equal(endpoints.ports[0].port, container.ports[0].containerPort);
assert.equal(endpoints.endpoints[0].conditions.ready, true);

// Finite distinction between startup gating, readiness removal and restart.
// No kubelet timer/concurrency/EndpointSlice propagation is modeled.
const probeAction = ({started, probe, failures}) => {
  if (!started && probe !== 'startupProbe') return 'gated';
  if (failures < container[probe].failureThreshold) return 'wait';
  return probe === 'readinessProbe' ? 'not-ready' : 'restart';
};
assert.equal(probeAction({started: false, probe: 'livenessProbe', failures: 6}), 'gated');
assert.equal(probeAction({started: false, probe: 'startupProbe', failures: 119}), 'wait');
assert.equal(probeAction({started: false, probe: 'startupProbe', failures: 120}), 'restart');
assert.equal(probeAction({started: true, probe: 'readinessProbe', failures: 3}), 'not-ready');
assert.equal(probeAction({started: true, probe: 'livenessProbe', failures: 6}), 'restart');

// Values consistency only, not Go-template rendering or full Chart schema validation.
const stack = vllm.documents.find(doc => doc.servingEngineSpec);
const model = stack.servingEngineSpec.modelSpec[0];
assert.equal(stack.routerSpec.enableRouter, false);
assert.equal(model.lmcacheConfig.enabled, false);
assert.equal(model.hf_token, '');
assert.equal(model.repository + ':' + model.tag, container.image);
assert.equal(model.modelRevision, revision);
assert.equal(model.modelURL, container.args[0]);
assert.equal(model.requestGPU, Number(container.resources.requests['nvidia.com/gpu']));
assert.equal(model.requestGPUType, 'nvidia.com/gpu');
assert.equal(model.vllmConfig.v0, '0');
assert.equal(model.vllmConfig.tensorParallelSize, Number(flag('--tensor-parallel-size')));
assert.equal(model.vllmConfig.maxModelLen, Number(flag('--max-model-len')));
assert.equal(model.vllmConfig.maxNumSeqs, Number(flag('--max-num-seqs')));
assert.equal(model.vllmConfig.gpuMemoryUtilization, Number(flag('--gpu-memory-utilization')));
assert.equal(model.vllmConfig.dtype, flag('--dtype'));
assert.deepEqual(model.vllmConfig.extraArgs, ['--max-num-batched-tokens', flag('--max-num-batched-tokens')]);
assert.equal(model.shmSize, '2Gi');
assert.equal(model.pvcStorage, pvc.spec.resources.requests.storage);
assert.equal(stack.servingEngineSpec.strategy.type, 'Recreate');
for (const name of ['startupProbe', 'readinessProbe', 'livenessProbe']) {
  const probe = stack.servingEngineSpec[name];
  assert.equal(probe.initialDelaySeconds, 15);
  for (const key of ['periodSeconds', 'failureThreshold', 'timeoutSeconds']) assert.equal(probe[key], container[name][key]);
  assert.equal(probe.httpGet.port, 8000);
}
const curl = vllm.nodes.find(node => node.type === 'code' && node.lang === 'bash' && node.value.includes('/v1/chat/completions'));
const request = JSON.parse(curl.value.match(/-d '([^']+)'/)[1]);
assert.equal(request.model, flag('--served-model-name'));
assert(request.messages[0].content.length > 0 && request.max_tokens <= Number(flag('--max-model-len')));
assert(vllm.source.includes('--version 0.1.14'));
assert(!vllm.nodes.filter(node => node.type === 'code').some(node => /:latest\b/.test(node.value)));

console.log(`PASS: ${articles.length} MDX pages, ${answers} answers, ${yamlBlocks} YAML blocks, JSON/request and preserved metadata/topics/anchors.`);
console.log('PASS: finite WAL/checkpoint/Aq/set examples, deployment references, resource/port/probe and pinned values consistency.');
console.log('Offline only: no Helm rendering, full Kubernetes/Chart schema, live service, model, recovery or performance validation.');
