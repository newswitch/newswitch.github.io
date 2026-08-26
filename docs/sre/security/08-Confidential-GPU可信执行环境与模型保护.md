---
title: "Confidential GPU 可信执行环境与模型保护"
sidebar_label: "08. Confidential GPU"
sidebar_position: 8
description: "理解 CPU TEE、GPU 受保护模式、Attestation、密钥发布和 DMA 边界，评估机密计算的能力与限制。"
tags: [Confidential Computing, GPU, TEE, Attestation, 模型保护]
---

# Confidential GPU 可信执行环境与模型保护

## 1. 要保护什么

机密计算主要保护“使用中的数据”，与静态存储加密和传输加密组成三种状态：

```text
At Rest：对象/磁盘加密
In Transit：TLS/IPsec
In Use：CPU/GPU可信执行与受保护内存
```

目标通常是降低宿主管理员、Hypervisor 或物理总线观察模型权重和输入数据的能力。

## 2. 信任链

```text
Hardware Root of Trust
→ Firmware/Boot Measurement
→ CPU TEE Guest
→ GPU Device/Firmware受保护状态
→ Attestation Evidence
→ Verifier验证Policy
→ KMS只向合格实例释放模型密钥
```

没有 Attestation 验证和条件密钥发布，仅打开某个“Confidential Mode”不能建立端到端保护。

## 3. CPU 与 GPU 边界

CPU TEE 保护 VM 内存，GPU 通过 PCIe/DMA 与 Guest 交互。需要防止未受保护 Bounce Buffer、错误 IOMMU 映射或 Host Driver 看到明文。具体方案可能使用加密链路、受保护 BAR/显存和可信 Driver/Firmware，能力随硬件代际变化。

## 4. Attestation

Verifier 检查证据签名、芯片身份、Firmware/TCB 版本、Debug 状态和测量值，并应用 Policy。证据有有效期和防重放要求；Verifier/KMS 自身也是高价值控制面。

## 5. 模型加载

```text
加密模型对象
→ 受保护实例启动
→ 完成CPU/GPU Attestation
→ KMS发放短期解密密钥
→ 在受保护内存中解密/加载
→ 禁止明文写入普通Cache和日志
```

Tokenizer、自定义代码、Checkpoint 和输出同样需要定义保护边界。

## 6. 性能与功能限制

机密模式可能影响 P2P、RDMA、Profiler、Debug、MIG、Live Migration 或性能。目标版本的支持矩阵必须逐项验证。无法使用详细 Profiler 会改变故障排查方法，需要更多 Guest 内可观测性。

## 7. 不解决的问题

机密计算不保证模型代码无漏洞、不阻止授权用户滥用输出、不替代身份、配额、供应链签名和应用安全。Guest 内部被攻破后，TEE 仍可能保护攻击者控制的工作负载。

## 8. 验收

- 错误 TCB/Debug/过期证据无法获取密钥；
- Host 侧看不到明文模型文件；
- 重启和扩容重新完成 Attestation；
- 密钥撤销和轮换有效；
- 性能、P2P、网络和故障恢复符合 SLO；
- 日志、Core Dump、Cache 不泄露明文。

参考：[Confidential Computing Consortium](https://confidentialcomputing.io/)、[NVIDIA Confidential Computing](https://www.nvidia.com/en-us/data-center/solutions/confidential-computing/)。
