import fs from 'node:fs';
import path from 'node:path';

// Repository-native SVGs: no remote fonts, embedded raster data or external links.
// Each label is a separate line; connector corridors do not cross card text.
const output=path.resolve('static/img/development');
fs.mkdirSync(output,{recursive:true});
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const palette={blue:['#eef5ff','#32659b'],green:['#edf8f2','#247555'],amber:['#fff7e7','#946215'],purple:['#f3effb','#6b5296'],red:['#fff0f1','#a44654']};
const text=(x,y,value,size=20,color='#21364a',weight=400,anchor='start')=>
  '<text x="'+x+'" y="'+y+'" font-size="'+size+'" fill="'+color+'" font-weight="'+weight+'" text-anchor="'+anchor+'">'+esc(value)+'</text>';
const box=(x,y,w,h,title,lines=[],kind='blue')=>{
  const [fill,stroke]=palette[kind];
  return '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="13" fill="'+fill+'" stroke="'+stroke+'" stroke-width="2"/>'+
    text(x+20,y+33,title,22,stroke,650)+lines.map((line,i)=>text(x+20,y+64+i*27,line,18)).join('');
};
const arrow=(points,color='#587185',dash=false)=>'<path d="'+points+'" fill="none" stroke="'+color+'" stroke-width="2.4" '+(dash?'stroke-dasharray="7 6" ':'')+'marker-end="url(#arrow)"/>';
function save(name,title,subtitle,body,notes,height=660){
  const footer=height-58;
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="'+height+'" viewBox="0 0 1120 '+height+'" role="img" aria-labelledby="title desc">'+
    '<title id="title">'+esc(title)+'</title><desc id="desc">'+esc(subtitle+'。'+notes.join('。'))+'</desc>'+
    '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10Z" fill="#587185"/></marker></defs>'+
    '<rect width="1120" height="'+height+'" rx="16" fill="#fff"/>'+
    '<g font-family="Microsoft YaHei, Noto Sans CJK SC, Arial, sans-serif">'+
    '<rect width="1120" height="102" rx="16" fill="#152e43"/><rect y="80" width="1120" height="22" fill="#152e43"/>'+
    text(30,43,title,28,'#fff',700)+text(30,77,subtitle,17,'#d6e4ee')+body+
    '<path d="M30 '+(footer-20)+' H1090" stroke="#dde5eb"/>'+
    notes.map((line,i)=>text(30,footer+i*25,line,17,'#455c70')).join('')+'</g></svg>\n';
  fs.writeFileSync(path.join(output,name+'.svg'),svg);
}
function steps(name,title,subtitle,nodes,notes){
  if(nodes.length!==6) throw new Error('Six-step layout required');
  let body='';
  const coordinates=[[30,145],[410,145],[790,145],[790,360],[410,360],[30,360]];
  nodes.forEach(([heading,...lines],i)=>body+=box(...coordinates[i],300,130,heading,lines,i<3?'blue':'green'));
  body+=arrow('M330 210 H398')+arrow('M710 210 H778')+arrow('M940 275 V348')+
    arrow('M790 425 H722')+arrow('M410 425 H342');
  save(name,title,subtitle,body,notes);
}

save('value-reference','参数按值传递：复制引用，不是复制对象','逻辑关系示意；不是 JVM 对象的实际地址布局',
  box(35,140,450,135,'调用者 main 的栈帧',['变量 a 持有引用值 R','调用 mutate(a)：复制 R'])+
  box(635,140,450,135,'被调用方法的栈帧',['形参 p 得到同一引用值 R','p = new ... 只改形参 p'],'green')+
  box(270,380,580,120,'共享对象',['a 与原来的 p 都可访问其字段','修改对象 ≠ 替换调用者变量'],'amber')+
  arrow('M260 275 V330 H400 V368')+arrow('M860 275 V330 H720 V368')+
  text(485,318,'两个引用可指向同一对象',18),
  ['基本类型同样复制值；对象可能共享，但 Java 不按引用传递参数。','方法返回后，局部引用消失不意味着对象立即被回收。']);

save('hashmap','HashMap：桶定位与桶内查找','OpenJDK 常见实现关系；不按真实对象大小绘制',
  box(30,140,300,140,'输入 key',['hashCode / 扰动','定位桶，再比较 key'])+
  box(410,140,300,140,'桶数组 table',['capacity 是桶数量','size 是键值对数量'],'purple')+
  box(790,140,300,140,'桶内结构',['节点链 / 合适时树化','哈希 + 身份 / equals'],'green')+
  arrow('M330 210 H398')+arrow('M710 210 H778')+
  box(30,365,490,130,'扩容',['达到相应阈值后扩大桶数组','重新分布节点，产生分配与迁移成本'],'amber')+
  box(600,365,490,130,'键的契约',['相等对象必须具有相同 hashCode','入表后别改变参与比较的状态'],'red'),
  ['树化受表容量、桶长度和插入路径影响，不是“碰撞 8 次必定树化”。','LinkedHashMap 额外维护顺序；HashSet 在相应实现中复用哈希映射。']);

