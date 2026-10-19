---
title: "云 GPU 镜像身份 cloud-init 与驱动生效"
sidebar_label: "05. 云 GPU 镜像身份 cloud-init 与驱动生效"
sidebar_position: 5
description: "比较 AWS Azure GCP 镜像身份，解释 cloud-init 阶段、配置漂移、驱动生效与可重建 GPU 运行环境。"
tags: [GPU, VMI, cloud-init, 云, 镜像]
---

# 云 GPU 镜像身份 cloud-init 与驱动生效

云 GPU 虚拟机的最终环境来自镜像、实例规格、首次启动配置和后续变更的共同作用。固定容器 Digest 只固定应用文件的一部分；它没有固定来宾内核、GPU 暴露方式或启动脚本下载的依赖。

先读[VMI 与启动验证](./02-云GPU虚拟机镜像与启动验证.md)。本篇不列易过期的云 GPU 型号价格表，而是解释跨平台可复现所需的稳定对象。

## 1. 三种云镜像身份并不相同

| 平台 | 应记录的镜像身份 | 常见陷阱 |
| --- | --- | --- |
| AWS | Region、AMI ID、Owner、架构 | AMI ID 有区域范围，名称不能代替发布者 |
| Azure Marketplace | Publisher、Offer、SKU、明确 Version | `latest` 是选择规则，不是固定内容 |
| GCP | 镜像 Project、具体 Image 及 ID、架构 | Image Family 可解析到后续不同成员 |

对应规则分别见 [AWS AMI](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/finding-an-ami.html)、[Azure 镜像 URN](https://learn.microsoft.com/en-us/azure/virtual-machines/linux/cli-ps-findimage)和 [GCP OS Images](https://docs.cloud.google.com/compute/docs/images)。复制或重建跨区域镜像时，应记录来源和新标识，不能凭同名认定为同一份可追溯制品。

NVIDIA GPU-Optimized VMI 与普通 OS 镜像、深度学习镜像、AI Enterprise 发行物也不自动具有相同软件和授权范围。先确认所选镜像的发布者、内容、适用实例和订阅条件，再判断需要安装什么；不把预装软件推导成任意软件授权。

## 2. 最终环境是多份输入的合成

```text
固定 VMI + 实例硬件及设备暴露方式
         + 启动元数据与 cloud-init
         + 包仓库及配置管理
         + 容器与模型制品
         = 当前实际运行环境
```

例如固定了 VMI，但启动脚本每次从未锁定的仓库安装最新驱动，今天和下周仍可能不同。反过来，同一驱动包在不同内核、签名配置和设备模式下，也可能有不同结果。

复现清单需要包含所有会影响环境的输入及其解析结果：镜像身份、硬件规格、启动配置修订、仓库版本、运行内核、驱动、容器 Digest、模型修订、网络和存储配置。秘密材料只记录引用与版本，不写入公开清单。

## 3. SSH 可用不等于 cloud-init 完成

cloud-init 的公开启动模型分为 Detect、Local、Network、Config、Final；用户脚本和包安装等可能仍在 Final 阶段执行。系统可以已接受登录，但初始化尚未完成。[启动阶段说明](https://docs.cloud-init.io/en/latest/explanation/boot.html)解释了这个时间关系。

```bash
cloud-init status --long
uname -r
nvidia-smi -L
```

以上是已获授权实例中的观察入口，不应直接打印全部 user-data 或凭据。若外部流程需要等待初始化，可以使用产品提供的等待机制并配置任务超时；不要在初始化自身内部等待自己完成，造成循环依赖。

教学反例：登录后立即运行 CUDA，发现驱动缺失；几分钟后相同命令成功。可能是初始化竞态，不应立即重复安装另一套驱动。先查看初始化状态、安装日志和实际版本，确认是否存在两个管理者竞争。

## 4. 包版本 内核模块和用户库是不同事实

安装了驱动包，不表示当前内核已经加载相应模块；加载模块也不表示应用使用正确的用户态库。预装镜像经内核更新后，还可能需要模块重建、签名验证及重启。

逐层核对设备枚举、运行内核、模块加载、NVML 查询和最小计算，再进入容器。只比较 `nvcc` 版本不能验证驱动，也不能从 `nvidia-smi` 显示的 CUDA 兼容上限推导 Toolkit 已安装。机制见[驱动与 CUDA 契约](./01-NVIDIA驱动CUDA与容器运行时的关系.md)及[动态链接与 PTX](./03-CUDA兼容性动态链接与PTX装载机制.md)。

若使用平台驱动扩展、镜像预装驱动或 GPU Operator，应明确唯一管理者。为了修复一次失败叠加多个安装器，常会让短期成功变成下一次重启后的漂移。

## 5. 构建时输入与运行时身份分开

镜像构建可以预装公共软件，但不应固化实例专属 SSH 主机身份、长期管理凭据或临时 GPU UUID 映射。派生镜像还要按发行版与云平台规则处理首次启动状态，防止新实例继承“初始化已完成”标记而跳过必要动作。

实例角色或托管身份通常用于取得运行时权限；镜像拉取凭据和应用数据权限仍要分别限制。不能因为能访问云元数据，就把得到的身份材料写到日志、镜像层或训练输出。

“重建可复现”也不要求把所有秘密复制到镜像。正确目标是从受控引用恢复所需权限，并保留哪些身份在何时使用过的审计证据。

## 6. 初始化时间应该分段测量

教学串行模型：来宾启动 40 秒、初始化包 150 秒、加载驱动并验证 20 秒、拉取制品 90 秒、模型加载 60 秒，则首次可服务约需 360 秒。若启动超时设为 120 秒，失败重试会反复打断本来可能成功的初始化。

这个加和只适用于假设的串行路径；并行阶段应按关键路径计算。已预热实例、重建实例和重新启动实例具有不同缓存与初始化成本，不能只看云平台标记 Running 的时间。

## 7. 掌握检查

**同一个 `latest` 是否适合重现实验？** 需要记录其实际解析到的固定版本，而不是只保存选择表达式。

**已能 SSH 是否可以直接开始长训练？** 还要确认初始化、生效版本、设备和数据路径。

**复制系统盘能否克隆出同样的安全身份？** 不应这样设计，实例身份应独立建立，软件基线与秘密引用分开管理。

## 8. 参考资料

- [NVIDIA 公有云 VMI 与容器运行](https://docs.nvidia.com/ngc/ngc-deploy-public-cloud/ngc-deploy-containers/index.html)
- [cloud-init 启动阶段](https://docs.cloud-init.io/en/latest/explanation/boot.html)
- [AWS 镜像标识](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/finding-an-ami.html)
- [Azure Marketplace 镜像身份](https://learn.microsoft.com/en-us/azure/virtual-machines/linux/cli-ps-findimage)
- [GCP 镜像与镜像族](https://docs.cloud.google.com/compute/docs/images)
