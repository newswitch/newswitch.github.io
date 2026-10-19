---
title: "NVSM 整机健康告警与证据关联"
sidebar_label: "08. NVSM 整机健康告警与证据关联"
sidebar_position: 8
description: "区分整机健康与 GPU 遥测，学习 NVSM 的平台适用范围、告警生命周期、证据关联和恢复验证。"
tags: [NVSM, DGX, DCGM, 健康, 告警]
---

# NVSM 整机健康告警与证据关联

NVSM 管理和监测受支持的 NVIDIA 服务器平台，重点是整机部件、软件和平台关联。它与 DCGM 的 GPU 管理能力互补，但不是任意 OEM GPU 服务器上都可无条件安装并获得同样检查结果的通用硬件探针。

## 1. 三种观察尺度

NVML/nvidia-smi 面向设备管理接口，DCGM 组织 GPU 字段、健康与诊断，NVSM 则结合平台结构关联整机部件及告警。某张卡的温度正常，不代表供电、风扇、磁盘或软件版本均健康。

以 NVSM 25.03 用户指南为阅读基线。平台支持与功能有差异，例如 DGX Station 的能力不能直接等同于 DGX Server 的持续监测能力。实际执行前核对机型、版本与本机帮助，不把某个指南输出中的检查数当作固定标准。

## 2. 告警有生命周期

事件表示某件事发生，告警表示需要处理的条件及其状态，时序指标表示连续采样。条件消失后的 cleared 不能抹去历史故障；持续存在的历史告警也不一定表示当前采集仍在更新。

建立“部件身份、首次发生、最近观察、状态变化、相关日志、修复动作”的关联。若同一设备换卡后仍沿用旧序列号标签，可能把新设备告警与旧设备混在一起。

## 3. 分层证据

教学场景：NVSM 报某 PCIe 相关部件异常，DCGM 同时看到 GPU 通信下降。先把两者映射到服务器、PCI BDF、GPU UUID、槽位与相邻链路，检查是否共享同一物理路径，而不是分别更换两个被告警点名的部件。

只读观察入口和健康包说明见[NVSM 命令参考](../commands/23-NVSM命令详解.md)。健康包是支持分析材料，不是自动送修结论；生成过程可能消耗资源并包含敏感配置。

继续读[对象树、健康检查与证据包](./10-NVSM对象树健康检查与证据包.md)，沿 `Status_HealthRollup`、具体 GPU 和 incident 下钻。NVSM 的 GPU 健康可来自 DCGM，两个工具同时报告同一事件不一定构成独立重复验证；还要寻找物理路径和其他来源的证据。

## 4. Call Home 的数据边界

部分部署可配置 Call Home，在告警时收集并向服务端发送材料。它涉及日志、序列号和外部连接，应经过组织的授权与数据审查，不能把“安装 NVSM”当成“允许自动上传”。离线流程也需要明确保存位置、保留期和共享范围。

告警通道可用、平台健康和业务恢复是三个结果。修复后仍需主动验证设备、链路、最小计算与目标应用，而不是只检查告警是否消失。

## 5. 掌握检查

为什么 DCGM 正常但 NVSM 告警不矛盾？两者观察对象和检查条件不同。为什么一份健康检查全绿不能替代负载验收？它只覆盖该时刻、该平台、该组检查项，未必覆盖持续功耗、通信和真实数据路径。

## 6. 参考资料

- [NVSM 介绍与平台范围](https://docs.nvidia.com/datacenter/nvsm/nvsm-user-guide/latest/introduction.html)
- [NVSM CLI 与健康检查](https://docs.nvidia.com/datacenter/nvsm/nvsm-user-guide/latest/using-nvsm-cli.html)
- [NVSM Call Home](https://docs.nvidia.com/datacenter/nvsm/nvsm-user-guide/latest/nvsm-call-home.html)
