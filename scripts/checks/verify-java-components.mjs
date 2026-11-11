import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import http from 'node:http';

const option=name=>{const index=process.argv.indexOf(name);return index<0?undefined:process.argv[index+1];};
const javaHome=option('--java-home'),mavenHome=option('--maven-home');
if(!javaHome||!mavenHome)throw new Error('Supply --java-home (JDK 25) and --maven-home (Maven 3.9.14).');
const root=process.cwd(),checks=path.resolve('.java-article-checks');fs.mkdirSync(checks,{recursive:true});
const work=fs.mkdtempSync(path.join(checks,'components-'));
const project=path.join(work,'foundation-lab');
fs.cpSync('examples/java-components/foundation-lab',project,{recursive:true,filter:file=>!['target','out'].includes(path.basename(file))});
const repository=path.resolve(option('--maven-repo')??path.join(checks,'component-m2'));
const executable=name=>path.join(javaHome,'bin',name+(process.platform==='win32'?'.exe':''));
const environment={...process.env,JAVA_HOME:javaHome};
function run(command,args,{timeout=60000,allowFailure=false}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd:project,env:environment,stdio:['ignore','pipe','pipe']});let output='',expired=false;
    child.stdout.on('data',b=>{output+=b.toString();});child.stderr.on('data',b=>{output+=b.toString();});
    const timer=setTimeout(()=>{expired=true;child.kill();},timeout);
    child.once('error',e=>{clearTimeout(timer);reject(e);});
    child.once('close',code=>{clearTimeout(timer);if(expired||(!allowFailure&&code!==0))reject(new Error('Command failed '+code+'\n'+output));else resolve({code,output});});
  });
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function withServer(arguments_,task){
  const child=spawn(executable('java'),['-XX:ActiveProcessorCount=2','-Xmx256m',...arguments_,
    '--server.port=0','--spring.main.banner-mode=off'],{cwd:project,env:environment,stdio:['ignore','pipe','pipe']});
  let output='',port,error,closed=false;
  child.on('error',e=>{error=e;});child.on('close',()=>{closed=true;});
  const append=chunk=>{output+=chunk.toString();const ports=[...output.matchAll(/Tomcat started on port (\d+) \(http\)/g)];if(ports.length)port=Number(ports.at(-1)[1]);};
  child.stdout.on('data',append);child.stderr.on('data',append);
  const request=route=>new Promise((resolve,reject)=>{
    const outgoing=http.get({hostname:'127.0.0.1',port,path:route,timeout:4000},response=>{
      let body='';response.setEncoding('utf8');response.on('data',chunk=>{body+=chunk;});
      response.on('end',()=>resolve({status:response.statusCode,body}));response.on('error',reject);
    });outgoing.on('timeout',()=>outgoing.destroy(new Error('HTTP request budget expired')));outgoing.on('error',reject);
  });
  try{
    const deadline=Date.now()+45000;
    while(!port){if(error||closed||Date.now()>deadline)throw new Error('Server did not start\n'+output);await pause(100);}
    return await task({request,child,output:()=>output});
  }finally{
    if(!closed){child.kill();const deadline=Date.now()+5000;while(!closed&&Date.now()<deadline)await pause(50);if(!closed){child.kill('SIGKILL');await new Promise(resolve=>child.once('close',resolve));}}
  }
}
const version=await run(executable('javac'),['-version']);assert.match(version.output,/javac 25[.\s]/);
const boot=path.join(mavenHome,'boot'),launcher=fs.readdirSync(boot).find(f=>/^plexus-classworlds-.*\.jar$/.test(f));
const built=await run(executable('java'),['-XX:ActiveProcessorCount=2','-Xmx768m',`-Dmaven.home=${mavenHome}`,
  `-Dmaven.multiModuleProjectDirectory=${project}`,`-Dclassworlds.conf=${path.join(mavenHome,'bin/m2.conf')}`,
  '-Dstyle.color=never','-cp',path.join(boot,launcher),'org.codehaus.plexus.classworlds.launcher.Launcher',
  '-B','-ntp',`-Dmaven.repo.local=${repository}`,'-Pdev','clean','verify','dependency:copy-dependencies','-DincludeScope=runtime'],{timeout:300000});