save('jmm-publication','happens-before：发布数据的可见性链','语义顺序图；不是 CPU 缓存刷新或机器指令图',
  box(30,145,490,120,'生产者：普通写',['data = 42'])+
  box(600,145,490,120,'生产者：volatile 写',['ready = true'])+
  box(600,370,490,120,'消费者：volatile 读',['读到相应发布后的 ready = true'],'green')+
  box(30,370,490,120,'消费者：普通读',['读取 data，受传递关系约束'],'green')+
  arrow('M520 205 H588')+arrow('M845 265 V358')+arrow('M600 430 H532')+
  text(860,316,'同步关系',18)+text(230,315,'同线程顺序 + 同步关系可传递',19),
  ['只靠等待一段时间不建立 happens-before；必须有规定的同步关系。','volatile 不把 count++ 的读、改、写整体变成原子操作。']);

save('executor','线程池：接收、排队、扩展与拒绝','ThreadPoolExecutor 的简化提交主线，不代表所有执行器',
  box(30,145,300,125,'提交任务',['先按核心线程规则接收','不足时尝试建工作线程'])+
  box(410,145,300,125,'有界队列',['核心线程忙时尝试入队','队列也占内存'],'purple')+
  box(790,145,300,125,'尝试扩展到 max',['队列无法接收时','再尝试创建额外线程'],'green')+
  arrow('M330 207 H398')+arrow('M710 207 H778')+
  box(30,365,490,130,'执行与完成',['观察结果、异常和取消','finally 释放资源与上下文'],'green')+
  box(600,365,490,130,'无法接收 → 拒绝策略',['Abort / CallerRuns 等有不同语义','CallerRuns 会占用提交者线程'],'red')+
  arrow('M940 270 V353')+text(953,320,'无法扩展',17)+
  arrow('M560 270 V325 H275 V353')+text(350,315,'已接收的任务',17),
  ['图中不是“必定填满 max 后再排队”；队列类型会影响实际线程增长。','停机先停止接收，再有限等待；虚拟线程也不增加下游资源上限。']);

save('jvm-memory','JVM 进程内存：堆不是全部','逻辑区域与观测口径分开；面积不表示容量',
  box(30,140,330,140,'Java Heap（堆）',['对象、数组、部分栈块','GC 后存活量 / heap dump'])+
  box(395,140,330,140,'类与机器码',['Metaspace / Class Space','Code Cache / JIT'],'purple')+
  box(760,140,330,140,'平台线程栈',['调用帧与本地执行状态','线程数与 Xss 影响预算'],'green')+
  box(30,330,330,140,'Direct / Native',['直接缓冲、JNI、本地库','不都受 Xmx 约束'],'amber')+
  box(395,330,330,140,'其他进程区域',['共享库、映射、JVM 自身','不同工具覆盖范围不同'],'purple')+
  box(760,330,330,140,'OS / cgroup 口径',['RSS：驻留物理页','容器统计还可能含缓存'],'red'),
  ['reserved、committed、used、RSS 不可直接画等号或机械相减对账。','容器上限必须给堆、非堆、线程与运行余量共同留空间。']);

steps('class-loading','Class：加载、链接、初始化与使用','委派模型和初始化触发是两条不同问题，不能只看类文件存在',
  [['加载请求','先看已加载状态','按加载器策略寻找类型'],['父委派 / 定义','常见模型先委派父加载器','不是所有加载器都同一策略'],['验证','检查字节码等约束','不是执行业务代码'],['准备与解析','分配类变量等准备','解析可按实现延迟'],['初始化','按规则执行类初始化','不是每次引用都触发'],['使用类型','类名 + 定义加载器','共同参与类型身份']],
  ['链接包括验证、准备、解析；解析与其他阶段的具体时机需区分。','相同类名来自不同定义加载器时，不能假定可互相强转。']);

