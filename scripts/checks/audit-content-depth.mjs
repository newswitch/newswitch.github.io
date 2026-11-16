// Content-audit triage, not a correctness/depth certification or CI pass gate.
// Every source is read; signals indicate where a human should inspect context.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import yaml from 'js-yaml';

const root=process.cwd();
const output=path.join(root,'contributing/audits/2026-11-16-content-depth');
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const processor=unified().use(remarkParse);
const walk=directory=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
  const file=path.join(directory,entry.name);
  return entry.isDirectory()?walk(file):/\.mdx?$/.test(entry.name)?[file]:[];
});
const text=node=>node.type==='code'?'':node.value??node.children?.map(text).join('')??'';
const paragraphMap=new Map();
const items=[];
const signalDefinitions={
  exercise_without_answer:'存在练习/验收题段，但段落之后未发现明确答案标记；可能跨文引用，需复核',
  compressed_multitopic_sections:'机制/架构正文多个主题只有单段概要，未见展开、示例或因果桥接；仅为需人工精读的结构信号',
  empty_section:'存在无正文的叶子标题；需核对图片/组件或外链是否承担内容',
  option_reference_missing_dimensions:'参数/选项参考未发现默认值、单位、边界三者中的完整信号；不是自动判定必须逐项具备',
  deployment_without_validation:'部署/安装正文未发现明确验收或健康检查信号',
  deployment_without_failure_boundary:'部署/安装正文未发现失败、回滚、恢复或风险边界信号',
  runbook_without_diagnostic_artifact:'排障/Runbook 正文未发现命令、配置、日志等代码块或配套示例入口',
  command_without_example_output:'命令参考未发现独立输出/配置块或输出解读标记，需核对混排代码与链接',
  production_floating_image:'生产相关内容出现 latest 镜像，需要核对是否仅示意或明确禁止',
  maintenance_scaffolding:'正文出现待写/面试/写作安排等词，需判断语境',
  recovery_without_acceptance:'恢复专项未发现对账/校验/恢复后验证等信号',
};
for(const absolute of [...walk(path.join(root,'docs')),...walk(path.join(root,'blog'))].sort()){
  const file=path.relative(root,absolute).replaceAll('\\','/');
  const source=fs.readFileSync(absolute,'utf8').replaceAll('\r\n','\n');
  const front=source.match(/^---\n([\s\S]*?)\n---\n/);
  let metadata={};
  try{if(front)metadata=yaml.load(front[1])??{};}catch{ /* metadata errors are recorded, not hidden */ }
  const prefix=front?source.slice(0,front[0].length).split('\n').length-1:0;
  const body=front?source.slice(front[0].length):source;
  const tree=processor.parse(body);
  const nodes=tree.children;
  const prose=nodes.filter(node=>node.type!=='code').map(text).join('\n');
  const title=String(metadata.title??nodes.find(node=>node.type==='heading')?.children.map(text).join('')??path.basename(file));
  const headings=nodes.filter(node=>node.type==='heading').map(node=>({title:text(node),level:node.depth,line:node.position.start.line+prefix}));
  const code=nodes.filter(node=>node.type==='code');
  const sections=[];
  for(let index=0;index<nodes.length;index++){
    const node=nodes[index];
    if(node.type!=='heading')continue;
    let end=index+1;
    while(end<nodes.length && !(nodes[end].type==='heading'&&nodes[end].depth<=node.depth))end++;
    const content=nodes.slice(index+1,end);
    sections.push({title:text(node),level:node.depth,line:node.position.start.line+prefix,
      prose:content.filter(child=>child.type!=='code').map(text).join('\n'),
      code:content.filter(child=>child.type==='code').length,
      paragraphs:content.filter(child=>child.type==='paragraph').length,
      list:content.some(child=>child.type==='list'),
      nested:content.some(child=>child.type==='heading'),
      empty:content.length===0});
  }
  const isBlog=file.startsWith('blog/');
  const guide=!isBlog && (/\/(?:00-[^/]+|intro)\.mdx?$/.test(file)||/学习路线|学习地图|文档导读|本章导读|索引$|导航$/.test(title));
  const personal=isBlog&&!/Redis|Linux|Kubernetes|vLLM|MySQL|部署|故障排查|源码|数据库|网络原理/i.test(title);
  const kind=personal?'personal':guide?'guide':/\/commands\//.test(file)||/命令参考|命令详解/.test(title)?'command-reference':/参数(全|详|体系|参考)|全参数|选项参考/.test(title)?'option-reference':/部署|安装/.test(title)?'deployment':/故障|排障|Runbook/i.test(title)?'troubleshooting':/备份|恢复|容灾/.test(title)?'recovery':'technical';
  const domain=isBlog?'blog':file.split('/')[1];
  const flags=[];
  const add=(id,evidence,line)=>flags.push({id,description:signalDefinitions[id],line:line??prefix+1,evidence:evidence.slice(0,380),status:'candidate-not-confirmed'});
  const exercises=sections.filter(section=>/练习|验收题|自测|思考题|复习题/.test(section.title));
  for(const section of exercises){
    const tail=source.split('\n').slice(section.line-1).join('\n');
    if(/\?|？/.test(section.prose)&&!/(?:参考)?答案|参考解答|解答[：:]|\*\*(?:问|答)[：:]|(?:^|\n)(?:答|解)[：:]|<summary[^>]*>[^<]*(?:答案|解答)/m.test(tail)){
      add('exercise_without_answer',section.prose,section.line);
      break;
    }
  }
  if(!guide&&!personal){
    if(kind==='technical'&&/原理|架构|机制|一致性|源码|持久化|事务|调度|策略/.test(title)){
      const compressed=sections.filter(section=>section.level===2&&!section.nested&&section.paragraphs===1&&!section.code&&!section.list
        &&!/参考|练习|验收|小结|总结|阅读/.test(section.title)
        &&!/[|]|!\[|<img|<svg/.test(section.prose)
        &&!/(因为|由于|因此|例如|假设|如果|之所以|先.+再|输入.+输出)/.test(section.prose));
      if(compressed.length>=3)add('compressed_multitopic_sections',compressed.map(section=>`${section.title}：${section.prose}`).join('；'),compressed[0].line);
    }
    for(const section of sections.filter(section=>section.empty&&section.level>1))add('empty_section',section.title,section.line);
    if(kind==='option-reference'){
      const dimensions={default:/默认|default/i.test(prose),units:/单位|字节|毫秒|秒|MiB|GiB|token|百分比/i.test(prose),boundary:/边界|范围|限制|不支持|互斥|版本|不适用/.test(prose)};
      if(Object.values(dimensions).filter(Boolean).length<3)add('option_reference_missing_dimensions',JSON.stringify(dimensions));
    }
    if(kind==='deployment'){
      if(!/验证|验收|检查|健康|确认|status|health|ready|curl|SELECT 1/i.test(body))add('deployment_without_validation',headings.map(item=>item.title).join('；'));
      if(!/失败|错误|回滚|恢复|风险|排查|注意|边界|备份/.test(prose))add('deployment_without_failure_boundary',headings.map(item=>item.title).join('；'));
    }
    if(kind==='troubleshooting'&&!code.length&&!/examples\/|示例源码|配置样例|日志片段/.test(body))add('runbook_without_diagnostic_artifact',headings.map(item=>item.title).join('；'));
    if(kind==='command-reference'&&code.length&&!code.some(block=>/^(?:text|console|output|json|yaml|xml|sql|csv|jsonl)$/i.test(block.lang??''))&&!/输出|返回|结果|显示|示意/.test(prose))add('command_without_example_output',headings.map(item=>item.title).join('；'));
    if(kind==='recovery'&&!/校验|验证|验收|对账|一致性检查|数据完整|抽样|checksum/i.test(prose))add('recovery_without_acceptance',headings.map(item=>item.title).join('；'));
    const scaffolding=prose.match(/.{0,50}(?:TODO|待补充|待完善|后续补充|面试|岗位职责|一眼找到|网站与本地).{0,100}/);
    if(scaffolding)add('maintenance_scaffolding',scaffolding[0]);
    if(/生产/.test(body)){
      const floating=code.flatMap(block=>block.value.split('\n').map((line,offset)=>({line:line.trim(),number:block.position.start.line+prefix+offset+1}))).find(item=>/(?:image\s*:\s*|docker\s+run.*)\S*:latest\b/.test(item.line));
      if(floating)add('production_floating_image',floating.line,floating.number);
    }
  }
  for(const node of nodes.filter(node=>node.type==='paragraph')){
    const value=text(node).replace(/\s+/g,' ').trim();
    // Repetition is reported, not scored. Ignore link-only/reference sentences.
    if(value.length>=60&&value.length<=600&&!/^参考|^https?:|^本篇|^本文|^本系列/.test(value)){
      const refs=paragraphMap.get(value)??[];
      refs.push({file,line:node.position.start.line+prefix});paragraphMap.set(value,refs);
    }
  }
  items.push({file,title,domain,kind,sha256:crypto.createHash('sha256').update(source).digest('hex'),
    scan:'full-source-read-rule-based-triage',humanReview:'not-yet-recorded',factCheck:'not-certified',
    headings,codeLanguages:[...new Set(code.map(block=>block.lang??'untyped'))],
    evidence:{mechanism:/原理|机制|流程|为什么|执行链|数据路径|因果/.test(prose),configuration:/参数|配置|选项|默认/.test(prose),examples:code.length>0||/examples\//.test(body),interpretation:/输出|返回|观察|表示|判断|对照|解释/.test(prose),boundaries:/边界|不支持|不适用|风险|限制|版本/.test(prose),diagnosis:/故障|排查|瓶颈|恢复|诊断/.test(prose),references:/https?:\/\//.test(body),answerCue:/答案|解答/.test(prose)},flags,
    exerciseSections:exercises.map(section=>({title:section.title,line:section.line}))});
}
// Reviewed source must still be the exact committed corpus, not an edited copy.
const reviewNotes=JSON.parse(fs.readFileSync(path.join(output,'review-notes.json'),'utf8'));
const baselineCurrent=reviewNotes.sourceCommit===commit && !execFileSync('git',['status','--porcelain','--','docs','blog'],{encoding:'utf8'}).trim();
const humanReviews=[];
const attach=(item,record)=>{
  // A repaired article may no longer contain the original finding's anchor.
  // Resolve historical evidence against its recorded commit, never against new prose.
  const reviewedSource=(baselineCurrent
    ?fs.readFileSync(path.join(root,item.file),'utf8')
    :execFileSync('git',['show',`${reviewNotes.sourceCommit}:${item.file}`],{encoding:'utf8',maxBuffer:4*1024*1024})).replaceAll('\r\n','\n');
  const lines=reviewedSource.split('\n');
  const findings=(record.findings??[]).map(finding=>{
    const line=lines.findIndex(value=>value.includes(finding.anchor));
    if(line<0)throw new Error(`Review anchor not found: ${item.file}: ${finding.anchor}`);
    return {...finding,line:line+1};
  });
  const review={...record,file:item.file,title:item.title,sourceSha256:crypto.createHash('sha256').update(reviewedSource).digest('hex'),currentSourceSha256:item.sha256,baselineCurrent,findings};
  delete review.match;
  item.humanReview=baselineCurrent?record.status:'stale-review-needs-recheck';
  item.reviewExtent=record.extent;
  for(const flag of item.flags){
    if(baselineCurrent&&record.dismissedSignals?.includes(flag.id))flag.status='human-dismissed';
    if(baselineCurrent&&record.confirmedSignals?.includes(flag.id))flag.status='human-confirmed';
  }
  humanReviews.push(review);
};
for(const record of reviewNotes.reviews){
  const matches=items.filter(item=>item.file.endsWith(record.match));
  if(matches.length!==1)throw new Error(`Review path must resolve uniquely: ${record.match} (${matches.length})`);
  attach(matches[0],record);
}
for(const item of items.filter(item=>item.file.startsWith('blog/')))attach(item,reviewNotes.personalBlogs);
const duplicates=[...paragraphMap].filter(([,refs])=>new Set(refs.map(ref=>ref.file)).size>=4).map(([paragraph,refs])=>({paragraph,refs})).sort((a,b)=>b.refs.length-a.refs.length);
const counts={};
for(const item of items){const entry=counts[item.domain]??{total:0,guides:0,personal:0,candidates:0,signals:{}};entry.total++;if(item.kind==='guide')entry.guides++;if(item.kind==='personal')entry.personal++;if(item.flags.length)entry.candidates++;for(const flag of item.flags)entry.signals[flag.id]=(entry.signals[flag.id]??0)+1;counts[item.domain]=entry;}
const human={baselineCurrent,records:humanReviews.length,fullTextDocs:humanReviews.filter(item=>item.file.startsWith('docs/')&&item.extent==='full-text').length,targetedDocs:humanReviews.filter(item=>item.file.startsWith('docs/')&&item.extent==='targeted-sections').length,personalBlogs:humanReviews.filter(item=>item.file.startsWith('blog/')).length,confirmedIssueArticles:humanReviews.filter(item=>item.findings.length||item.status==='mixed-findings').length,findings:humanReviews.reduce((sum,item)=>sum+item.findings.length,0),notManuallyReviewed:items.length-humanReviews.length};
const result={date:'2026-11-16',commit,scope:['docs/**/*.md','docs/**/*.mdx','blog/**/*.md','blog/**/*.mdx'],method:'No word/line threshold is used to certify or reject depth. Rule signals and keyword presence require contextual review; no unflagged page is called fully correct.',signalDefinitions,counts,totals:{sources:items.length,docs:items.filter(item=>item.file.startsWith('docs/')).length,blog:items.filter(item=>item.file.startsWith('blog/')).length,candidates:items.filter(item=>item.flags.length).length,signals:items.reduce((sum,item)=>sum+item.flags.length,0),guides:items.filter(item=>item.kind==='guide').length,personal:items.filter(item=>item.kind==='personal').length},human,duplicates,items};
fs.mkdirSync(output,{recursive:true});
// One record per line keeps the full inventory auditable without copying prose.
fs.writeFileSync(path.join(output,'inventory.json'),JSON.stringify(result).replace(',"items":[',',"items":[\n').replaceAll('},{"file":','},\n{"file":')+'\n');
fs.writeFileSync(path.join(output,'manual-review.json'),JSON.stringify({sourceCommit:reviewNotes.sourceCommit,human,reviews:humanReviews},null,2)+'\n');
const columns=['file','title','domain','kind','signals','signal_status','review_extent','human_review','fact_check'];
const csv=value=>'"'+String(value).replaceAll('"','""')+'"';
fs.writeFileSync(path.join(output,'all-articles.csv'),'\ufeff'+[columns,...items.map(item=>[item.file,item.title,item.domain,item.kind,item.flags.map(flag=>flag.id).join(';'),item.flags.map(flag=>flag.status).join(';'),item.reviewExtent??'rule-scan-only',item.humanReview,item.factCheck])].map(row=>row.map(csv).join(',')).join('\r\n')+'\r\n');
const fileLink=item=>`[${item.title.replaceAll('[','').replaceAll(']','')}](<../../../${item.file}>)`;
const candidateLines=['# 全量筛查候选索引','','规则命中不是内容不合格结论；未命中也不是通过。人工处置与范围见人工复核表。',''];
for(const domain of Object.keys(counts).sort()){
  const candidates=items.filter(item=>item.domain===domain&&item.flags.length);
  if(!candidates.length)continue;
  candidateLines.push(`## ${domain}（${candidates.length} 篇候选）`,'');
  for(const item of candidates){
    candidateLines.push(`- ${fileLink(item)}；人工状态：\`${item.humanReview}\`。`);
    for(const flag of item.flags)candidateLines.push(`  - 第 ${flag.line} 行：\`${flag.id}\`（${flag.status}）——${flag.description}。`);
  }
  candidateLines.push('');
}
fs.writeFileSync(path.join(output,'candidates.md'),candidateLines.join('\n').trimEnd()+'\n');
const manualLines=['# 人工复核记录','','全文阅读不等于已逐项核验源码、默认值或生产行为；targeted-sections 只覆盖注明的段落。所有记录绑定所列 Git 基线。','',`- 基线：\`${reviewNotes.sourceCommit}\`。`,`- 基线仍有效：${baselineCurrent?'是':'否，需重新复核'}。`,`- 复核范围：${human.fullTextDocs} 篇技术文档全文、${human.targetedDocs} 篇技术文档指定段落、${human.personalBlogs} 篇个人博客。`,''];
for(const item of humanReviews){
  manualLines.push(`## ${item.file}`,'',`${fileLink(item)}；\`${item.extent}\`；\`${item.status}\`。`,'');
  if(item.note)manualLines.push(item.note,'');
  for(const finding of item.findings){
    manualLines.push(`- ${finding.priority} / ${finding.category} / 第 ${finding.line} 行：${finding.issue}`,`  - 修复要求：${finding.action}`);
    if(finding.source)manualLines.push(`  - 核验依据：[官方资料](${finding.source})。`);
  }
  if(item.findings.length)manualLines.push('');
}
fs.writeFileSync(path.join(output,'manual-review.md'),manualLines.join('\n').trimEnd()+'\n');
console.log(JSON.stringify({totals:result.totals,human,domains:counts,duplicateParagraphGroups:duplicates.length},null,2));
