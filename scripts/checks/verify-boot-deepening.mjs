import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

const option=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const root=process.cwd(), lab=path.join(root,'examples/spring-boot/deepening-lab');
const counts={persistence:15,delivery:13,identity:16,telemetry:4};
for(const [module,expected] of Object.entries(counts)){
  const directory=path.join(lab,module,'target/surefire-reports');
  const files=fs.readdirSync(directory).filter(n=>/^TEST-.*\.xml$/u.test(n));
  let count=0;
  for(const file of files){
    const xml=fs.readFileSync(path.join(directory,file),'utf8');
    if(/<(?:failure|error|skipped)\b/u.test(xml)) throw new Error('Failed/skipped '+module+'/'+file);
    count += [...xml.matchAll(/<testcase\b/gu)].length;
  }
  if(count!==expected) throw new Error(`${module}: expected ${expected}, got ${count}`);
}
console.log('PASS 48 local tests. External BrokersIT is separately opt-in, not counted as passed.');
if(!process.argv.includes('--run-http')) process.exit(0);
if(!option('--java-home')) throw new Error('Supply JDK 25 --java-home');
const java=path.join(path.resolve(option('--java-home')),'bin',process.platform==='win32'?'java.exe':'java');
const jar=path.join(lab,'telemetry/target/telemetry-lab-1.0.0.jar');
if(!fs.existsSync(java)||!fs.existsSync(jar)) throw new Error('JDK executable or built telemetry JAR missing.');
const output=path.join(root,'.java-article-checks/deepening-load'); fs.mkdirSync(output,{recursive:true});
const summaries=[];
async function command(executable,args){
  return await new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{cwd:root,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    const timer=setTimeout(()=>child.kill(),30000);
    child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('close',code=>{clearTimeout(timer);code===0?resolve(stdout):reject(new Error('exit '+code+' '+stderr));});
  });
}
async function server(name,properties,run){
  const args=['-Xmx384m','-jar',jar,'--server.port=0','--management.tracing.export.otlp.enabled=false',
    '--logging.level.lab.telemetry=warn',...properties];
  const child=spawn(java,args,{cwd:lab,stdio:['ignore','pipe','pipe']});
  let log='';
  try{
    const port=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error(name+' startup timeout\n'+log.slice(-3000))),30000);
      const data=b=>{log+=b;const match=log.match(/Tomcat started on port (\d+)/u);if(match){clearTimeout(timer);resolve(Number(match[1]));}};
      child.stdout.on('data',data);child.stderr.on('data',data);
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',code=>{clearTimeout(timer);reject(new Error(name+' premature exit '+code));});
    });
    // Initialize Hikari, servlet and JIT paths before comparing any sample.
    await command(process.execPath,[path.join(lab,'telemetry/load.mjs'),'--port',String(port),'--concurrency','1','--requests','12','--hold-ms','10']);
    await run(port);
  } finally {
    if(child.exitCode===null){const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill();await stopped;}
    fs.writeFileSync(path.join(output,name+'.log'),log);
  }
}
async function sample(port,name,concurrency){
  const result=JSON.parse(await command(process.execPath,[path.join(lab,'telemetry/load.mjs'),'--port',String(port),
    '--concurrency',String(concurrency),'--requests','80','--hold-ms','80']));
  if(result.completed!==80 || result.failures.network) throw new Error('Incomplete loopback sample '+JSON.stringify(result));
  summaries.push({name,...result}); console.log(name+' '+JSON.stringify(result));
}
await server('pool2',[],async port=>{await sample(port,'pool2-serial',1);await sample(port,'pool2-queue',8);});
await server('pool4',['--spring.datasource.hikari.maximum-pool-size=4','--spring.datasource.hikari.minimum-idle=4'],async port=>sample(port,'pool4-queue',8));
await server('admission2',['--lab.admission=true'],async port=>sample(port,'pool2-admission',8));
fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify({jdk:'25',boot:'4.1.1',scope:'loopback H2 artificial connection hold, not production capacity',summaries},null,2)+'\n');
console.log('PASS bounded HTTP samples; all owned JVMs closed. '+output);
