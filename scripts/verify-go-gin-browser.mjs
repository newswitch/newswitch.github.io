import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';

const option=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
if(!option('--node-modules')||!option('--browser'))throw new Error('Supply --node-modules and --browser.');
const {chromium}=createRequire(path.join(path.resolve(option('--node-modules')),'package.json'))('playwright');
const root=path.resolve('build');
const server=http.createServer((request,response)=>{
  try {
    const pathname=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname);
    let file=path.resolve(root,'.'+pathname);
    if(file!==root&&!file.startsWith(root+path.sep)){response.writeHead(403).end();return;}
    if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
    if(!fs.existsSync(file)){response.writeHead(404).end();return;}
    const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.woff2':'font/woff2'};
    response.setHeader('Content-Type',types[path.extname(file)]??'application/octet-stream');response.end(fs.readFileSync(file));
  }catch{response.writeHead(400).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  const data=JSON.parse(fs.readFileSync('.docusaurus/globalData.json','utf8'));
  const docs=data['docusaurus-plugin-content-docs'].default.versions.flatMap(v=>v.docs).filter(d=>/^development\/(go|gin)\//.test(d.id));
  if(docs.length!==82)throw new Error('Expected 82 Go/Gin pages, found '+docs.length);
  const base='http://127.0.0.1:'+server.address().port;
  for(const doc of docs){const response=await fetch(base+doc.path);const html=await response.text();if(response.status!==200||!html.includes('<h1'))throw new Error('Invalid built page '+doc.path);}
  browser=await chromium.launch({headless:true,executablePath:path.resolve(option('--browser'))});
  const selected=docs.filter(d=>/Go学习路线|Gin学习路线|GMP调度|分配器GC|GOGC-GOMEMLIMIT|CPU-Pprof|Heap-Alloc|Goroutine-Mutex|ExecutionTrace|小切片保留|Schema迁移|JWT认证|Session-Cookie|容量压测|超时内存增长|SQL执行前超时/u.test(d.id));
  if(selected.length!==16)throw new Error('Expected 16 deepening/route pages, found '+selected.length);
  const output=path.resolve('.go-article-checks/deepening-browser');fs.mkdirSync(output,{recursive:true});
  let checked=0;
  for(const width of [1440,390]){
    const page=await browser.newPage({viewport:{width,height:1000}});let errors=[];page.on('pageerror',error=>errors.push(String(error)));
    for(const doc of selected){
      errors=[];await page.goto(base+doc.path,{waitUntil:'networkidle',timeout:45000});await page.waitForSelector('main article h1');
      if(/GMP调度|小切片保留|Session-Cookie|JWT认证|SQL执行前超时/u.test(doc.id))await page.waitForFunction(()=>document.querySelectorAll('main article svg[id^="mermaid"]').length===1,null,{timeout:15000});
      const text=await page.locator('main article').innerText();
      if(/Syntax error in text|mermaid version/u.test(text)||(!/学习路线/u.test(doc.id)&&!text.includes('练习与答案')))throw new Error('Content failed '+doc.id);
      const bad=await page.evaluate(()=>({images:[...document.querySelectorAll('main article img')].filter(i=>!i.complete||!i.naturalWidth).length,overflow:document.documentElement.scrollWidth>window.innerWidth+2}));
      if(bad.images||bad.overflow||errors.length)throw new Error(doc.id+' '+JSON.stringify({bad,errors}));
      if(/GMP调度|小切片保留|Session-Cookie|JWT认证|SQL执行前超时|学习路线/u.test(doc.id)){
        await page.screenshot({path:path.join(output,doc.id.split('/').at(-1)+'-'+width+'.png'),fullPage:true});
        const figures=page.locator('main article svg[id^="mermaid"]');for(let i=0;i<await figures.count();i++)await figures.nth(i).screenshot({path:path.join(output,doc.id.split('/').at(-1)+'-diagram-'+i+'-'+width+'.png')});
      }
      checked++;console.log('PASS '+width+' '+doc.id);
    }
    await page.close();
  }
  fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({builtPages:docs.length,viewportChecks:checked,widths:[1440,390]},null,2)+'\n');
  console.log('PASS all 82 built routes; '+checked+' desktop/mobile page checks.');
}finally{
  if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
