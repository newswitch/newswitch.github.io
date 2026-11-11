import fs from 'node:fs';
import path from 'node:path';
import {compile} from '@mdx-js/mdx';

const root=process.cwd(), base=path.join(root,'docs/development');
function files(directory){
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(directory,e.name)):[path.join(directory,e.name)]);
}
let total=0, diagrams=0;
const newDocs=[];
for(const [name,expected] of [['java',57],['spring',29],['spring-boot',49]]){
  const docs=files(path.join(base,name)).filter(f=>f.endsWith('.md'));
  if(docs.length!==expected) throw new Error(name+': expected '+expected+', got '+docs.length);
  for(const file of docs){
    const markdown=fs.readFileSync(file,'utf8').replaceAll('\r\n','\n');
    const body=markdown.replace(/^---\n[\s\S]*?\n---\n/u,'');
    await compile(body);
    for(const match of body.matchAll(/!\[[^\]]*\]\((\/img\/development\/[^)]+)\)/gu)){
      if(!fs.existsSync(path.join(root,'static',match[1]))) throw new Error('Missing diagram '+match[1]);
      diagrams++;
    }
    if(file.includes('spring-boot')&&!file.includes('01-startup-configuration')&&!path.basename(file).startsWith('00-')){
      newDocs.push(file);
      if(!body.includes('练习与答案')) throw new Error('Answers absent '+file);
      const answers=body.split('练习与答案')[1].match(/^### \d+\.\d+ /gmu)??[];
      if(answers.length!==3) throw new Error('Expected three answered exercises '+file);
      if(!/https:\/\/(?:docs\.|github\.|www\.|mybatis\.|hibernate\.|documentation\.|debezium\.|resilience4j\.|nacos\.|kafka\.|opentelemetry\.|grafana\.|kubernetes\.)/u.test(body)) throw new Error('Official reference absent '+file);
    }
    total++;
  }
}
if(newDocs.length!==42) throw new Error('Expected 42 post-startup articles');
for(const folder of ['02-web','03-data','04-integrations','05-security','06-production']){
  const category=JSON.parse(fs.readFileSync(path.join(base,'spring-boot',folder,'_category_.json'),'utf8'));
  if(category.collapsed!==true || category.link!==null) throw new Error('Invalid category '+folder);
}
const svgs=fs.readdirSync(path.join(root,'static/img/development')).filter(n=>n.endsWith('.svg'));
if(svgs.length!==20) throw new Error('Expected 20 SVGs');
for(const name of svgs){
  const source=fs.readFileSync(path.join(root,'static/img/development',name),'utf8');
  if(!source.includes('<title')||!source.includes('<desc')) throw new Error('Accessible labels absent '+name);
  if(/<script|<foreignObject|href=/u.test(source)) throw new Error('Unexpected external or active SVG content '+name);
}
console.log('PASS '+total+' MDX articles, 42 post-startup articles / 126 answered exercises, '+svgs.length+' SVGs / '+diagrams+' placements.');
if(process.argv.includes('--check-build')){
  const data=JSON.parse(fs.readFileSync('.docusaurus/globalData.json','utf8'));
  const docs=data['docusaurus-plugin-content-docs'].default.versions.flatMap(v=>v.docs)
    .filter(d=>/^development\/(?:java|spring|spring-boot)\//u.test(d.id));
  if(docs.length!==135) throw new Error('Expected 135 built documents');
  for(const doc of docs){
    const file=path.join(root,'build',decodeURIComponent(doc.path),'index.html');
    if(!fs.existsSync(file)) throw new Error('Missing built page '+doc.path);
    const html=fs.readFileSync(file,'utf8');
    if(!html.includes('练习与答案')) throw new Error('Built answers missing '+doc.path);
  }
  for(const name of svgs){
    if(!fs.readFileSync(path.join(root,'static/img/development',name))
      .equals(fs.readFileSync(path.join(root,'build/img/development',name)))) throw new Error('Stale built SVG '+name);
  }
  for(const [slug,sentence] of [
    ['测试分层切片集成与Testcontainers','配套自动化实验不包含 Testcontainers'],
    ['JAR-systemd信号与优雅退出','配套 Windows 自动化实验验证 Boot 构建与请求'],
    ['Docker-Buildpacks分层镜像与JVM','配套自动化实验验证 JVM/JAR 路径'],
    ['Kubernetes探针资源摘流与滚动更新','该清单需在隔离测试集群中验证'],
    ['依赖兼容行为变化与升级回归','配套的 31 项服务测试覆盖明确的本地边界']
  ]){
    const html=fs.readFileSync(path.join(root,'build/docs/development/spring-boot/production',slug,'index.html'),'utf8');
    if(!html.includes(sentence)) throw new Error('Stale built text '+slug);
  }
  console.log('PASS 135 built pages, 20 exact SVG assets and final article wording.');
}
