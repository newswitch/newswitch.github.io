import http from 'node:http';
import {performance} from 'node:perf_hooks';

// Fixed destination and hard limits: cannot be pointed at production or arbitrary hosts.
const read=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:Number(process.argv[i+1]);};
const port=read('--port',8083), concurrency=read('--concurrency',8), total=read('--requests',80), hold=read('--hold-ms',80);
if(!Number.isInteger(port)||port<1024||port>65535||!Number.isInteger(concurrency)||concurrency<1||concurrency>16||!Number.isInteger(total)||total<1||total>500||!Number.isInteger(hold)||hold<0||hold>200)
  throw new Error('port=1024..65535, concurrency=1..16, requests=1..500, hold-ms=0..200');
const agent=new http.Agent({keepAlive:true,maxSockets:concurrency});
const latencies=[], successful=[], failures={};
function one(){return new Promise(resolve=>{
  const started=performance.now();
  const req=http.get({host:'127.0.0.1',port,path:'/work?holdMs='+hold,agent},response=>{
    response.resume();response.on('end',()=>{
      const ms=performance.now()-started; latencies.push(ms);
      if(response.statusCode===200) successful.push(ms);else failures[response.statusCode]=(failures[response.statusCode]??0)+1;
      resolve();
    });
  });
  req.setTimeout(4000,()=>req.destroy(new Error('client timeout')));
  req.once('error',()=>{latencies.push(performance.now()-started);failures.network=(failures.network??0)+1;resolve();});
});}
let next=0;
const started=performance.now();
try { await Promise.all(Array.from({length:concurrency},async()=>{while(next++<total) await one();})); }
finally { agent.destroy(); }
const duration=(performance.now()-started)/1000;
const percentile=(data,p)=>{const sorted=[...data].sort((a,b)=>a-b);return sorted.length?Number(sorted[Math.ceil(p*sorted.length)-1].toFixed(2)):null;};
console.log(JSON.stringify({model:'closed-loop',concurrency,requests:total,holdMs:hold,seconds:Number(duration.toFixed(3)),
  completed:latencies.length,successes:successful.length,failures,completedPerSecond:Number((latencies.length/duration).toFixed(2)),
  successfulPerSecond:Number((successful.length/duration).toFixed(2)),allP95ms:percentile(latencies,.95),successP95ms:percentile(successful,.95)},null,2));
