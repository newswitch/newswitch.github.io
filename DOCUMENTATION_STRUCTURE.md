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

文章较多的产品目录保留 `00-学习路线` 作为唯一入口，正文按可以直接识别的技术专题继续分组。网站侧边栏由这些目录自动生成，不单独维护文章列表。

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

构建成功后推送到 `main`，GitHub Actions 自动部署 GitHub Pages。

## 迁移脚本

- `scripts/restructure-docs.mjs`：第一次知识域迁移的历史脚本。
- `scripts/migrate-topic-structure.mjs`：本次主题式目录迁移脚本，包含文件映射、分类入口更新和 Markdown 链接重写逻辑。
- `scripts/migrate-data-systems-taxonomy.mjs`：将数据系统拆分为数据库、缓存、消息、搜索、向量、分析和大数据工程，并重写全站相对链接。
- `scripts/restructure-navigation-2026.mjs`：将 vLLM 与异构集群长列表拆成可定位的专题目录，并重新计算全站相对链接。
- `scripts/restructure-product-directories-2026.mjs`：将文章较多的产品与专题目录拆分为原理、核心能力、部署扩展和生产运维等专题，并重写全站引用。

这些脚本用于审计历史迁移，不应在已经迁移完成的目录上重复执行。
