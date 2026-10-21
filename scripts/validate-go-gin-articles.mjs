import fs from 'node:fs';
import path from 'node:path';
import {compile} from '@mdx-js/mdx';

function walk(root){return fs.readdirSync(root,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(root,e.name)):[path.join(root,e.name)]);}
const totals={go:0,gin:0,routes:0,answers:0,diagrams:0};const errors=[];
for(const type of ['go','gin']){
  for(const file of walk('docs/development/'+type)){
    if(file.endsWith('_category_.json')){const c=JSON.parse(fs.readFileSync(file,'utf8'));if(c.collapsed!==true)errors.push(file+': category must default collapsed');continue;}
    if(!file.endsWith('.md'))continue;
    const source=fs.readFileSync(file,'utf8');const body=source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,'');
    const title=source.match(/^title: (".*")\r?$/m);if(!title||!body.includes('# '+JSON.parse(title[1])))errors.push(file+': title and H1 mismatch');
    if(path.basename(file).startsWith('00-'))totals.routes++;else{
      totals[type]++;if(!/## \d+\. 练习与答案/.test(body))errors.push(file+': answers section missing');
      const questions=[...body.matchAll(/^### \d+\.\d+ (.+)\r?\n\r?\n([^#][\s\S]*?)(?=\r?\n###? |$)/gm)];
      if(questions.length!==3||questions.some(q=>!q[2].trim()))errors.push(file+': expected three answered exercises');
      totals.answers+=questions.length;
    }
    totals.diagrams+=(body.match(/```mermaid/g)||[]).length;
    try{await compile(body,{format:'mdx'});}catch(error){errors.push(file+': '+error.message);}
    if(/面试|岗位职责|kubectl-command-is-not-needed/.test(body))errors.push(file+': editorial wording or placeholder');
  }
}
if(totals.go!==48||totals.gin!==30||totals.routes!==2)errors.push('Unexpected catalog '+JSON.stringify(totals));
if(errors.length){console.error(errors.join('\n'));process.exit(1);}
console.log('PASS '+JSON.stringify(totals)+'; MDX syntax, titles, answered exercises and collapsed categories.');
