# 历史专题验证记录

以下记录保留各批文章的验证范围、工具链和限制，不代表当前全站篇数或已经完成的硬件验收。当前命令见 [验证与发布](./validation.md)，内容归属见 [目录规则](./structure.md)。

## 2026-11-14：SeaTunnel、NiFi 与 Airbyte

在 `docs/data-systems/integration/` 下增加三个独立产品目录，各含一篇路线与六篇正文，共 21 页、84 个有答案的练习、6 张 Mermaid 图；分类使用物理目录自动生成，默认折叠。更新数据系统地图与 DataX 交叉入口，不移动原有文章。

基线为 SeaTunnel 3.0.0/Zeta、NiFi 2.12.0/Java 21/Traditional Engine；Airbyte 按当日官方文档和 abctl v0.30.4 核对，明确 Chart、平台、协议与连接器独立版本化。修正 V2 Chart 仓库地址，区分 Socket 与传统数据通路；SeaTunnel JSON-HOCON 示例展开路径键，NiFi 示例显式处理 original/failure 并先保留结果队列。

`npm run check:integration` 通过 21 页 MDX、84 个答案、配置/代码一致性和 8 项离线测试；`npm run check:datax` 回归通过 14 页与原有 30 项 Python 测试（Windows 权限位用例按设计跳过一项）。格式、相对链接和结构检查通过：当次全站 2566 个源文档、467 个物理分类、14 个领域。六张图另以本地 Mermaid 在正文宽度 738/326 px 预览，并人工检查文字、连线和裁边。

本机曾有两次 Rspack 构建在打包阶段停止推进，仅结束各自已核实的自有 PID。随后保持标准生产配置，以 `DOCUSAURUS_NO_PERSISTENT_CACHE=true`、`RAYON_NUM_THREADS=2`、SSR/SSG 并发均为 1、Node 堆上限 6144 MiB 重试，最终构建成功（476.63 秒）；不能仅凭该现象认定已经定位原始停滞根因。`check:site` 通过 2566 个正文、53 个分类索引与 467 个目录；搜索索引 16.4 MiB。仅有原有 Browserslist 数据过旧提示，未升级依赖。

使用自有无头 Edge 与环回静态服务器，验证全部 21 个路由在 1440/390 px 下共 42 次访问：H1、84 个唯一答案、全部非 Mermaid 代码块与源码一致；6 张图在两种尺寸下可读，无全局横向溢出。三个入口正文链接与侧栏归属、三种关键词的搜索结果/跳转，以及深色模式均通过。另人工查看图表与手机搜索截图。浏览器与服务器在验证结束时关闭，截图与中间结果只保留在忽略的 `.cache-loader/integration-review/`。

所有验证均未启动三个产品、数据库、Docker 或 Kubernetes；不声明完成真实 JDBC/TLS、CDC、XA、State 恢复与节点故障集成测试。配套 NiFi recipe 是人读配置，Airbyte JSONL 是合成协议材料，不得冒充可导入流程或生产 State。

## 产品级专题目录

`data-systems/integration/datax/` 保存 DataX 学习路线和 13 篇正文，覆盖 standalone 源码链路、部署/驱动、任务选项、抽取/写入、文件与外部存储边界、类型/Transformer、水位、容量、调度、安全、日志、校验与发布恢复。上游基线固定为 `80ec23d5c5328eb90ca364d2749e92dfaf44541e`。`examples/datax/sync-lab/` 保存四行订单、四份任务配置及 Python 标准库渲染/校验程序。`npm run check:datax` 验证结构、56 个答案、3 张图、配置与离线测试；不把本机 Python 验证称为已完成 DataX/JDBC/目标环境集成验收。


`gpu/servers/` 保存 AI 整机产品体系，按 `nvidia-dgx/` 与 `huawei-atlas/` 分类；Atlas A2 主文从推理框架模块迁入此处，vLLM-Ascend、昇腾学习路线和硬件分类通过相对链接引用。通用 PCIe/NUMA 主文仍归属 `gpu/pcie-numa/`，保留原有拓扑图与命令示例。`node scripts/checks/verify-ai-server-articles.mjs` 校验六篇主文的元数据、24 个练习答案、目录顺序、迁移引用和规格范围，不以行数作为文章质量标准。

