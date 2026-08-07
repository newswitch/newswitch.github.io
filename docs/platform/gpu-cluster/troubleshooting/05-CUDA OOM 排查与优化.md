---
title: CUDA OOM 排查与优化
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["CUDA", "OOM", "显存", "vLLM", "PyTorch", "学习路线"]
---

# CUDA OOM 排查与优化

> 示例以 PyTorch / vLLM 与 Kubernetes 为主。显存组成见 [第 24 篇](../../../ai-systems/inference/serving/02-vLLM%20GPU%20显存组成与容量规划.md)；六层定位见 [第 43 篇](./02-GPU%20集群六层排障模型.md)。

典型：`CUDA out of memory` / `torch.OutOfMemoryError`。须先分清三种完全不同的 OOM：

| 类型 | 含义 |
|------|------|
| **CUDA OOM** | GPU 显存分配失败 |
| **OOMKilled** | 超容器 memory limit，cgroup 杀进程（常 exit 137） |
| **Host OOM** | 节点物理内存耗尽，内核 OOM Killer |

`limits.memory` **不限制** GPU 显存。

---

## 1. 确认类型并保存现场

```bash
kubectl logs ... | grep -Ei 'CUDA out of memory|OutOfMemoryError'
kubectl get pod ... -o jsonpath='...lastState.terminated.reason...'
journalctl -k | grep -Ei 'Out of memory|Killed process|oom-killer'

# 勿立刻重启：nvidia-smi、query-compute-apps、dmon、logs/--previous
```

运行时显存 ≠ 模型文件大小：权重、KV、激活、Context/Graph、NCCL、碎片等（训练另有梯度/优化器等）。

---

## 2. 常见原因与处理

| 场景 | 线索 | 方向 |
|------|------|------|
| 权重放不下 | 加载阶段就 OOM、尚无请求 | 加大卡/TP、量化、Offload、换小模型 |
| 上下文过长 | 长 Prompt/输出后挂 | 降 `max-model-len`、限输入输出 |
| 并发过高 | 低并发 OK | 降 seqs/Batch、限网关并发、加副本 |
| 残留进程 | 删 Pod 后仍占显存 | 查 PID/cgroup，勿盲目 `kill -9` |
| TP 与卡数不符 | 申请 2 卡却 TP=4 | **Pod GPU 数 = tensor-parallel-size** |
| 泄漏 | 请求后显存只升不降 | 查引用/缓存/Graph；用 memory_summary/快照 |
| 碎片 | `nvidia-smi` 仍有空闲但大块分配失败 | PyTorch 缓存分配器；`empty_cache()` 非万能 |

`torch.cuda.empty_cache()` 只释放缓存池中未用块，**不会**释放仍被引用的 Tensor/权重/有效 KV；不能当泄漏的永久方案。

---

## 3. PyTorch / vLLM

输出 `memory_summary()`、`memory_allocated/reserved/max`、`mem_get_info`；需要时 `_record_memory_history` + dump（快照未必含 NCCL 直接分配）。

vLLM：查日志 memory/cache/oom；调参顺序建议：权重能否加载 → 降 `max-model-len` → 降 `max-num-seqs` → 限请求长度 → 调 `gpu-memory-utilization` → 加 TP → 量化。训练侧：减 Batch、累积梯度、混合精度、Checkpoint、FSDP/ZeRO 等。

Time-Slicing 下一 Pod 可吃满整卡显存——靠 MIG/MPS/HAMi、应用限流、准入与节点池治理。

---

## 4. 不要做的

未定位前反复：重启 Device Plugin/整节点、清空全部 GPU 进程、盲目把 utilization 拉到 0.99、无限加 `memory` limit——只会掩盖「容量不足 / 并发 / 碎片 / 泄漏 / 残留」的区分。

---

## 5. 本篇总结

```text
区分 CUDA OOM vs OOMKilled → 保存现场 → 看 GPU 进程
→ 启动 OOM 还是运行 OOM → 权重/KV/并发 → 碎片与泄漏
→ 一次只改一个变量再压测
```

下一篇：[NVIDIA Xid 错误排查](./06-NVIDIA%20Xid%20错误排查.md)。

---

## 参考与致谢

- [Understanding CUDA Memory Usage — PyTorch](https://docs.pytorch.org/docs/stable/torch_cuda_memory.html)
- [torch.cuda.empty_cache](https://docs.pytorch.org/docs/main/generated/torch.cuda.memory.empty_cache.html)
- [vLLM Conserving Memory / Troubleshooting](https://docs.vllm.ai/en/stable/usage/troubleshooting/)

本文按 PyTorch / vLLM 显存与排障文档整理，并按本系列交叉链接。
