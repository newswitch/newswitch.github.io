# 文档目录设计

## 设计目标

- 本地 `docs/` 是网站目录的唯一事实来源，源码目录必须与网站目录一致。
- 一级目录直接使用读者会搜索的技术主题，不要求读者先理解“基础、平台、工程”等抽象分层。
- 同一个主题只保留一个主归属；跨模块学习路线使用相对链接引用，不复制正文。
- 综合项目负责串联 GPU、网络、存储、Kubernetes、训练推理与 SRE。
- 所有技术文章统一发布在 `https://newswitch.github.io/docs/...`。

## 当前一级目录

```text
docs/
├── intro.mdx            # 全站导读
├── learning/            # 全站与跨模块学习地图
├── linux/               # Linux 与操作系统
├── hardware/            # CPU、内存、主板、总线与服务器硬件
├── gpu/                 # GPU、NPU 与加速计算
├── networking/          # 网络
├── storage/             # 存储
├── cloud-native/        # 云原生与平台工程
├── ai-systems/          # AI 训练、推理与 MLOps
├── data-systems/        # 数据库、缓存、消息、搜索、分析与大数据工程
├── development/         # 软件开发、接口、并发、测试与工程质量
├── sre/                 # 可观测性、可靠性、性能与事故复盘
├── automation/          # 自动化与 DevOps
├── personal-projects/   # 独立作品与项目说明
└── projects/            # 跨技术域综合项目
```

## 主题目录

```text
linux/
└── commands/            # 按文件、权限、进程、内核、容器等分类的命令库

hardware/
├── overview/            # 服务器整体架构、上电与数据路径
├── cpu/                 # CPU 微架构、缓存一致性、Socket 与 NUMA
├── memory/              # DDR、DIMM、Channel、Rank、ECC 与 RAS
├── motherboard-bus/     # 主板平台、PCIe 物理链路、Retimer 与 CXL
├── storage-devices/     # HDD、SSD、NAND、FTL 与 NVMe 硬件
├── network-devices/     # NIC、MAC、PHY、SerDes、光模块与线缆
├── switching-hardware/  # 交换 ASIC、Pipeline、TCAM、Buffer 与队列
├── power-cooling/       # PSU、VRM、PDU、风冷、液冷与功率预算
├── firmware-management/ # BIOS、BMC、CPLD、FRU 与固件生命周期
├── reliability/         # MCE、EDAC、AER、SMART、SEL、Burn-in 与 RMA
└── call-paths/          # CPU、I/O、网络、模型加载与 GPU 的跨层调用链

gpu/
├── fundamentals/        # GPU 架构与计算基础
├── memory/              # 显存与 HBM
├── pcie-numa/           # PCIe、NUMA 与 CPU-GPU 数据搬运
├── nvlink-nvswitch/     # NVLink 与 NVSwitch
├── cuda/                # CUDA 执行模型
├── driver-runtime/      # 驱动、CUDA 与容器运行时
├── performance/         # GPU 性能分析与优化
├── cluster/             # 设备管理、调度、共享、DRA、治理与排障
├── commands/            # GPU 与加速器命令库
└── labs/                # 动手实验

networking/
├── fundamentals/        # TCP/IP、子网、数据包生命周期
├── routing-switching/   # 路由、交换、VLAN、OSPF、BGP
├── datacenter/          # Leaf-Spine、Underlay、VXLAN、EVPN
├── high-performance/    # Linux 高性能网络、DPDK
├── rdma-roce/           # RDMA、RoCE、InfiniBand
├── ai-fabric/           # AI Fabric、无损网络与生产运维
├── kubernetes/          # CNI、Service、Ingress、Gateway API、NetworkPolicy
├── load-balancing-proxy/# 负载均衡、Nginx 与代理
├── automation/          # 网络自动化与智能管控
├── commands/            # 网络命令库
├── labs/                # 网络实验与综合项目
└── troubleshooting/     # 网络故障排查

storage/
├── linux-io/            # Linux I/O 与文件系统基础
├── local-storage/       # 本地磁盘、LVM、RAID、NVMe
├── nfs/                 # NFS
├── ceph/                # Ceph 原理、部署、使用、运维与排障
├── object-storage/      # 对象存储与 S3
├── kubernetes/          # CSI、PV、PVC、StorageClass
├── ai-workloads/        # 数据集、模型、Checkpoint 与 AI I/O
└── commands/            # 存储命令库

cloud-native/
├── fundamentals/        # 云原生基础
├── containers/          # 容器与运行时
├── kubernetes/          # Kubernetes 核心能力、运维与扩展
├── service-mesh/        # 服务网格
└── serverless-edge/     # Serverless 与边缘计算

ai-systems/
├── runtime/             # Python、环境和动态链接库
├── models/              # 模型与数据制品
├── training/            # 分布式训练、通信与训练命令
├── inference/           # 推理原理、框架、服务、性能与压测命令
│   └── vllm/
│       ├── 01-architecture/ # 架构、启动与请求生命周期
│       ├── 02-execution/    # 调度、KV Cache、执行与并行
│       ├── 03-performance/  # 性能、容量、通信与故障分析
│       ├── 04-parameters/   # Serve、Engine、请求与 Bench 参数
│       ├── 05-operations/   # 准入控制与生产 Runbook
│       └── 90-source-notes/ # 旧版源码学习笔记
└── mlops/               # 模型生命周期、发布与供应链

data-systems/
├── databases/           # 关系数据库
│   ├── mysql/           # MySQL
│   └── postgresql/      # PostgreSQL
├── database-reliability/# 数据库备份、PITR、高可用与容灾
├── cache/               # 缓存与内存数据
│   └── redis/           # Redis
├── messaging/           # 消息与事件
│   ├── kafka/           # Kafka
│   └── rocketmq/        # RocketMQ
├── search/              # 搜索引擎
│   └── elasticsearch/   # Elasticsearch
├── vector-databases/    # 向量数据库
│   └── milvus/          # Milvus
├── analytics/           # OLAP 与分析数据库
│   ├── clickhouse/      # ClickHouse
│   └── olap/            # Trino、Doris 与横向选型
└── big-data/            # 大数据工程
    ├── foundations/     # 分布式数据基础
    ├── hadoop-hive/     # Hadoop、HDFS、YARN 与 Hive
    ├── spark/           # Spark
    ├── flink/           # Flink
    ├── lakehouse/       # 数据湖与 Iceberg
    ├── engineering-governance/ # CDC、编排、质量、治理与 SRE
    └── projects/        # 端到端数据项目

sre/
├── observability/       # 指标、日志、追踪、GPU 与 Kubernetes 观测
├── reliability/         # SLI、SLO、Error Budget 与自动修复
├── performance/         # 系统、GPU 与模型服务性能工程
└── incidents/           # 故障案例与复盘

projects/
└── heterogeneous-cluster/
    ├── 01-foundations/  # 双资源池原理与总体架构
    ├── 02-planning/     # 资产、兼容矩阵与容量规划
    ├── 03-cluster/      # 集群和 GPU/NPU 资源池部署
    ├── 04-scheduling/   # 调度、配额、隔离与共享
    ├── 05-storage/      # 模型存储、分发、缓存与预热
    ├── 06-inference/    # 推理服务、网关、扩缩容与切流
    ├── 07-operations/   # 运维、监控、排障与演练
    └── 90-appendix/     # 模板、清单、PromQL 与 SOP
```

