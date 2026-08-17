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
├── gpu/                 # GPU 与加速计算
├── networking/          # 网络
├── storage/             # 存储
├── cloud-native/        # 容器与 Kubernetes
├── ai-systems/          # AI 训练、推理与 MLOps
├── data-systems/        # 数据库、缓存、消息、搜索、分析与大数据工程
├── sre/                 # 可观测性、可靠性、性能与事故复盘
├── automation/          # 自动化与 DevOps
└── projects/            # 综合项目
```

## 主题目录

```text
linux/
└── commands/            # 按文件、权限、进程、内核、容器等分类的命令库

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
├── inference/           # 推理原理、vLLM、服务与压测命令
└── mlops/               # 模型生命周期、发布与供应链

data-systems/
├── databases/           # 关系数据库
│   ├── mysql/           # MySQL
│   └── postgresql/      # PostgreSQL
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
```

## 跨模块归档规则

| 内容 | 唯一主归属 |
| --- | --- |
| GPU 架构、显存、PCIe、NUMA、NVLink、CUDA | `gpu/` |
| GPU 设备管理、调度、切分、DRA、治理 | `gpu/cluster/` |
| TCP/IP、数据中心网络、RDMA、AI Fabric | `networking/` |
| Kubernetes 网络与 NetworkPolicy | `networking/kubernetes/` |
| NFS、Ceph、NVMe、对象存储 | `storage/` |
| Kubernetes PV、PVC、StorageClass、CSI | `storage/kubernetes/` |
| Kubernetes 通用能力与扩展 | `cloud-native/kubernetes/` |
| AI 训练、推理、模型制品和 MLOps | `ai-systems/` |
| MySQL、PostgreSQL | `data-systems/databases/` |
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

这些脚本用于审计历史迁移，不应在已经迁移完成的目录上重复执行。
