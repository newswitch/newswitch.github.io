import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';

const option=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
if(!option('--node-modules')||!option('--browser')) throw new Error('Supply --node-modules and --browser.');
const {chromium}=createRequire(path.join(path.resolve(option('--node-modules')),'package.json'))('playwright');
const build=path.resolve('build');
const server=http.createServer((request,response)=>{
  try{
    const pathname=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname);
    let file=path.resolve(build,'.'+pathname);
    if(file!==build&&!file.startsWith(build+path.sep)) {response.writeHead(403).end();return;}
    if(fs.existsSync(file)&&fs.statSync(file).isDirectory()) file=path.join(file,'index.html');
    if(!fs.existsSync(file)){response.writeHead(404).end();return;}
    const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.woff2':'font/woff2'};
    response.setHeader('Content-Type',types[path.extname(file)]??'application/octet-stream');
    response.end(fs.readFileSync(file));
  }catch{response.writeHead(400).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({headless:true,executablePath:path.resolve(option('--browser'))});
  const data=JSON.parse(fs.readFileSync('.docusaurus/globalData.json','utf8'));
  const docs=data['docusaurus-plugin-content-docs'].default.versions.flatMap(v=>v.docs).filter(d=>
    d.id.startsWith('development/spring-boot/')&&/(?:MyBatis与JPA的SQL|OutboxRelay领取|RedisKafkaRabbitMQ隔离|Keycloak登录资源|OTLP链路导出|连接池排队准入)/u.test(d.id));
  if(docs.length!==6) throw new Error('Expected 6 new routes, found '+docs.length);
  const output=path.resolve('.java-article-checks/deepening-browser');fs.mkdirSync(output,{recursive:true});
  for(const width of [1440,390]){
    const page=await browser.newPage({viewport:{width,height:1000}});
    const errors=[];page.on('pageerror',error=>errors.push(String(error)));
    for(const doc of docs){
      await page.goto('http://127.0.0.1:'+server.address().port+doc.path,{waitUntil:'networkidle',timeout:45000});
      await page.waitForSelector('main article h1');
      if(/OutboxRelay|Keycloak|OTLP/u.test(doc.id)) await page.waitForFunction(()=>document.querySelectorAll('main article svg[id^="mermaid"]').length===1);
      const article=await page.locator('main article').innerText();
      if(!article.includes('练习与答案')||/Syntax error in text|mermaid version/u.test(article)) throw new Error('Invalid article '+doc.path);
      const failures=await page.evaluate(()=>({
        images:[...document.querySelectorAll('main article img')].filter(i=>!i.complete||!i.naturalWidth).length,
        overflow:document.documentElement.scrollWidth>window.innerWidth+2
      }));
      if(failures.images||failures.overflow||errors.length) throw new Error(doc.path+' '+JSON.stringify({failures,errors}));
      if(/Keycloak|OutboxRelay|连接池排队/u.test(doc.id)) await page.screenshot({path:path.join(output,doc.id.split('/').at(-1)+'-'+width+'.png'),fullPage:true});
      console.log('PASS '+width+' '+doc.id);
    }
    await page.close();
  }
  console.log('PASS 12 article/viewport checks; owned browser and HTTP server will close.');
} finally {
  if(browser) await browser.close();
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