## 产品级专题目录

软件开发按具体语言与框架建立独立入口。`development/java/` 保存 Java、标准库、并发、JVM、构建和排障；`development/spring/` 保存容器、AOP、事务、Web 和源码调用链；`development/spring-boot/` 保存启动配置、服务、数据接入、安全及生产运行。每个系列保留学习路线，专题文件夹随正文发布逐步建立，网站不维护另一套虚拟目录。

代码示例保存在 `examples/java/first-batch/` 与 `examples/java/second-batch/`，不进入文档侧边栏。`scripts/verify-java-examples.mjs` 验证工具链与 Maven 示例，`scripts/verify-java-standard-library.mjs` 验证语言进阶和标准库示例；两者都检查文章与源码一致，并可使用 JDK 25 编译、运行和测试。`target/` 与 `out/` 构建产物不提交。

`examples/java/third-batch/` 保存构建、测试和并发示例。`scripts/verify-java-concurrency.mjs` 验证并发程序和协调边界，`scripts/verify-java-builds.mjs` 在临时工作区验证 Maven/Gradle、测试失败门禁、多模块分发与可复现归档。

`examples/java/fourth-batch/` 保存 JVM 与诊断的 11 个完整程序。`scripts/verify-java-runtime.mjs` 检查文章与源码一致，验证字节码、类初始化、内存、G1/ZGC、JIT、AppCDS/AOT、自定义 JFR，并只 Attach 自己启动的有界诊断进程，覆盖线程、NMT、JFR 与 jstat。实验文件在忽略的 `.java-article-checks/` 中生成并清理；Linux cgroups、native profiler 与 Arthas 不包含在该 Windows/JDK 自动实测范围。Java 网站专题与本地 `01-language`、`02-standard-library`、`03-concurrency`、`04-jvm`、`05-build-testing`、`06-diagnostics` 目录一一对应。