计算软件与运行环境分为三处：`gpu/cuda/` 解释 CUDA 执行及软件栈；`gpu/ascend-npu/` 解释 CANN 组件与安装环境；`gpu/driver-runtime/` 解释驱动、兼容、容器设备注入及隔离。`ai-systems/runtime/01-PyTorch后端选择CUDA与torch-npu适配.md` 归属 AI 框架运行环境，引用双方软件栈而不复制正文。对应八篇主文合计 32 个练习答案；`examples/accelerator-runtime/backend_probe.py` 是显式选择 CPU/CUDA/NPU 的有限功能验证，不作为性能基准。`node scripts/checks/verify-accelerator-runtime-articles.mjs --python python` 校验元数据、答案、YAML、示例算术、Python 语法和七项控制流单元测试，`--bash` 可指定 Bash 进行命令语法检查。基础检查与模拟单元测试不能宣称已完成目标加速器硬件验收。

`storage/oceanstor/` 直接承载 OceanStor AI 存储入口、A800、A600 和协议/客户端四篇主文；通用 I/O 模型与 NVIDIA GDS 保留在 `storage/ai-workloads/`。六篇通过相对链接串联，合计 30 个练习答案，厂商参考规格与教学预算分别标注。`node scripts/checks/verify-ai-storage-articles.mjs` 校验元数据、答案、目录、容量/带宽/时延算术与 GDS 配置范围，`--bash` 可额外检查命令语法；验证不会挂载存储、运行 fio/gdsio 或修改驱动。

`data-systems/search/elasticsearch/05-api-reference/` 保存九篇常用 API 操作参考，使用六条基准文档，变更实验使用独立索引。原 Query DSL 文章保留原路径，与操作参考相互链接。`node scripts/checks/verify-elasticsearch-api-articles.mjs` 检查请求 JSON/NDJSON、36 个新练习答案和原文六个答案，并校验样例筛选/排序/统计；`--bash` 仅增加 curl 模板的语法检查，不连接 Elasticsearch，也不把本地算术验证当作分布式集成测试。

`gpu/cluster/pooling/` 保存资源池入口、设备模型与昇腾切分原理；NVIDIA 共享对比继续归 `sharing/`，拓扑放置继续归 `scheduling/`，GB200/GB300 NVL72 归整机目录。六篇通过相对链接关联，含 24 个练习答案、8 张 Mermaid 图。`node scripts/checks/verify-accelerator-pooling-articles.mjs` 校验结构、配置片段、教学容量与集合可行性；可选 `--bash` 仅做语法检查，不执行设备切分、驱动修改或集群命令。

软件开发按具体语言与框架建立独立入口。`development/java/` 保存 Java、标准库、并发、JVM、构建和排障；`development/spring/` 保存容器、AOP、事务、Web 和源码调用链；`development/spring-boot/` 保存启动配置、服务、数据接入、安全及生产运行。每个系列保留学习路线，专题文件夹随正文发布逐步建立，网站不维护另一套虚拟目录。

`development/python/` 保存 36 篇 Python 正文，按语言、对象模型、标准库 I/O、并发、运行时与工程六个目录组织；`development/fastapi/` 保存 24 篇正文，按 HTTP、依赖异步、数据安全、I/O 任务、生产运行和源码诊断六个目录组织。连同两篇路线共 62 页、180 个练习答案。已有 `automation/python/` 保留自动化应用内容，通过学习路线交叉引用，不复制或混放正文。

`examples/python/language-lab/` 保存首批 12 个文章源文件与 47 项标准库 unittest 测试。`scripts/checks/verify-python-language.mjs` 校对源码与 30 个练习答案，并可通过 `--python` 指定 CPython 3.14 验证九个脚本各三次独立进程输出、venv/pip 隔离、包入口、错误退出与静默导入。临时环境仅在忽略的 `.python-article-checks/` 下创建并定向清理，不修改系统解释器或全局依赖。