steps('bean-lifecycle','普通受管 Bean：创建、增强与销毁','简化主线；扩展处理器可介入更早阶段，Scope 影响管理边界',
  [['实例化','构造器 / 工厂方法','得到原始对象'],['填充依赖','解析并注入协作对象','对象尚未必可对外使用'],['初始化前处理','Aware / 后置处理器','PostConstruct 等各有位置'],['初始化回调','afterPropertiesSet','自定义 initMethod'],['初始化后与使用','后置处理可能返回代理','外部使用容器暴露对象'],['关闭与销毁','停止工作、销毁回调','prototype 需自行管理清理']],
  ['初始化通常针对目标对象，不能假定此时自调用已经过最终代理。','singleton 只定义共享范围，不保证字段和方法线程安全。']);

save('aop-boundary','AOP：外部调用与自调用的边界','普通 Spring 代理模型；不包含 AspectJ 编织',
  box(30,155,300,135,'调用方',['持有容器暴露的代理','调用公开业务入口'])+
  box(410,155,300,135,'代理与拦截链',['匹配 Advisor / Method','事务、权限、异步等增强'],'purple')+
  box(790,155,300,135,'目标对象 target',['执行真实方法 a','this.b() 是目标内调用'],'green')+
  arrow('M330 222 H398')+arrow('M710 222 H778')+
  box(410,380,680,115,'自调用不会重新穿过外部代理入口',['a → this.b：不能只凭 b 上有注解就认定增强执行'],'red')+
  arrow('M940 290 V368')+
  box(30,380,300,115,'两类代理',['JDK：接口','CGLIB：可覆盖方法'],'amber'),
  ['JDK 代理不能当目标实现类强转；类代理受 final / private 等边界影响。','增强顺序与匹配条件需观察实际链，而不是根据注解排列猜测。']);

save('transaction-binding','同步 JDBC 事务：代理、线程与连接','DataSourceTransactionManager 主线，不套用于响应式或分布式事务',
  box(30,145,300,145,'事务拦截器',['解析传播与回滚规则','开启 / 加入 / 挂起事务'])+
  box(410,145,300,145,'当前线程资源绑定',['按 DataSource 找连接资源','不等于全局共享连接'],'purple')+
  box(790,145,300,145,'JdbcTemplate / JDBC',['取得协作事务连接','执行 SQL 与映射'],'green')+
  arrow('M330 217 H398')+arrow('M710 217 H778')+
  box(30,390,490,115,'事务完成',['按状态提交 / 回滚并清理','解除绑定、恢复与归还连接'],'amber')+
  box(600,390,490,115,'新线程 / REQUIRES_NEW',['新线程不自动继承该事务','新事务可能需要额外连接'],'red')+
  arrow('M940 290 V335 H275 V378'),
  ['一个代理方法返回成功，仍需考虑提交阶段是否失败。','事务中等待远端 HTTP 会拉长连接持有；外部副作用不随本地自动回滚。']);

save('nio-selector','NIO：就绪通知、缓冲与实际处理','非阻塞 SocketChannel 的简化关系；就绪不等于整个请求完成',
  box(30,150,300,140,'Selector',['监听注册事件','选出可能可读 / 可写的键'])+
  box(410,150,300,140,'事件循环',['读取 / 写入 Channel','推进 ByteBuffer 状态'],'purple')+
  box(790,150,300,140,'协议与业务',['半包 / 粘包解析','耗时工作移出事件循环'],'green')+
  arrow('M330 220 H398')+arrow('M710 220 H778')+
  box(30,390,490,115,'Buffer：position / limit / capacity',['写入后 flip 切读，消费后 compact 或 clear','缓冲区也有资源和状态边界'],'amber')+
  box(600,390,490,115,'写就绪不表示必须永远监听 OP_WRITE',['只在有待写数据时关注相应事件','避免忙循环和无限积压'],'red'),
  ['read 可能只得到部分数据、返回 0 或结束；必须按返回值推进状态。','非阻塞 IO 不等于业务代码不会阻塞，也不保证自动背压。']);

save('reactor-demand','Reactor：订阅、需求、数据与取消','信号方向图；Scheduler 切换不会自动增加下游容量',
  box(30,170,300,150,'Publisher / 上游',['按协议发 onNext','最终完成或错误'])+
  box(410,170,300,150,'操作符链',['map / flatMap / buffer 等','可能有预取与内部队列'],'purple')+
  box(790,170,300,150,'Subscriber / 下游',['消费数据','控制需求与取消'],'green')+
  arrow('M330 205 H398')+arrow('M710 205 H778')+
  arrow('M790 285 H722')+arrow('M410 285 H342')+
  text(357,365,'上：数据信号 →    下：request(n) / cancel ←',20)+
  box(30,420,1060,95,'线程与资源另行管理',['阻塞工作选择合适执行位置；取消应传播并释放连接、缓冲和后台工作。'],'amber'),
  ['背压约束需求，不等于所有外部生产者都可无限暂停。','看到响应式返回类型，不代表内部没有阻塞、无限队列或资源泄漏。']);

