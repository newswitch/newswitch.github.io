// Offline documentation and finite teaching models, not Nginx/APISIX validation.
// Does not start a gateway, execute curl, reload config or modify etcd/routes.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import {compile} from '@mdx-js/mdx';
import yaml from 'js-yaml';

const base = 'docs/networking/load-balancing-proxy/';
const specifications = [
  {file: `${base}nginx/01-core/08-Nginx-HTTP-Phase-Module-Subrequest与Filter源码.md`, section: '7. 验收题', answers: 9},
  {file: `${base}apisix/03-APISIX性能容量-升级-选型与故障Runbook.md`, section: '5. 验收题', answers: 10},
  {file: `${base}apisix/01-APISIX-Nginx-Lua-etcd-Route-Service-Upstream与请求路径.md`},
];
const parser = unified().use(remarkParse);
const plain = node => node.value ?? node.children?.map(plain).join('') ?? '';
const stripFrontmatter = source => source.replace(/^---\n[\s\S]*?\n---\n/, '');
const anchors = source => [...source.matchAll(/\{\/\*\s*#([^*]+)\*\/\}/g)].map(match => match[1].trim());
const sectionNames = nodes => nodes.filter(node => node.type === 'heading' && node.depth === 2)
  .map(node => plain(node).replace(/^\d+\.\s+/, ''));
const articles = [];
let answers = 0;
let jsonCount = 0;

for (const specification of specifications) {
  const source = fs.readFileSync(specification.file, 'utf8').replaceAll('\r\n', '\n');
  const body = stripFrontmatter(source);
  await compile(body);
  const nodes = parser.parse(body).children;
  const baseline = execFileSync('git', ['show', `08b1c7c:${specification.file}`], {encoding: 'utf8'}).replaceAll('\r\n', '\n');
  const oldSections = sectionNames(parser.parse(stripFrontmatter(baseline)).children);
  const currentSections = sectionNames(nodes);
  let previous = -1;
  for (const name of oldSections) {
    const index = currentSections.indexOf(name);
    assert(index > previous, `Lost/reordered old topic: ${name}`);
    previous = index;
  }
  for (const anchor of anchors(baseline)) assert(anchors(source).includes(anchor), `Lost legacy anchor ${anchor}`);
  for (const field of ['title', 'sidebar_label', 'sidebar_position']) {
    const pattern = new RegExp(`^${field}:.*$`, 'm');
    assert.equal(source.match(pattern)?.[0], baseline.match(pattern)?.[0]);
  }
  const json = nodes.filter(node => node.type === 'code' && node.lang === 'json').map(node => JSON.parse(node.value));
  jsonCount += json.length;
  if (specification.section) {
    const start = nodes.findIndex(node => node.type === 'heading' && node.depth === 2 && plain(node).startsWith(specification.section));
    assert(start >= 0);
    let end = nodes.findIndex((node, index) => index > start && node.type === 'heading' && node.depth <= 2);
    if (end < 0) end = nodes.length;
    const section = nodes.slice(start + 1, end);
    const questions = section.flatMap((node, index) => node.type === 'heading' && node.depth === 3 ? [index] : []);
    assert.equal(questions.length, specification.answers);
    for (const [index, position] of questions.entries()) {
      const response = section.slice(position + 1, questions[index + 1] ?? section.length);
      assert(response.some(node => node.type === 'paragraph' && plain(node).startsWith('答案：') && plain(node).length > 3));
    }
    answers += questions.length;
  }
  articles.push({source, nodes, json});
}

const [nginx, apisix, architecture] = articles;
assert(nginx.source.includes('release-1.28.0'));
assert(apisix.source.includes('3.20.0'));
const c = nginx.nodes.find(node => node.type === 'code' && node.lang === 'c');
assert.equal(c.value.replace(/\s+/g, ''), 'if(rc==NGX_OK){r->phase_handler=ph->next;returnNGX_AGAIN;}');
// A finite generic-checker model only. Access/content have other semantics.
const generic = (result, current, next) => result === 'OK' ? {index: next, yielded: false}
  : result === 'DECLINED' ? {index: current + 1, yielded: false}
    : {index: current, yielded: true};
assert.deepEqual(generic('OK', 3, 7), {index: 7, yielded: false});
assert.deepEqual(generic('DECLINED', 3, 7), {index: 4, yielded: false});
for (const result of ['AGAIN', 'DONE']) assert.deepEqual(generic(result, 3, 7), {index: 3, yielded: true});
const filterChain = ['Tail'];
for (const name of ['A', 'B']) filterChain.unshift(name);
assert.deepEqual(filterChain, ['B', 'A', 'Tail']);
const authOutcome = code => code >= 200 && code < 300 ? 'allow' : [401, 403].includes(code) ? 'deny' : 'error';
assert.equal(authOutcome(204), 'allow');
assert.equal(authOutcome(401), 'deny');
assert.equal(authOutcome(403), 'deny');
assert.equal(authOutcome(302), 'error');
assert.equal(1000 * 2, 2000);

const nginxConfig = nginx.nodes.find(node => node.type === 'code' && node.lang === 'nginx').value;
assert(nginxConfig.includes('listen 127.0.0.1:18080;'));
assert(nginxConfig.includes('rewrite ^/legacy/(.*)$ /v2/$1 last;'));
assert(nginxConfig.includes('auth_request /_auth;'));
assert(nginxConfig.includes('log_subrequest on;'));
assert(/location = \/_auth\s*\{\s*internal;\s*return 204;/.test(nginxConfig));
const mainLog = nginx.json.find(value => value.original);
assert(mainLog);
const url = new URL(mainLog.original, 'http://phase.local');
const rewritten = url.pathname.replace(/^\/legacy\/(.*)$/, '/v2/$1');
assert.equal(rewritten, mainLog.uri);
assert.equal(url.search, '?x=1');
assert.equal(path.posix.join('/srv/phase-lab', rewritten), '/srv/phase-lab/v2/demo.txt');
assert.equal(mainLog.status, 200);
const logPieces = nginxConfig.match(/log_format phase_lab escape=json\s+([\s\S]*?);/)[1];
const mainFormat = [...logPieces.matchAll(/'([^']*)'/g)].map(match => match[1]).join('');
const mainVariables = {
  request_id: mainLog.rid, request_uri: mainLog.original,
  uri: rewritten, status: mainLog.status, request_time: mainLog.rt,
};
const renderedMain = mainFormat.replace(/\$(\w+)/g, (_, key) => {
  assert(key in mainVariables);
  return String(mainVariables[key]);
});
assert.deepEqual(JSON.parse(renderedMain), mainLog);
assert.equal(Buffer.byteLength('phase-lab\n'), 10);

const logConfig = yaml.load(apisix.nodes.find(node => node.type === 'code' && node.lang === 'yaml').value).nginx_config.http;
assert.equal(logConfig.enable_access_log, true);
assert.equal(logConfig.access_log_format_escape, 'json');
const logs = apisix.json.filter(value => value.rid);
assert.equal(logs.length, 2);
const variableMap = {
  request_id: 'rid', host: 'host', request_uri: 'uri', status: 'status',
  upstream_addr: 'upstream', upstream_status: 'us', request_time: 'rt',
  upstream_connect_time: 'uct', upstream_header_time: 'uht', upstream_response_time: 'urt',
};
for (const log of logs) {
  const rendered = logConfig.access_log_format.replace(/\$(\w+)/g, (_, variable) => {
    assert(variable in variableMap, `Not a declared native log variable: ${variable}`);
    return JSON.stringify(log[variableMap[variable]]).slice(1, -1);
  });
  assert.deepEqual(JSON.parse(rendered), log);
}

const resource = apisix.json.find(value => value.key === '/apisix/routes/demo-orders');
assert(resource);
const route = resource.value;
assert.equal(route.id, 'demo-orders');
assert.equal(route.status, 1);
assert.deepEqual(route.hosts, ['api.lab.test']);
assert.deepEqual(route.methods, ['GET']);
assert.equal(route.uri, '/v1/orders/*');
assert.equal(route.upstream.retries, 0);
assert.deepEqual(route.upstream.timeout, {connect: 1, send: 1, read: 2});
assert.equal(Object.keys(route.upstream.nodes).length, 1);
const routeMatches = (host, method, pathname) => route.hosts.includes(host)
  && route.methods.includes(method) && pathname.startsWith(route.uri.slice(0, -1));
assert.equal(routeMatches('wrong.lab.test', 'GET', '/v1/orders/1001'), false);
assert.equal(routeMatches('api.lab.test', 'GET', '/v1/orders/1001'), true);
assert.equal(routeMatches('api.lab.test', 'POST', '/v1/orders/1001'), false);
const noRoute = logs.find(log => log.status === '404');
assert.equal(noRoute.upstream, '-');
assert.equal(noRoute.us, '-');
assert.equal(apisix.json.find(value => value.error_msg)?.error_msg, '404 Route Not Found');

const observations = apisix.json.find(value => value.admin && value.data_plane_control);
assert.equal(observations.admin.modifiedIndex, 43);
assert.equal(observations.data_plane_control.orig_modifiedIndex, 42);
assert.equal(observations.data_plane_control.modifiedIndex, resource.modifiedIndex);
assert.equal(observations.data_plane_control.value.uri, route.uri);
assert.notEqual(observations.admin.value.uri, observations.data_plane_control.value.uri);
const timedOut = logs.find(log => log.status === '504');
assert.equal(timedOut.upstream, Object.keys(route.upstream.nodes)[0]);
assert.equal(timedOut.uht, '-');
assert.equal(Number(timedOut.urt) >= route.upstream.timeout.read, true);
assert.equal(Number(timedOut.uct) < route.upstream.timeout.connect, true);
assert.equal(((Number(timedOut.rt) - Number(timedOut.urt)) * 1000).toFixed(0), '4');

assert.equal(1000 * 0.08, 80);
assert.equal(2000 * 64 * 1024 / 2 ** 20, 125);
assert.equal((4 - 1) * 500, 1500);
assert.equal(1200 / 1500, 0.8);
assert.equal(((1 - 1200 / 1500) * 100).toFixed(0), '20');
assert(apisix.source.includes('单位为毫秒'));
assert(architecture.source.includes('先被认证逻辑识别'));
for (const article of articles) {
  for (const code of article.nodes.filter(node => node.type === 'code' && node.lang === 'bash')) {
    assert(!/(?:-X|--request)\s+(?:PUT|POST|PATCH|DELETE)\b/.test(code.value));
    assert(!/etcdctl[^\n]*\b(?:del|put)\b/.test(code.value));
  }
}

console.log(`PASS ${articles.length} MDX pages, ${answers} explicit answers, original section topics/anchors and navigation metadata.`);
console.log(`PASS ${jsonCount} JSON fixtures, YAML/native log formats, rewrite/auth/filter models, route/revision/timeout and capacity arithmetic.`);
console.log('No nginx -t/runtime, APISIX schema validation, curl, gateway reload, route/etcd mutation or fault test was performed.');
