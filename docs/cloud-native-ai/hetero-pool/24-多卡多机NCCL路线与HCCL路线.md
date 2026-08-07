---
title: 多卡多机——NCCL路线与HCCL路线
date: 2026-08-07 10:00:00
categories: 云原生
tags: [NVIDIA, 昇腾, 双资源池, Kubernetes, AI推理, 骨架]
---

# 多卡多机——NCCL路线与HCCL路线

:::info 文章定位
**多卡多机对照篇** · 状态：骨架待填充
:::

:::tip 系列约定
资源池 A = **NVIDIA GPU**（vLLM）· 资源池 B = **华为昇腾 NPU**（vLLM-Ascend）· 同一 Kubernetes · 共享存储/网关/监控 · **禁止**跨池组成同一分布式模型实例。
:::

## 本文目标

（待填充：学完本篇读者能做什么）

## 内容大纲

- NVIDIA：vLLM→NCCL→NVLink/PCIe→RDMA/RoCE
- 昇腾：vLLM-Ascend→HCCL→HCCS/PCIe→RoCE
- 单机多卡/多机、Rank、网卡、NUMA、RoCE 测试
- NCCL/HCCL 故障；为何不能跨池组成同一模型实例

## 正文

（待填充）

## 验收清单

- [ ] （待填充）

## 相关链接

- 专栏目录：[00-专栏目录](./00-专栏目录.md)
- （填充时补充对本站 k8s / k8s-gpu / ceph / vllm 的引用，避免重复展开）

## 导航

← 上一篇 · → 下一篇（见 [专栏目录](./00-专栏目录.md)）