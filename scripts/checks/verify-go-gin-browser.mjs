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
  const selected=docs;
  function sourceFiles(folder){return fs.readdirSync(folder,{withFileTypes:true}).flatMap(e=>e.isDirectory()?sourceFiles(path.join(folder,e.name)):e.name.endsWith('.md')?[path.join(folder,e.name)]:[]);}
  const sourceById=new Map(sourceFiles('docs/development').map(file=>[path.relative('docs',file).replaceAll('\\','/').replace(/\.md$/,'').split('/').map(part=>part.replace(/^\d+-/,'')).join('/'),fs.readFileSync(file,'utf8')]));
  const output=path.resolve('.go-article-checks/deepening-browser');fs.mkdirSync(output,{recursive:true});
  let checked=0;const figureMetrics=[];
  for(const width of [1440,390]){
    const page=await browser.newPage({viewport:{width,height:1000}});let errors=[];page.on('pageerror',error=>errors.push(String(error)));
    for(const doc of selected){
      errors=[];await page.goto(base+doc.path,{waitUntil:'networkidle',timeout:45000});await page.waitForSelector('main article h1');
      const source=sourceById.get(doc.id);if(!source)throw new Error('Missing source '+doc.id);
      const expectedDiagrams=(source.match(/```mermaid/g)||[]).length;
      if(expectedDiagrams)await page.waitForFunction(expected=>document.querySelectorAll('main article svg[id^="mermaid"]').length===expected,expectedDiagrams,{timeout:15000});
      const text=await page.locator('main article').innerText();
      if(/Syntax error in text|mermaid version/u.test(text)||(!/学习路线/u.test(doc.id)&&!text.includes('练习与答案')))throw new Error('Content failed '+doc.id);
      const bad=await page.evaluate(()=>({images:[...document.querySelectorAll('main article img')].filter(i=>!i.complete||!i.naturalWidth).length,overflow:document.documentElement.scrollWidth>window.innerWidth+2}));
      if(bad.images||bad.overflow||errors.length)throw new Error(doc.id+' '+JSON.stringify({bad,errors}));
      const sizes=await page.locator('main article svg[id^="mermaid"]').evaluateAll(figures=>figures.map((svg,index)=>{
        const box=svg.getBoundingClientRect(),scale=Math.abs(svg.getScreenCTM()?.a??1);
        const fonts=[...svg.querySelectorAll('.nodeLabel,.edgeLabel')].map(label=>parseFloat(getComputedStyle(label).fontSize)*scale).filter(Number.isFinite);
        return {index,width:Math.round(box.width),height:Math.round(box.height),minFontPx:fonts.length?Math.round(Math.min(...fonts)*10)/10:null};
      }));
      if(width===390&&sizes.some(figure=>figure.minFontPx!==null&&figure.minFontPx<12.5))throw new Error('Mobile figure text too small: '+doc.id+' '+JSON.stringify(sizes));
      if(sizes.length)figureMetrics.push({id:doc.id,viewport:width,figures:sizes});
      if(expectedDiagrams||/泛型约束|反射StructTag|Module-MVS|上传下载|SSE流式|容器Kubernetes|学习路线/u.test(doc.id)){
        await page.screenshot({path:path.join(output,doc.id.split('/').at(-1)+'-'+width+'.png'),fullPage:true});
        // Element screenshots may auto-scroll a tall SVG behind the sticky navbar.
        // Hide only that overlay while capturing the figure, not in the website.
        const overlay=await page.addStyleTag({content:'.navbar { visibility: hidden !important; }'});
        try{
          const figures=page.locator('main article svg[id^="mermaid"]');for(let i=0;i<await figures.count();i++)await figures.nth(i).screenshot({path:path.join(output,doc.id.split('/').at(-1)+'-diagram-'+i+'-'+width+'.png')});
        }finally{await overlay.evaluate(element=>element.remove());}
      }
      checked++;console.log('PASS '+width+' '+doc.id);
    }
    await page.close();
  }
  fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({builtPages:docs.length,viewportChecks:checked,widths:[1440,390],figureMetrics},null,2)+'\n');
  console.log('PASS all 82 built routes; '+checked+' desktop/mobile page checks.');
}finally{
  if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