`examples/python/advanced-lab/` 与 `examples/fastapi/framework-lab/` 保存后续 50 个文章源文件。`scripts/checks/verify-python-framework-series.mjs` 校验所有 62 页 MDX、源码与答案，执行 48 个演示各三次输出、6 项 Python pytest 用例和 44 项 FastAPI 用例。FastAPI 验证包括 SQLite 迁移、持久化、租户与权限、幂等、条件取消、上传、WebSocket、退出栈，以及环回临时端口的真实 Uvicorn；只关闭自有进程。PostgreSQL/MySQL、systemd、容器与 Kubernetes 不属于该 Windows 本机集成验证。

`examples/python/package-lab/` 提供可安装项目，`scripts/checks/verify-python-package.mjs` 在临时副本构建 sdist/wheel，再离线安装到干净 venv 验证导入与 console entry。`scripts/checks/verify-python-browser.mjs` 验证 62 个页面、8 张 Mermaid 图与手机布局。构建缓存、测试数据库、虚拟环境和临时运行包不提交。

代码示例保存在 `examples/java/language-lab/` 与 `examples/java/standard-library-lab/`，不进入文档侧边栏。`scripts/checks/verify-java-examples.mjs` 验证工具链与 Maven 示例，`scripts/checks/verify-java-standard-library.mjs` 验证语言进阶和标准库示例；两者都检查文章与源码一致，并可使用 JDK 25 编译、运行和测试。`target/` 与 `out/` 构建产物不提交。

`examples/java/build-testing-lab/` 保存构建与测试示例，`examples/java/concurrency-lab/` 保存并发示例。`scripts/checks/verify-java-concurrency.mjs` 验证并发程序和协调边界，`scripts/checks/verify-java-builds.mjs` 在临时工作区验证 Maven/Gradle、测试失败门禁、多模块分发与可复现归档。

`examples/java/jvm-diagnostics-lab/` 保存 JVM 与诊断的 11 个完整程序。`scripts/checks/verify-java-runtime.mjs` 检查文章与源码一致，验证字节码、类初始化、内存、G1/ZGC、JIT、AppCDS/AOT、自定义 JFR，并只 Attach 自己启动的有界诊断进程，覆盖线程、NMT、JFR 与 jstat。实验文件在忽略的 `.java-article-checks/` 中生成并清理；Linux cgroups、native profiler 与 Arthas 不包含在该 Windows/JDK 自动实测范围。Java 网站专题与本地 `01-language`、`02-standard-library`、`03-concurrency`、`04-jvm`、`05-build-testing`、`06-diagnostics` 目录一一对应。

`examples/spring/container-lab/` 保存 Spring 容器专题的 7 个演示、Maven 工程、属性资源与 JUnit 边界测试。`scripts/checks/verify-spring-container.mjs` 检查 9 个文章代码/资源文件与源码一致，在独立临时工程验证测试报告、Spring 模块版本，以及每个示例 3 次独立进程的输出。纯 Spring 示例不引入 Boot、不启动网络服务或后台 Worker；`target/`、`out/` 与临时工作区不提交。网站的容器专题来自本地 `development/spring/01-container/`。

`examples/spring/transactions-lab/` 保存 AOP、JDBC 与事务专题实验。`scripts/checks/verify-spring-transactions.mjs` 检查 10 个文章源码文件、JUnit 报告、Spring/H2/AspectJ 固定依赖和 7 个主类各 3 次运行输出。H2 为独立进程内内存库，锁等待与线程有上限，示例关闭自己的连接与执行器，不连接已有数据库或启动服务端。对应网站与本地目录为 `development/spring/02-aop-transactions/`。

`examples/spring/web-lab/` 保存 Servlet、MVC、异步通信与 Reactor/WebFlux 专题。`scripts/checks/verify-spring-web.mjs` 对照 11 个文章源文件，验证 40 项 JUnit 边界测试与 7 个主类各 3 次运行结果。真实 HTTP、SSE、WebSocket 与模拟 Servlet 测试明确分开；真实服务器仅绑定 `127.0.0.1` 临时端口，使用有界线程、连接池与超时，并关闭自有资源。Web 专题由本地 `development/spring/03-web/` 自动生成，分类默认折叠。运行验证脚本需要 JDK 25、Maven 3.9.14；`--check-sources` 只检查文章和示例一致性，不启动服务。