steps('boot-autoconfiguration','Boot 自动配置：候选、条件与默认实现','先发现候选，再评估条件；不是“加依赖后全部 Bean 必定启用”',
  [['依赖进入 classpath','Starter 聚合依赖','BOM 管理版本而非注册 Bean'],['发现候选','AutoConfiguration.imports','列出自动配置类'],['排序与条件','类、属性、Web 类型等','不同条件在不同阶段判断'],['注册相应定义','用户 Bean 可使默认退让','不是所有条件都相同'],['创建与初始化','容器依赖解析和生命周期','实际得到对象或代理'],['观察结果','条件评估报告 + Bean 来源','用边界测试解释启用与退让']],
  ['自动配置一般用于提供默认行为；显式自定义需要验证是否正确替换。','候选发现、条件满足与 Bean 创建成功是三种不同事实。']);

steps('configuration-priority','常见外部配置：覆盖来源与绑定','只展示常见来源的相对优先级；省略测试、特殊 JSON 等来源',
  [['高：命令行参数','例如 --server.port=8081','安全信息不放进参数'],['Java 系统属性','例如 -Dserver.port=8081','注意位置在 -jar 之前'],['操作系统环境变量','例如 SERVER_PORT','名称映射要符合绑定规则'],['外部配置文件','含相应 Profile 文件','位置与导入影响覆盖'],['包内配置文件','application 与 Profile','不是最终值的唯一来源'],['低：默认属性','程序提供回退值','最终转换、绑定与校验']],
  ['图按优先级从高到低阅读，不表示文件加载的全部时序。','环境值覆盖之后还要转换与校验；“文件里写了”不代表最终生效。']);

save('request-resources','一次请求：线程、连接与依赖是不同资源','不同等待点拥有自己的上限、超时和取消；CPU 低也可能已饱和',
  box(30,145,300,130,'入口与请求处理',['连接、队列、Servlet / 虚拟线程','入口 deadline'])+
  box(410,145,300,130,'业务执行',['CPU、锁与有界任务池','状态、权限与事务'],'purple')+
  box(790,145,300,130,'返回客户端',['序列化、缓冲、网络写出','慢消费者与断连'],'green')+
  arrow('M330 210 H398')+arrow('M710 210 H778')+
  box(30,390,300,120,'数据库池',['租借 / SQL / 锁 / 提交','有独立等待'],'amber')+
  box(410,390,300,120,'HTTP / 消息客户端',['建连 / 流 / 确认 / 重试','需要独立资源预算'],'amber')+
  box(790,390,300,120,'缓存与内存',['队列、缓存、上下文','有容量与生命周期'],'amber')+
  arrow('M465 275 V330 H180 V378')+arrow('M560 275 V378')+arrow('M655 275 V330 H940 V378'),
  ['资源关系不表示所有请求同时使用全部依赖，也不表示所有耗时能直接相加。','先找等待与占用边界，再决定限流、缩事务、调池或扩容。']);

save('collection-layout','ArrayList 与 LinkedList：引用布局和访问路径','逻辑结构示意；不按真实对象地址、大小或缓存行绘制',
  box(30,145,300,125,'ArrayList',['索引 → 引用数组位置','随机访问直接定位'])+
  box(410,145,680,125,'一个数组保存多个元素引用',['槽位：ref0   ref1   ref2   ref3','元素对象本身不一定连续'],'green')+
  arrow('M330 207 H398')+
  box(30,365,300,125,'LinkedList',['首尾与节点链','按索引需要沿链查找'],'purple')+
  box(410,365,300,125,'节点 A',['prev / item / next','每节点有额外开销'],'amber')+
  box(790,365,300,125,'节点 B',['prev / item / next','定位后局部接链'],'amber')+
  arrow('M330 427 H398')+arrow('M710 407 H778')+arrow('M790 457 H722'),
  ['LinkedList 插入不是“按任意索引总是 O(1)”：必须先定位。','ArrayList 中间插入会移动引用；容量、扩容与遍历成本需一起比较。']);