`examples/spring/container-lab/` 保存 Spring 容器专题的 7 个演示、Maven 工程、属性资源与 JUnit 边界测试。`scripts/verify-spring-container.mjs` 检查 9 个文章代码/资源文件与源码一致，在独立临时工程验证测试报告、Spring 模块版本，以及每个示例 3 次独立进程的输出。纯 Spring 示例不引入 Boot、不启动网络服务或后台 Worker；`target/`、`out/` 与临时工作区不提交。网站的容器专题来自本地 `development/spring/01-container/`。

`examples/spring/transactions-lab/` 保存 AOP、JDBC 与事务专题实验。`scripts/verify-spring-transactions.mjs` 检查 10 个文章源码文件、JUnit 报告、Spring/H2/AspectJ 固定依赖和 7 个主类各 3 次运行输出。H2 为独立进程内内存库，锁等待与线程有上限，示例关闭自己的连接与执行器，不连接已有数据库或启动服务端。对应网站与本地目录为 `development/spring/02-aop-transactions/`。

`examples/spring/web-lab/` 保存 Servlet、MVC、异步通信与 Reactor/WebFlux 专题。`scripts/verify-spring-web.mjs` 对照 11 个文章源文件，验证 40 项 JUnit 边界测试与 7 个主类各 3 次运行结果。真实 HTTP、SSE、WebSocket 与模拟 Servlet 测试明确分开；真实服务器仅绑定 `127.0.0.1` 临时端口，使用有界线程、连接池与超时，并关闭自有资源。Web 专题由本地 `development/spring/03-web/` 自动生成，分类默认折叠。运行验证脚本需要 JDK 25、Maven 3.9.14；`--check-sources` 只检查文章和示例一致性，不启动服务。

`examples/spring/internals-lab/` 保存 Spring 7.0.9 源码专题的 7 个演示与测试。`scripts/verify-spring-internals.mjs` 对照 8 个文章源文件，验证 42 项 JUnit 测试、运行依赖版本以及每个主类 3 次独立 JVM 输出。实验覆盖刷新失败、循环依赖、配置导入、自动代理、真实 H2 事务、MockMvc 与 TestContext 缓存，不启动网络服务；关闭自有上下文和数据库池，缓存仅定向失效本实验配置。对应目录为 `development/spring/04-internals/`，默认折叠；验证工具使用 JDK 25、Maven 3.9.14。

`examples/spring-boot/startup-lab/` 保存 Boot 4.1.1 启动与配置专题，包含普通自动配置库、依赖型 Starter 和可执行应用三个 Maven 模块。`scripts/verify-boot-startup.mjs` 对照 18 个文章代码/资源文件，验证 36 项测试、六个主类各三次输出，以及可执行 JAR 的真实 HTTP 请求、普通库布局、候选资源和生成的属性元数据。服务器仅绑定环回临时端口，Runner 等待有期限，结束后关闭自有上下文；构建目录不提交。文档目录为 `development/spring-boot/01-startup-configuration/`，默认折叠，工具使用 JDK 25 与 Maven 3.9.14。

文章较多的产品目录保留 `00-学习路线` 作为唯一入口，正文按可以直接识别的技术专题继续分组。网站侧边栏由这些目录自动生成，不单独维护文章列表。

Spring Boot 六个专题现有 42 篇正文，连同 Java 56 篇、Spring 28 篇和三篇路线共 129 篇。`examples/spring-boot/service-lab/` 使用 Boot 4.1.1 与 JDK 25，`scripts/verify-boot-service.mjs` 在独立目录构建并验证 31 项测试：真实 HTTP 健康、带安全链的 MockMvc、H2 事务、并发幂等、版本竞争与 Outbox 回滚。外部中间件、目标数据库、IdP、Testcontainers、systemd、Kubernetes、Native 不在本机验证范围。

`static/img/development/` 保存 20 张无外部字体或远程依赖的 SVG 机制图，源布局由 `scripts/generate-development-diagrams.mjs` 生成。编辑布局后重新生成，并栅格预览检查文字边界、连线和图注；文章通过固定静态路径引用，Mermaid 用于请求时序、状态与跨系统消息流程。不要为单个术语强制加图。

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

## 跨模块归档规则

