# 文档目录设计

## 设计目标

- 本地 `docs/` 是网站目录的唯一事实来源。
- 按可独立学习的技术栈组织文章，不按岗位描述或单一端到端链路硬拆。
- 基础模块可以独立扩展，综合项目负责串联计算、网络、存储、调度和模型系统。
- 所有技术文章统一发布在 `https://newswitch.github.io/docs/...`。

## 当前目录

```text
docs/
├── intro.mdx                         # 全站导读
├── learning/                         # 跨模块学习地图
├── foundations/                      # 计算、网络、存储底座
│   ├── compute/
│   │   ├── gpu/
│   │   └── pcie/
│   ├── networking/
│   │   ├── traditional/
│   │   │   ├── PartI-网络基础与路由/
│   │   │   ├── PartII-数据中心与云/
│   │   │   └── PartIII-自动化与智能管控/
│   │   ├── linux-high-performance/
│   │   ├── rdma/
│   │   ├── ai-cluster/
│   │   └── nginx/
│   └── storage/
│       ├── ai-workloads/
│       ├── nfs/
│       └── ceph/
├── platform/                         # 资源抽象、编排与调度
│   ├── kubernetes/
│   ├── gpu-cluster/
│   │   ├── device-runtime/
│   │   ├── scheduling-sharing/
│   │   ├── dra/
│   │   ├── governance/
│   │   └── troubleshooting/
│   └── kubernetes-extensions/
├── ai-systems/                       # 模型训练、推理与交付
│   ├── inference/
│   │   ├── vllm/
│   │   └── serving/
│   ├── training/
│   │   └── distributed/
│   └── mlops/
├── engineering/                      # 生产工程闭环
│   ├── observability/
│   │   └── gpu/
│   ├── reliability/
│   ├── performance/
│   ├── automation/
│   ├── incidents/
│   └── notes/
└── projects/                         # 串联基础模块的综合实践
    ├── end-to-end/
    ├── gpu-cluster/
    └── heterogeneous-pool/
```

## 归档规则

| 内容 | 放置位置 |
| --- | --- |
| GPU 架构、显存、NVLink、PCIe | `foundations/compute/` |
| TCP/IP、Linux 网络、RDMA、AI 组网 | `foundations/networking/` |
| NFS、Ceph、NVMe、对象存储、CSI | `foundations/storage/` |
| Kubernetes 通用能力 | `platform/kubernetes/` |
| GPU 设备、调度、共享、DRA、治理 | `platform/gpu-cluster/` |
| 推理引擎和推理服务 | `ai-systems/inference/` |
| 分布式训练 | `ai-systems/training/` |
| 模型生命周期与发布 | `ai-systems/mlops/` |
| 指标、SLO、性能、自动化、事故复盘 | `engineering/` |
| 同时跨越三个以上模块的实战 | `projects/` |

同一个主题只保留一个主归属。其他模块需要引用时使用 Markdown 链接，不复制正文。

## 文件约定

1. 每个学习域使用 `00-xxx学习路线.md` 作为入口。
2. 有明确顺序的系列使用两位数字前缀；独立笔记可使用语义化文件名。
3. 每个目录用 `_category_.json` 设置网站显示名称、位置和折叠状态。
4. 文章之间使用相对 Markdown 链接，移动文件后必须同步修正引用。
5. 新目录只有在至少能容纳一组独立技术文章时才创建，避免一篇文章一个分类。

## 侧边栏与发布

`sidebars.js` 只声明六个一级知识域，二级及以下结构由目录自动生成。因此本地文件夹
移动后，网站目录会同步变化。

发布前执行：

```bash
npm run build
```

构建成功后推送到 `main`，GitHub Actions 自动部署 GitHub Pages。

## 本次迁移

`scripts/restructure-docs.mjs` 是本次大规模迁移的可审计脚本，包含旧目录到新目录的
映射及 Markdown 链接重写逻辑。迁移已经执行完成；日常新增或小规模移动文章不需要
再次运行该脚本。