save('gc-reachability','GC Roots 与对象保留链','只画普通强引用关系；弱、软、虚引用另有处理规则',
  box(30,145,240,120,'GC Root 示例',['活动线程中的引用','或相应静态引用'])+
  box(320,145,240,120,'服务对象',['持有 cache 字段'])+
  box(610,145,240,120,'缓存对象',['持有 entries'],'purple')+
  box(900,145,190,120,'数据对象',['仍强可达'],'green')+
  arrow('M270 205 H308')+arrow('M560 205 H598')+arrow('M850 205 H888')+
  box(320,380,300,120,'对象 A',['仅与 B 相互引用'],'amber')+
  box(790,380,300,120,'对象 B',['没有来自 Root 的路径'],'amber')+
  arrow('M620 415 H778')+arrow('M790 465 H632')+
  text(35,345,'下方环没有根路径：存在互相引用，也可能整体不可达。',20),
  ['不可达不表示当场回收；回收取决于算法、阶段和其他规则。','诊断泄漏要看从根到对象的保留路径，不只看谁的对象数量最多。']);

steps('g1-cycle','G1：Region、并发标记与回收集合','简化的一条工作主线，不是所有 GC 事件都必须按图连续出现',
  [['对象分配','通常先进入 Eden Region','大对象等有不同路径'],['Young evacuation','暂停并复制存活对象','更新引用、释放相应 Region'],['并发标记启动','借助相应暂停建立起点','与应用并发追踪可达性'],['Remark / Cleanup','处理标记收尾等工作','部分阶段仍需要暂停'],['选择回收集合','根据存活与收益等选择','Mixed 可含部分老年代'],['后续 evacuation','暂停复制并修正引用','仍可能发生退化或 Full GC']],
  ['并发不等于无暂停；GC 后堆占用下降也不保证 RSS 立即下降。','暂停目标不是硬实时承诺，负载、CPU、存活集和空间都会影响结果。']);

save('maven-boundaries','Maven：版本、可见性、任务与产物','四个维度分开，不把 BOM、Scope、插件与可执行 JAR 混为一谈',
  box(30,145,490,130,'依赖声明与版本管理',['dependencies：真正引入依赖','dependencyManagement / BOM：管理版本'])+
  box(600,145,490,130,'Scope 与依赖图',['compile / runtime / test 等影响可见范围','传递、冲突仲裁与排除需检查实际树'],'purple')+
  box(30,365,490,130,'生命周期与插件',['compile / test / package / verify','插件 goal 执行具体构建工作'],'green')+
  box(600,365,490,130,'最终产物',['普通库、分发包、Boot 可执行 JAR','构建成功后仍需检查布局与实际运行'],'amber')+
  arrow('M275 275 V353')+arrow('M845 275 V325 H560 V430 H588')+arrow('M520 430 H588'),
  ['导入 BOM 不会自动引入里面全部依赖，也不会自动执行所有插件。','IDE 能运行不等于打出的 JAR 可独立运行，需验证产物和运行 classpath。']);

steps('context-refresh','ApplicationContext refresh：定义与实例分开','容器刷新简化主线；失败清理和扩展点顺序同样重要',
  [['准备环境与工厂','建立本次刷新所需状态','读取与注册初始定义'],['定义工厂后处理','注册更多定义、修改元数据','BeanFactoryPostProcessor'],['注册实例后处理器','为后续 Bean 创建准备拦截','BeanPostProcessor'],['初始化容器设施','事件、多语言、Web 等','取决于上下文类型'],['实例化相应单例','依赖解析、初始化、代理','不是所有 lazy / scope 都创建'],['完成或失败','成功发布相应事件','失败销毁已建单例并清理']],
  ['定义后处理不是“对每个实例做初始化”；两类处理器作用对象不同。','构造成功、刷新成功与 Boot readiness 是不同状态。']);

save('exception-close','异常与资源关闭：主异常和 suppressed','try-with-resources 的简化规则，关闭次序为创建次序的反向',
  box(30,145,300,135,'创建资源 A、B',['从左到右初始化','后续创建失败也需清理前者'])+
  box(410,145,300,135,'执行 body',['可能正常返回','也可能抛出主异常'],'purple')+
  box(790,145,300,135,'关闭 B，再关闭 A',['退出块时执行 close','正常与异常退出均需考虑'],'green')+
  arrow('M330 212 H398')+arrow('M710 212 H778')+
  box(30,390,490,120,'body 已抛异常',['close 再失败通常成为 suppressed','保留原始主异常用于诊断'],'amber')+
  box(600,390,490,120,'body 正常，close 失败',['关闭异常可成为最终抛出异常','不要在 finally 中随意 return 覆盖结果'],'red')+
  arrow('M940 280 V330 H275 V378')+arrow('M1010 280 V378'),
  ['资源实现必须正确遵守关闭协议；不代表所有外部动作都能撤销。','捕获并吞掉异常会改变上层观察，日志应保留主因和 suppressed 链。']);

console.log('Generated 20 development SVGs.');
