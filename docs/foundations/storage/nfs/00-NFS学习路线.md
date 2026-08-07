---
title: "NFS 学习路线"
sidebar_position: 0
tags: [NFS, Linux, 存储, Kubernetes, CSI, 学习路线]
description: "从 NFS 协议、RPC、缓存与一致性开始，学习部署、高可用、性能分析、Kubernetes 接入和生产故障排查。"
---

# NFS 学习路线

NFS 看起来只是“服务端导出目录、客户端 mount”，但生产问题往往涉及：

- RPC 请求如何到达服务端。
- NFSv3 与 NFSv4 的状态和端口差异。
- 客户端缓存、一致性和文件锁。
- 服务端线程、网络、磁盘和元数据瓶颈。
- 多 GPU 节点并发加载模型造成的启动风暴。
- Kubernetes PV、CSI、权限和卸载流程。

本系列按“原理 → 部署 → 性能 → Kubernetes → 高可用 → 排障”组织。

## 系列目录

| 阶段 | 计划文章 | 学习成果 |
| --- | --- | --- |
| 基础 | 01-NFS 是什么以及适用边界 | 能比较 NFS、CephFS、对象存储 |
| 原理 | 02-RPC、NFSv3 与 NFSv4 | 能画出客户端到服务端调用路径 |
| 原理 | 03-缓存、一致性、锁与文件句柄 | 能解释 close-to-open 与 stale handle |
| 部署 | 04-NFS 服务端与客户端部署 | 能独立完成安全导出和挂载 |
| 性能 | 05-NFS 性能指标与压测方法 | 能使用 fio/nfsstat/nfsiostat |
| 性能 | 06-rsize、wsize、nconnect 与缓存调优 | 能基于证据调整挂载参数 |
| K8s | 07-NFS PV 与 CSI 动态供应 | 能完成 RWX 卷的供应、挂载和回收 |
| HA | 08-NFS 高可用架构 | 能理解 VIP、共享后端、状态恢复 |
| 排障 | 09-NFS 常见故障排查 | 能处理超时、权限、卡挂载、stale handle |
| AI | 10-NFS 模型存储与冷启动优化 | 能控制并发回源和节点缓存 |

## 已有学习材料

在完整 NFS 系列补齐前，可以先学习：

- [NFS 在 AI 集群中的使用与性能分析](./01-NFS在AI集群中的使用与性能分析.md)
- [大模型文件在 Kubernetes 中的存储方案](../ai-workloads/06-大模型文件在%20Kubernetes%20中的存储方案.md)
- [模型文件从存储加载到 GPU 显存的完整路径](../../../projects/end-to-end/02-模型文件从存储加载到GPU显存的完整路径.md)

## 建议实验环境

```text
nfs-server
  4 vCPU / 8 GiB / 独立数据盘

nfs-client-1
nfs-client-2
  2 vCPU / 4 GiB

可选：
  Kubernetes 3 节点实验集群
```

实验中至少准备：

- 一个 10～50 GiB 大文件，模拟模型权重。
- 一批小文件，模拟 Tokenizer、配置和数据集元数据。
- 单客户端与多客户端并发负载。
- 冷缓存与热缓存两组结果。

## 每篇文章的统一验收

1. 画出该主题的数据路径。
2. 给出可复现配置和命令。
3. 记录正常基线。
4. 注入一个明确故障。
5. 用指标和日志定位。
6. 修复后使用相同负载复测。

## 最终能力

- [ ] 能解释 NFS 客户端、RPC、服务端和后端磁盘的关系。
- [ ] 能区分 NFSv3 与 NFSv4 的关键行为。
- [ ] 能正确设计 exports、身份映射和权限。
- [ ] 能从吞吐、IOPS、RTT、execute time 和 retrans 定位瓶颈。
- [ ] 能在 Kubernetes 中提供 ReadWriteMany 存储。
- [ ] 能设计 NFS 高可用和故障切换测试。
- [ ] 能处理模型并发加载对 NFS 的冲击。
- [ ] 能判断何时应从 NFS 迁移到 CephFS、对象存储或并行文件系统。
