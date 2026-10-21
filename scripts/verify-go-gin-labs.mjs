import fs from 'node:fs';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const go=arg('--go')??'go';
const checks=path.join(root,'.go-article-checks');fs.mkdirSync(checks,{recursive:true});
const env={...process.env,GOTOOLCHAIN:'local',GOMAXPROCS:'2',GOFLAGS:'-p=2',GOCACHE:path.join(checks,'cache'),GOPATH:path.join(checks,'gopath')};
const report={modules:[],experiments:0,profiles:[],http:[],external:'not run: requires explicit isolated services',race:'not run: requires supported C toolchain'};
function command(cwd,exe,args,options={}) {
  const result=spawnSync(exe,args,{cwd,env,encoding:'utf8',timeout:120000,maxBuffer:32*1024*1024,...options});
  if(result.error||result.status!==0)throw new Error([exe,...args].join(' ')+'\n'+result.stdout+'\n'+result.stderr+'\n'+String(result.error??''));
  return result.stdout.trim();
}
function tests(cwd) {
  const output=command(cwd,go,['test','-json','./...','-count=1','-timeout=60s']);
  const events=output.split(/\r?\n/).filter(Boolean).map(s=>JSON.parse(s));
  const passed=events.filter(e=>e.Action==='pass'&&e.Test);
  const skipped=events.filter(e=>e.Action==='skip'&&e.Test);if(skipped.length)throw new Error('Unexpected skipped tests');
  const record={module:path.relative(root,cwd).replaceAll('\\','/'),topLevel:passed.filter(e=>!e.Test.includes('/')).length,subtests:passed.filter(e=>e.Test.includes('/')).length,skipped:0};
  fs.writeFileSync(path.join(checks,path.basename(cwd)+'-tests.jsonl'),output+'\n');report.modules.push(record);
  command(cwd,go,['vet','./...']);command(cwd,go,['mod','verify']);
}
const core=path.join(root,'examples/go/core-lab'),gin=path.join(root,'examples/gin/service-lab');
tests(core);tests(gin);
command(gin,go,['test','-tags=integration','./integration','-run','^$']);
const suffix=process.platform==='win32'?'.exe':'';
const lab=path.join(core,'out/lab'+suffix),web=path.join(gin,'out/webdemo'+suffix),taskd=path.join(gin,'out/taskd'+suffix);
for(const [cwd,name,destination] of [[core,'lab',lab],[gin,'webdemo',web],[gin,'taskd',taskd]]) command(cwd,go,['build','-trimpath','-o',destination,'./cmd/'+name]);
for(const name of command(core,lab,[]).split(/\r?\n/)) {const output=command(core,lab,['-case',name]);if(!output)throw new Error('Empty experiment '+name);report.experiments++;}
for(const name of ['routing','middleware','abort','binding','json','context','copy','upload','sse','cookie','proxy','recovery']) {command(gin,web,['-case',name]);report.experiments++;}
for(const mode of ['cpu','heap','mutex','block','goroutine','trace']) {
  command(core,go,['run','./cmd/profile','-mode',mode,'-dir','out','-duration','100ms']);
  const filename=mode==='trace'?'runtime.trace':mode+'.pprof';
  if(mode==='trace') {
    const result=spawnSync(go,['tool','trace','-pprof=sched','out/'+filename],{cwd:core,env,timeout:30000});
    if(result.status!==0||result.stdout.length===0)throw new Error('trace conversion failed '+result.stderr);
    fs.writeFileSync(path.join(core,'out/sched.pprof'),result.stdout);
  } else command(core,go,['tool','pprof','-top','-nodecount=5','out/'+filename]);
  report.profiles.push(mode);
}
command(core,go,['test','./internal/demos','-run','^$','-fuzz','FuzzSum','-fuzztime=2s','-parallel=2']);
report.benchmark=command(core,go,['test','./internal/demos','-run','^$','-bench','BenchmarkSum','-benchmem','-count=2','-benchtime=100ms']);
report.encodingBenchmark=command(core,go,['test','./internal/demos','-run','^$','-bench','BenchmarkEncode','-benchmem','-count=3','-benchtime=100ms']);
const runtimeResult=[];
for(const [mode,extra] of [['gc',['-gogc','20']],['gc',['-gogc','100']],['view',[]],['clone',[]],['scheduler',[]]]) {
  runtimeResult.push(JSON.parse(command(core,go,['run','./cmd/runtime-lab','-mode',mode,'-dir','out/deep-'+mode,...extra])));
}
const view=runtimeResult.find(x=>x.mode==='view'),clone=runtimeResult.find(x=>x.mode==='clone');
if(view.visible_bytes!==64||clone.visible_bytes!==64||view.heap_added_bytes-clone.heap_added_bytes<6*1024*1024)throw new Error('Retention regression');
if(!runtimeResult.at(-1).channel_and_network_joined)throw new Error('Scheduler waiters not joined');
report.runtimeDeepening=runtimeResult;
const mechanisms=[];
for(const mode of ['channel','locks','http-client','http-server']){
  const result=JSON.parse(command(core,go,['run','./cmd/mechanism-lab','-mode',mode]));
  mechanisms.push({mode,...result});report.experiments++;
  if(mode==='channel'&&(!result.sender_joined||result.aliased_value!==2||result.cloned_value!==2||result.drained_ok))throw new Error('Channel protocol regression');
  if(mode==='locks'&&(result.mixed_atomic_total!==99||!result.mutex_invariant||!result.snapshot_consistent||!result.input_isolated))throw new Error('Lock invariant regression');
  if(mode==='http-client'&&(!result.pool_deadline||!result.queued_get_conn||result.queued_got_conn||result.requests_while_held!==2||result.after_unread_close_reused||!result.after_drain_reused))throw new Error('HTTP pool evidence regression');
  if(mode==='http-server'&&(!result.graceful_completed||!result.deadline_returned||result.deadline_canceled_handler||!result.close_canceled_handler))throw new Error('HTTP shutdown evidence regression');
}
report.mechanisms=mechanisms;
report.allocationBenchmark=command(core,go,['test','./internal/mechanism','-run','^$','-bench','Benchmark(Inline|Opaque|Published|Borrowed)','-benchmem','-count=3','-benchtime=100ms']);
const compiler=spawnSync(go,['test','./internal/mechanism','-run','^$','-gcflags=newswitch.dev/go-core-lab/internal/mechanism=-m=2 -d=ssa/check_bce/debug=1'],{cwd:core,env,encoding:'utf8',timeout:120000,maxBuffer:32*1024*1024});
if(compiler.error||compiler.status!==0)throw new Error('Compiler evidence failed '+compiler.stderr);
fs.writeFileSync(path.join(checks,'mechanism-compiler.txt'),compiler.stdout+'\n'+compiler.stderr);
if(!compiler.stderr.includes('inlining call to InlineRecord')||!compiler.stderr.includes('Found IsInBounds'))throw new Error('Compiler baseline changed; review rather than silently passing');
const mechanismBinary='out/mechanism.test'+suffix;
command(core,go,['test','-c','./internal/mechanism','-o',mechanismBinary]);
const unchecked=command(core,go,['tool','objdump','-s','mechanism.PrefixUnchecked',mechanismBinary]);
const bounded=command(core,go,['tool','objdump','-s','mechanism.PrefixBounded',mechanismBinary]);
fs.writeFileSync(path.join(checks,'mechanism-objdump.txt'),unchecked+'\n'+bounded+'\n');
if(!unchecked.includes('runtime.panicBounds')||bounded.includes('runtime.panicBounds'))throw new Error('Index bounds implementation changed; inspect object code');
report.compiler={escapeAndBCE:true,uncheckedHasPanicBounds:true,boundedHasPanicBounds:false};
const ssaDirectory=path.join(core,'out/ssa');fs.mkdirSync(ssaDirectory,{recursive:true});
command(core,go,['build','./internal/mechanism'],{env:{...env,GOSSAFUNC:'PrefixBounded',GOSSADIR:ssaDirectory}});
command(core,go,['build','-pgo=off','-o','out/profile-baseline'+suffix,'./cmd/profile']);
command(core,go,['build','-pgo=out/cpu.pprof','-o','out/profile-pgo'+suffix,'./cmd/profile']);
report.compiler.ssaExportAndPGOBuilds=true;