AI 集群运维继续按知识点归档，不建立以认证名称命名的正文目录。`learning/05-AI集群运维知识体系与掌握检查.md` 只串联各领域主文章。BCM 归 `gpu/bare-metal-fleet/base-command-manager/`，Run:ai 归 `gpu/cluster/scheduling/run-ai/`，两者保留产品对象和实现差异，不复制通用调度、网络启动或权限原理。DOCA 归现有 `networking/dpu/`，NGC 镜像与权限归现有 `cloud-native/containers/images/`，VMI 的 GPU 运行栈归 `gpu/driver-runtime/`，Fleet Command 的边缘生命周期归现有边缘计算目录。NVSM 原理归节点管理、命令归 GPU 命令库；NVSwitch FM 与 InfiniBand UFM 分别归互联和网络运维。

| 内容 | 唯一主归属 |
| --- | --- |
| GPU 架构、显存、PCIe、NUMA、NVLink、CUDA | `gpu/` |
| 通用 CPU、DIMM、主板、硬件总线、供电与硬件可靠性 | `hardware/` |
| GPU 设备管理、调度、切分、DRA、治理 | `gpu/cluster/` |
| TCP/IP、数据中心网络、RDMA、AI Fabric | `networking/` |
| Kubernetes 网络与 NetworkPolicy | `networking/kubernetes/` |
| NFS、Ceph、NVMe、对象存储 | `storage/` |
| Kubernetes PV、PVC、StorageClass、CSI | `storage/kubernetes/` |
| Kubernetes 通用能力与扩展 | `cloud-native/kubernetes/` |
| AI 训练、推理、模型制品和 MLOps | `ai-systems/` |
| MySQL、PostgreSQL | `data-systems/databases/` |
| 数据库备份、PITR、高可用与容灾通用原理 | `data-systems/database-reliability/` |
| Redis | `data-systems/cache/` |
| Kafka、RocketMQ | `data-systems/messaging/` |
| Elasticsearch、Milvus | `data-systems/search/`、`data-systems/vector-databases/` |
| ClickHouse、Trino、Doris | `data-systems/analytics/` |
| Hadoop、Hive、Spark、Flink、湖仓与数据治理 | `data-systems/big-data/` |
| 指标、SLO、性能、事故复盘 | `sre/` |
| 跨越三个以上模块的完整实践 | `projects/` |

例如 Kubernetes 学习路线需要介绍网络时，应链接到 `networking/kubernetes/`；需要介绍存储时，应链接到 `storage/kubernetes/`。不要在 `cloud-native/` 再复制一套正文。

## 文件约定

1. 每个学习域使用 `00-xxx学习路线.md` 或 `00-xxx学习地图.md` 作为入口。
2. 有明确顺序的系列使用两位数字前缀；独立笔记可使用语义化文件名。
3. 每个会出现在侧边栏的目录使用 `_category_.json` 设置中文名称、位置和折叠状态。
4. 文章之间使用相对 Markdown 链接；移动文件时必须同步重写引用。
5. 新目录应至少容纳一个明确的技术系列，避免为单篇文章制造过深层级。
6. 命令文章放在所属技术主题的 `commands/` 中，不建立脱离技术上下文的全局命令堆。

## 侧边栏与发布

`sidebars.js` 只声明一级技术主题，二级及以下结构由 `docs/` 和 `_category_.json` 自动生成。因此本地目录、网站目录和维护入口保持一致。

发布前必须执行：

```bash
npm run build
```

Windows 本地重建若在 Rspack 打包阶段长期无 CPU 与输出进展，可在独立 PowerShell 会话中临时设置 `$env:DOCUSAURUS_NO_PERSISTENT_CACHE='true'` 排除持久缓存影响；本次验证同时使用 `$env:DOCUSAURUS_SSG_WORKER_THREAD_COUNT='2'`、`$env:DOCUSAURUS_SSR_CONCURRENCY='4'` 限制页面生成并发。它们仅用于本地诊断，不修改站点配置或 CI；不要把任意构建失败都归因于缓存。

构建成功后推送到 `main`，GitHub Actions 自动部署 GitHub Pages。

## 迁移脚本

- `scripts/restructure-docs.mjs`：第一次知识域迁移的历史脚本。
- `scripts/migrate-topic-structure.mjs`：本次主题式目录迁移脚本，包含文件映射、分类入口更新和 Markdown 链接重写逻辑。
- `scripts/migrate-data-systems-taxonomy.mjs`：将数据系统拆分为数据库、缓存、消息、搜索、向量、分析和大数据工程，并重写全站相对链接。
- `scripts/restructure-navigation-2026.mjs`：将 vLLM 与异构集群长列表拆成可定位的专题目录，并重新计算全站相对链接。
- `scripts/restructure-product-directories-2026.mjs`：将文章较多的产品与专题目录拆分为原理、核心能力、部署扩展和生产运维等专题，并重写全站引用。

这些脚本用于审计历史迁移，不应在已经迁移完成的目录上重复执行。
