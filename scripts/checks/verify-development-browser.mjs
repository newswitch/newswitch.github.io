import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

const option=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const modules=option('--node-modules'), executable=option('--browser');
if(!modules||!executable) throw new Error('Supply Playwright --node-modules and --browser executable.');
const {chromium}=createRequire(path.join(path.resolve(modules),'package.json'))('playwright');
const browser=await chromium.launch({headless:true,executablePath:path.resolve(executable)});
const base=option('--base-url')??'http://127.0.0.1:4173';
const snapshots=path.resolve('.java-article-checks/development-browser');
fs.mkdirSync(snapshots,{recursive:true});
const failures=[];
try {
  const page=await browser.newPage({viewport:{width:1440,height:1100},deviceScaleFactor:1});
  for(const name of fs.readdirSync('static/img/development').filter(n=>n.endsWith('.svg'))){
    await page.setContent(fs.readFileSync(path.join('static/img/development',name),'utf8'));
    const geometry=await page.evaluate(()=>{
      const svg=document.querySelector('svg'), view=svg.viewBox.baseVal;
      const texts=[...svg.querySelectorAll('text')].map(t=>({label:t.textContent,b:t.getBBox()}));
      return texts.flatMap((t,i)=>{
        const b=t.b,issues=[];
        if(b.x<0||b.y<0||b.x+b.width>view.width||b.y+b.height>view.height) issues.push('outside SVG: '+t.label);
        for(const other of texts.slice(i+1)){
          const c=other.b;
          if(Math.min(b.x+b.width,c.x+c.width)-Math.max(b.x,c.x)>1&&Math.min(b.y+b.height,c.y+c.height)-Math.max(b.y,c.y)>1) issues.push('text overlap: '+t.label+' / '+other.label);
        }
        return issues;
      });
    });
    failures.push(...geometry.map(message=>name+': '+message));
  }
  console.log('Checked SVG browser text geometry.');
  const data=JSON.parse(fs.readFileSync('.docusaurus/globalData.json','utf8'));
  const docs=data['docusaurus-plugin-content-docs'].default.versions.flatMap(v=>v.docs)
    .filter(d=>/^development\/(?:java|spring|spring-boot)\//u.test(d.id));
  function walk(directory){
    return fs.readdirSync(directory,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(directory,e.name)):[path.join(directory,e.name)]);
  }
  const sources=new Map();
  for(const name of ['java','spring','spring-boot']){
    for(const file of walk('docs/development/'+name).filter(f=>f.endsWith('.md'))){
      const id=path.relative('docs',file).replaceAll('\\','/').replace(/\.md$/u,'').split('/').map(s=>s.replace(/^\d+-/u,'')).join('/');
      sources.set(id,fs.readFileSync(file,'utf8'));
    }
  }
  let mermaidPages=0;
  for(const doc of docs){
    const file=path.join('build',decodeURIComponent(doc.path),'index.html');
    if(!fs.existsSync(file)) throw new Error('Missing built page '+doc.path);
    const source=sources.get(doc.id);
    if(!source) throw new Error('Source mapping missing '+doc.id);
    const expected=source.split('```mermaid').length-1;
    if(!expected) continue;
    const errors=[];
    const listener=error=>errors.push(String(error));
    page.on('pageerror',listener);
    await page.goto(base+doc.path,{waitUntil:'networkidle',timeout:45000});
    await page.waitForFunction(()=>document.querySelector('main article')!==null,{timeout:15000});
    await page.waitForFunction(count=>document.querySelectorAll('main article svg[id^="mermaid"]').length>=count,expected,{timeout:15000});
    const result=await page.evaluate(()=>({
      heading:document.querySelector('h1')?.textContent,
      diagrams:document.querySelectorAll('main article svg').length,
      syntaxError:/Syntax error in text|mermaid version/i.test(document.querySelector('main article')?.textContent??''),
      imageFailures:[...document.querySelectorAll('main article img')].filter(i=>!i.complete||i.naturalWidth===0).map(i=>i.src)
    }));
    if(result.syntaxError||result.imageFailures.length||errors.length) failures.push(doc.path+': '+JSON.stringify({result,errors}));
    mermaidPages++;
    console.log('PAGE '+mermaidPages+' '+doc.id+' diagrams='+result.diagrams);
    page.off('pageerror',listener);
  }
  if(mermaidPages<30) throw new Error('Incomplete Mermaid page coverage: '+mermaidPages);
  for(const [id,width] of [
    ['development/spring-boot/web/REST接口分层DTO与任务服务',1440],
    ['development/java/jvm/运行时内存堆外与进程RSS',1440],
    ['development/spring-boot/security/OAuth2-OIDC授权码PKCE与身份提供方',1440],
    ['development/spring-boot/web/REST接口分层DTO与任务服务',390]
  ]){
    const doc=docs.find(d=>d.id===id);
    if(!doc) throw new Error('Preview document missing: '+id);
    await page.setViewportSize({width,height:1100});
    await page.goto(base+doc.path,{waitUntil:'networkidle'});
    await page.screenshot({path:path.join(snapshots,id.split('/').at(-1)+'-'+width+'.png'),fullPage:true});
  }
  if(failures.length) throw new Error(failures.join('\n'));
  console.log('PASS 20 SVG text bounds/overlap checks and '+mermaidPages+' browser-rendered pages. Screenshots: '+snapshots);
} finally {
  await browser.close();
}