assert.match(built.output,/Tests run: 12, Failures: 0, Errors: 0, Skipped: 0/);
console.log('PASS 12 tests: generated members, DTO mappings, configuration and real HTTP/OpenAPI');
const target=path.join(project,'target'),classes=path.join(target,'classes'),jars=path.join(target,'dependency','*');
const jar=path.join(target,'component-foundation-lab-1.0.0.jar');
const contents=(await run(executable('jar'),['tf',jar])).output;
assert.match(contents,/BOOT-INF\/classes\/lab\/components\/TaskMapperImpl.class/);
assert(!/BOOT-INF\/lib\/(lombok-|mapstruct-|spring-boot-devtools-|spring-boot-configuration-processor-)/.test(contents));
console.log('PASS packaged JAR contains generated implementation, not compiler/developer tools');
const members=(await run(executable('javap'),['-classpath',classes,'lab.components.WorkItem'])).output;
assert.match(members,/getName\(\)/);assert.match(members,/builder\(\)/);
const mapper=fs.readFileSync(path.join(target,'generated-sources/annotations/lab/components/TaskMapperImpl.java'),'utf8');
assert.match(mapper,/source.getName\(\)/);assert.match(mapper,/if \( patch.title\(\) != null \)/);
const metadata=JSON.parse(fs.readFileSync(path.join(classes,'META-INF/spring-configuration-metadata.json'),'utf8'));
assert(metadata.properties.some(p=>p.name==='lab.timeout'&&p.type==='java.time.Duration'));
console.log('PASS bytecode, generated Java and property metadata');
const lombok=path.join(repository,'org/projectlombok/lombok/1.18.48/lombok-1.18.48.jar');
const mapstruct=path.join(repository,'org/mapstruct/mapstruct/1.6.3/mapstruct-1.6.3.jar');
const processor=path.join(repository,'org/mapstruct/mapstruct-processor/1.6.3/mapstruct-processor-1.6.3.jar');
const negatives=path.join(work,'negative-output');fs.mkdirSync(negatives);
const noLombok=await run(executable('javac'),['-J-Duser.language=en','-proc:none','-classpath',lombok,'-d',negatives,
  'src/main/java/lab/components/WorkItem.java','negative/UsesGeneratedGetter.java'],{allowFailure:true});
assert.notEqual(noLombok.code,0);assert.match(noLombok.output,/getName/);
const badMapping=await run(executable('javac'),['-J-Duser.language=en','-classpath',[classes,mapstruct,jars].join(path.delimiter),
  '-processorpath',processor,'-d',negatives,'-s',negatives,'negative/BrokenMapper.java'],{allowFailure:true});
assert.notEqual(badMapping.code,0);assert.match(badMapping.output,/Unknown property "absent"/);
console.log('PASS negative compilations: disabled Lombok and unknown MapStruct target rejected');
await withServer(['-jar',jar,'--lab.greeting=packaged'],async server=>{
  assert.equal(JSON.parse((await server.request('/api/tasks/t1')).body).title,'packaged');
  assert.equal((await server.request('/v3/api-docs')).status,404);
  assert.equal((await server.request('/swagger-ui/index.html')).status,404);
  assert.equal((await server.request('/internal/dev-info')).status,404);
});
console.log('PASS actual java -jar: API works; documentation and development endpoint absent');
const noMetadata=path.join(work,'classes-without-metadata');
fs.cpSync(classes,noMetadata,{recursive:true,filter:file=>path.basename(file)!=='spring-configuration-metadata.json'});
assert(!fs.existsSync(path.join(noMetadata,'META-INF/spring-configuration-metadata.json')));
await withServer(['-Dspring.devtools.restart.enabled=false','-cp',[noMetadata,jars].join(path.delimiter),
  'lab.components.ComponentsApplication','--lab.greeting=without-metadata'],async server=>{
  assert.equal(JSON.parse((await server.request('/api/tasks/t1')).body).title,'without-metadata');
});
console.log('PASS runtime property binding still works without metadata JSON');
const invalid=await run(executable('java'),['-XX:ActiveProcessorCount=2','-Xmx256m','-jar',jar,
  '--spring.main.web-application-type=none','--lab.greeting='],{allowFailure:true});
assert.notEqual(invalid.code,0);assert.match(invalid.output,/Binding to target lab\.components\.LabProperties failed/);
assert.match(invalid.output,/Property: lab\.greeting/);
console.log('PASS invalid runtime configuration prevents startup');
await withServer(['-cp',[classes,jars].join(path.delimiter),'lab.components.ComponentsApplication',
  '--spring.profiles.active=dev,docs'],async server=>{
  const before=JSON.parse((await server.request('/internal/dev-info')).body);
  assert.match(before.appLoader,/RestartClassLoader/);assert(!/RestartClassLoader/.test(before.libraryLoader));
  fs.appendFileSync(path.join(classes,'application.properties'),'\n# bounded restart verification\n');
  fs.appendFileSync(path.join(classes,'.reloadtrigger'),'\nverification-trigger\n');
  let after;const deadline=Date.now()+30000;
  while(Date.now()<deadline){
    try{const response=await server.request('/internal/dev-info');if(response.status===200){const value=JSON.parse(response.body);if(value.instance!==before.instance){after=value;break;}}}catch{}
    await pause(200);
  }
  assert(after,'DevTools did not replace context within budget\n'+server.output());
  assert.equal(after.pid,before.pid);
});
console.log('PASS DevTools: same JVM PID, new bean instance and restart classloader');
console.log('PASS all Java component checks; every owned server process has exited. Artifacts: '+path.relative(root,work));