`examples/spring/internals-lab/` 保存 Spring 7.0.9 源码专题的 7 个演示与测试。`scripts/checks/verify-spring-internals.mjs` 对照 8 个文章源文件，验证 42 项 JUnit 测试、运行依赖版本以及每个主类 3 次独立 JVM 输出。实验覆盖刷新失败、循环依赖、配置导入、自动代理、真实 H2 事务、MockMvc 与 TestContext 缓存，不启动网络服务；关闭自有上下文和数据库池，缓存仅定向失效本实验配置。对应目录为 `development/spring/04-internals/`，默认折叠；验证工具使用 JDK 25、Maven 3.9.14。

`examples/spring-boot/startup-lab/` 保存 Boot 4.1.1 启动与配置专题，包含普通自动配置库、依赖型 Starter 和可执行应用三个 Maven 模块。`scripts/checks/verify-boot-startup.mjs` 对照 18 个文章代码/资源文件，验证 36 项测试、六个主类各三次输出，以及可执行 JAR 的真实 HTTP 请求、普通库布局、候选资源和生成的属性元数据。服务器仅绑定环回临时端口，Runner 等待有期限，结束后关闭自有上下文；构建目录不提交。文档目录为 `development/spring-boot/01-startup-configuration/`，默认折叠，工具使用 JDK 25 与 Maven 3.9.14。

文章较多的产品目录保留 `00-学习路线` 作为唯一入口，正文按可以直接识别的技术专题继续分组。网站侧边栏由这些目录自动生成，不单独维护文章列表。

Spring Boot、Java 与 Spring 的专题范围和篇数由各自学习路线与实际目录维护，监控等后续文章继续归入已有专题。`examples/spring-boot/service-lab/` 使用 Boot 4.1.1 与 JDK 25，`scripts/checks/verify-boot-service.mjs` 在独立目录构建并验证 31 项测试：真实 HTTP 健康、带安全链的 MockMvc、H2 事务、并发幂等、版本竞争与 Outbox 回滚。外部中间件、目标数据库、IdP、Testcontainers、systemd、Kubernetes、Native 不在本机验证范围。

`static/img/development/` 保存 20 张无外部字体或远程依赖的 SVG 机制图，源布局由 `scripts/generators/generate-development-diagrams.mjs` 生成。编辑布局后重新生成，并栅格预览检查文字边界、连线和图注；文章通过固定静态路径引用，Mermaid 用于请求时序、状态与跨系统消息流程。不要为单个术语强制加图。

| 产品或专题 | 二级专题 |
| --- | --- |
| Nginx | 架构与源码、代理与内容服务、协议与服务发现、安全与生产运维 |
| TLS 与 PKI | TLS 协议、证书与文件、身份与自动化、分析与故障排查 |
| PostgreSQL | 基础与 SQL、存储与事务、性能、HA/DR、内核与运维 |
| Elasticsearch | 搜索与存储、集群与数据生命周期、向量与性能、安全与灾备 |
| Milvus | 向量与数据模型、Segment 与索引、部署与扩展、性能与运维 |
| Redis | 客户端与数据结构、执行与持久化、HA 与集群、应用模式与运维 |
| ClickHouse | 数据模型与存储、查询与写入、集群与复制、性能与运维 |
| RocketMQ、RabbitMQ | 架构与消息语义、部署与可靠性、容量与生产运维 |
| Airflow | 架构与调度、部署与 HA、治理与容量、升级与排障 |
| Prometheus | 指标与查询、告警与可视化、部署与长期存储、生产治理 |
| OpenTelemetry | 统一证据链、日志、链路追踪、部署与生产治理 |
| Ansible、Python 自动化 | 基础工程、复用或远程调用、规模化与质量、交付与综合项目 |
| Istio | 架构与数据面、流量治理、安全与观测、多集群与生产运维 |
| Kubernetes 扩展 | API 与 Operator、Admission、调度扩展与 DRA |
| Linux 网络栈 | 收发路径、路由与传输层、Netfilter 与队列、虚拟网络与排障 |