const database=path.join(checks,'cli-'+Date.now()+'.db').replaceAll('\\','/');
const token=command(gin,taskd,['-mode=token','-demo']);
let child,base,stderr='';
async function start() {
  child=spawn(taskd,['-demo','-listen=127.0.0.1:0','-admin=127.0.0.1:0','-dsn',database],{cwd:gin,env,stdio:['pipe','pipe','pipe'],windowsHide:true});
  let output='';const ready=new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('API startup timeout '+stderr)),10000);
    child.once('error',error=>{clearTimeout(timeout);reject(error);});
    child.once('exit',code=>{clearTimeout(timeout);reject(new Error('API exited early '+code+' '+stderr));});
    child.stderr.on('data',data=>{stderr+=data.toString();});
    child.stdout.on('data',data=>{output+=data.toString();for(const line of output.split(/\r?\n/)){try{const log=JSON.parse(line);if(log.msg==='server started'){base='http://'+log.api;clearTimeout(timeout);resolve();return;}}catch{}}});
  });await ready;
}
async function stop() {
  if(!child||child.exitCode!==null)return;
  const owned=child;await new Promise(resolve=>{const timeout=setTimeout(()=>{owned.kill('SIGKILL');},7000);owned.once('exit',()=>{clearTimeout(timeout);resolve();});owned.kill('SIGTERM');});
  child=undefined;
}
async function request(method,url,body,extra={}) {
  const response=await fetch(base+url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...extra},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(3000)});
  return {status:response.status,body:await response.text()};
}
try {
  await start();
  let r=await request('POST','/api/tasks',{name:'cli-one'},{'Idempotency-Key':'cli-one'});if(r.status!==201)throw new Error(r.body);const id=JSON.parse(r.body).id;
  r=await request('POST','/api/tasks',{name:'cli-one'},{'Idempotency-Key':'cli-one'});if(JSON.parse(r.body).id!==id)throw new Error('idempotency failed');
  r=await request('POST','/api/tasks',{name:'different'},{'Idempotency-Key':'cli-one'});if(r.status!==409)throw new Error('conflict failed');
  command(gin,taskd,['-mode=worker','-dsn',database]);
  r=await request('GET','/api/tasks/'+id);if(JSON.parse(r.body).state!=='SUCCEEDED')throw new Error('worker did not commit');
  r=await request('GET','/metrics');if(r.status!==404)throw new Error('public metrics leaked');
  report.http.push('real API create/idempotency/conflict','independent Worker process committed result','public metrics denied');
  await stop();await start();
  r=await request('GET','/api/tasks/'+id);if(JSON.parse(r.body).state!=='SUCCEEDED')throw new Error('persistence lost after restart');
  report.http.push('file DB result survives API restart');
} finally {await stop();}
report.shutdown=process.platform==='win32'?'Owned processes closed; Windows termination does not prove Unix SIGTERM graceful shutdown':'Owned API terminated through SIGTERM';
fs.writeFileSync(path.join(checks,'verification.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
