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

| 阶段 | 文章 | 学习成果 |
| --- | --- | --- |
| 总览 | [NFS 在 AI 集群中的使用与性能分析](./01-NFS在AI集群中的使用与性能分析.md) | 比较 NFS、CephFS、对象存储并完成基础接入 |
| 协议 | [RPC、NFSv3 与 NFSv4 协议原理](./02-RPC、NFSv3与NFSv4协议原理.md) | 画出客户端、RPC、服务端调用与状态恢复路径 |
| 一致性 | [NFS 缓存、一致性、锁与文件句柄](./03-NFS缓存一致性锁与文件句柄.md) | 解释 close-to-open、delegation、锁和 stale handle |
| 部署/HA | [NFS 生产部署、安全与高可用](./04-NFS生产部署安全与高可用.md) | 完成安全导出、身份治理、fencing 和故障切换 |
| 性能 | [NFS 性能指标、压测与参数调优](./05-NFS性能指标压测与参数调优.md) | 使用 fio/nfsstat/nfsiostat 并基于证据调参 |
| K8s/排障 | [NFS CSI、生产故障排查与 AI 冷启动](./06-NFS%20CSI生产故障排查与AI冷启动.md) | 完成 RWX 动态供应、分层排障和回源治理 |

## 相关学习材料

完成 NFS 主线后继续串联：

- [NFS 在 AI 集群中的使用与性能分析](./01-NFS在AI集群中的使用与性能分析.md)
- [大模型文件在 Kubernetes 中的存储方案](../ai-workloads/06-大模型文件在%20Kubernetes%20中的存储方案.md)
- [模型文件从存储加载到 GPU 显存的完整路径](../../projects/ai-infra-end-to-end/02-模型文件从存储加载到GPU显存的完整路径.md)

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
