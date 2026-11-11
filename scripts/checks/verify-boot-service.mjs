import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import http from 'node:http';

const root = process.cwd();
const option = name => { const i=process.argv.indexOf(name); return i<0 ? undefined : process.argv[i+1]; };
if (!option('--java-home') || !option('--maven-home')) throw new Error('Supply --java-home (JDK 25) and --maven-home.');
const javaHome=path.resolve(option('--java-home')), mavenHome=path.resolve(option('--maven-home'));
const work=fs.mkdtempSync(path.join(root,'.java-article-checks/boot-service-check-'));
const project=path.join(work,'service-lab');
fs.cpSync(path.join(root,'examples/spring-boot/service-lab'),project,{recursive:true,filter:p=>!['target','out'].includes(path.basename(p))});
const java=path.join(javaHome,'bin',process.platform==='win32'?'java.exe':'java');
const boot=path.join(mavenHome,'boot');
const launcher=fs.readdirSync(boot).find(n=>/^plexus-classworlds-.*\.jar$/u.test(n));
const args=[`-Dmaven.home=${mavenHome}`,`-Dmaven.multiModuleProjectDirectory=${project}`,
  `-Dclassworlds.conf=${path.join(mavenHome,'bin/m2.conf')}`,'-Dstyle.color=never','-classpath',path.join(boot,launcher),
  'org.codehaus.plexus.classworlds.launcher.Launcher','-B','-ntp',
  `-Dmaven.repo.local=${option('--maven-repo')??path.join(root,'.java-article-checks/service-m2')}`,
  '-f',path.join(project,'pom.xml'),'clean','verify'];
console.log('RUN Boot 4.1.1 service integration tests; work='+work);
await new Promise((resolve,reject)=>{
  const child=spawn(java,args,{cwd:project,env:{...process.env,JAVA_HOME:javaHome},stdio:['ignore','pipe','pipe']});
  const timeout=setTimeout(()=>child.kill(),360000);
  child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
  child.once('error',error=>{clearTimeout(timeout);reject(error);});
  child.once('close',code=>{clearTimeout(timeout);code===0?resolve():reject(new Error('Maven exit '+code));});
});
let tests=0;
for(const name of fs.readdirSync(path.join(project,'target/surefire-reports')).filter(n=>/^TEST-.*\.xml$/u.test(n))){
  const xml=fs.readFileSync(path.join(project,'target/surefire-reports',name),'utf8');
  if(/<(failure|error|skipped)\b/u.test(xml)) throw new Error('Failed or skipped: '+name);
  tests += [...xml.matchAll(/<testcase\b/gu)].length;
}
if(tests!==31) throw new Error(`Expected 31 tests, got ${tests}`);
if(!fs.existsSync(path.join(project,'target/boot-service-lab-1.0.0.jar'))) throw new Error('Executable JAR missing');
const jar=path.join(project,'target/boot-service-lab-1.0.0.jar');
const server=spawn(java,['-jar',jar,'--server.port=0'],{cwd:project,stdio:['ignore','pipe','pipe']});
try {
  const port=await new Promise((resolve,reject)=>{
    let log='';
    const timer=setTimeout(()=>reject(new Error('JAR startup timeout')),30000);
    const output=chunk=>{
      log+=chunk.toString();
      const match=log.match(/Tomcat started on port (\d+)/u);
      if(match){clearTimeout(timer);resolve(Number(match[1]));}
    };
    server.stdout.on('data',output);server.stderr.on('data',output);
    server.once('error',error=>{clearTimeout(timer);reject(error);});
    server.once('exit',code=>{clearTimeout(timer);reject(new Error('JAR exited before ready: '+code+'\n'+log));});
  });
  await new Promise((resolve,reject)=>{
    const request=http.get({host:'127.0.0.1',port,path:'/actuator/health'},response=>{
      let body='';response.on('data',data=>body+=data);response.on('end',()=>{
        if(response.statusCode!==200||JSON.parse(body).status!=='UP') reject(new Error('JAR health failed: '+body));
        else resolve();
      });
    });
    request.setTimeout(3000,()=>request.destroy(new Error('HTTP timeout')));request.once('error',reject);
  });
  console.log('PASS executable JAR real loopback HTTP.');
} finally {
  if(server.exitCode===null){
    const exited=new Promise(resolve=>server.once('exit',resolve));
    server.kill();
    await exited;
  }
}
console.log(`PASS ${tests} tests: actual HTTP health, MVC validation, security, JDBC, concurrency and transactional outbox.`);
fs.rmSync(work,{recursive:true,force:true});
