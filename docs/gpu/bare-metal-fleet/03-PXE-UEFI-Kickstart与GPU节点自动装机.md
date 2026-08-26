---
title: "PXE、UEFI、Kickstart 与 GPU 节点自动装机"
sidebar_label: "03. GPU 节点自动装机"
sidebar_position: 3
description: "拆解裸金属节点从网络启动、磁盘初始化、操作系统安装到加入 GPU 节点池的完整链路。"
tags: [PXE, UEFI, Kickstart, 裸金属, 自动装机]
---

# PXE、UEFI、Kickstart 与 GPU 节点自动装机

## 1. 一次网络装机经历什么

```text
BMC设置一次性PXE启动
→ UEFI网卡获取DHCP地址和Boot信息
→ 下载引导程序
→ 加载Kernel与Initramfs
→ 获取Kickstart/Autoinstall配置
→ 分区、安装OS、写入Bootloader
→ 首次启动执行基线配置
→ 安装驱动/容器运行时
→ 验收后加入节点池
```

DHCP 只负责地址和引导信息；TFTP/HTTP 提供启动文件；Kickstart 或 Autoinstall 描述磁盘、软件包、用户和安装后动作。生产环境通常用 HTTP 承载大文件，只用 TFTP 获取最小引导程序。

## 2. UEFI、Secure Boot 与驱动

GPU 驱动包含 Kernel Module。启用 Secure Boot 时，模块必须由受信任密钥签名，否则系统安装成功但驱动无法加载。自动装机必须固定：

- UEFI/Legacy 启动模式；
- Secure Boot 策略与模块签名；
- 系统盘选择和 GPT/ESP 分区；
- Kernel 版本；
- 驱动安装方式和重启顺序。

不要通过 `/dev/sda` 假定系统盘。NVMe、RAID 控制器和安装介质会改变设备名，应使用 WWN、Serial 或明确的硬件路径。

## 3. 不可变输入

装机结果应由以下坐标唯一确定：

```text
OS镜像Digest
+ Kickstart/Autoinstall Git Revision
+ 软件仓库快照
+ Kernel版本
+ 驱动与固件基线
+ 节点角色参数
```

如果安装过程直接访问滚动更新的软件仓库，同一天重新安装也可能得到不同 Kernel 和依赖，兼容问题将无法复现。

## 4. 分阶段执行

| 阶段 | 可执行内容 | 验收点 |
| --- | --- | --- |
| Discovery | 读取 Serial、MAC、磁盘和 NIC | 资产与端口映射正确 |
| Provision | 分区、OS、网络、账户 | 能稳定启动并联网 |
| Baseline | Kernel 参数、时间、日志、容器运行时 | 配置与镜像版本一致 |
| Accelerator | GPU/NPU 驱动和 Runtime | 设备枚举与最小计算通过 |
| Cluster Join | kubelet、标签、污点 | 先不可调度加入 |
| Qualification | Burn-in 和网络/存储基准 | 全部通过才解除污点 |

把节点先以 `NoSchedule` 状态加入，可以采集 Kubernetes 侧信息，同时阻止业务提前运行。

## 5. 幂等与失败恢复

自动装机必须能处理断电、下载中断和部分安装。关键措施包括：

- 每一步有明确状态与超时；
- 重试前读取真实电源和安装状态；
- 磁盘擦除只针对经过序列号确认的目标；
- 一次性 Boot Override 成功后自动恢复；
- 安装日志回传到中心服务；
- 不因某一节点失败阻塞整个批次；
- 批次大小受机架电力、镜像源和网络容量限制。

## 6. 验收证据

节点加入生产前保存：OS Build ID、Kernel、BIOS/BMC/NIC/GPU 固件、驱动、PCIe 拓扑、GPU 序列号、SMART、DCGM Diagnostics、RDMA/NCCL 基线和时间戳。后续性能退化时，这份基线是判断“从什么时候开始变化”的依据。

参考：[Red Hat Kickstart 文档](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/automatically_installing_rhel/)、[Ubuntu Autoinstall 文档](https://canonical-subiquity.readthedocs-hosted.com/en/latest/intro-to-autoinstall.html)。
