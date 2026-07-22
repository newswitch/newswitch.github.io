---
title: 大模型服务 Kubernetes 探针设计
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["Kubernetes", "vLLM", "探针", "Startup", "Readiness", "学习路线"]
---

# 大模型服务 Kubernetes 探针设计

> **版本提示**：固定 vLLM 镜像版本；健康路径与行为以该版本为准。示例基于 vLLM OpenAI 兼容服务的 `/health`。

大模型启动可能含：拉镜像、挂模型、读大权重、CUDA/NCCL、编译 Kernel、CUDA Graph、分配 KV、起 HTTP——可达数分钟到数十分钟。若用普通 Web 探针窗口，可能「加载中 → 探针失败 → 重启 → 再加载」。vLLM 文档也提醒 `failureThreshold` 过低会在初始化完成前被终止。

部署见 [第 23 篇](./23-Kubernetes%20部署%20vLLM%20推理服务.md)；滚动升级见 [第 27 篇](./27-大模型推理服务滚动升级与优雅退出.md)。

---

## 1. 三种探针

| 探针 | 问题 | 失败后果 |
|------|------|----------|
| **Startup** | 是否完成启动 | 成功前 **不跑** Ready/Live，保护慢启动 |
| **Readiness** | 能否接流量 | 摘 Endpoint，**不重启** |
| **Liveness** | 是否不可恢复 | kubelet **重启**容器 |

Liveness ≠「忙不忙 / 稍慢」；高负载误配会级联重启。

---

## 2. vLLM 健康接口

常用 `httpGet path: /health port: 8000`。手动：`curl -i http://127.0.0.1:8000/health` → 200。`/v1/models` 内容多，不适合高频探针。优先原生 HTTP Probe，少用 Exec（需 curl、易堆进程）。

TCP Probe 只说明端口监听，不保证模型/Worker 就绪——大模型更推荐 `/health`。

---

## 3. 推荐配置示例

```yaml
startupProbe:
  httpGet: { path: /health, port: http }
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 180   # ≈ 30 分钟上限窗口

readinessProbe:
  httpGet: { path: /health, port: http }
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 3

livenessProbe:
  httpGet: { path: /health, port: http }
  periodSeconds: 20
  timeoutSeconds: 5
  failureThreshold: 6     # ≈ 连续 ~120s 失败再重启
```

Startup 窗口是上限，不是鼓励启动 30 分钟。计算方式：临时去掉探针 → 记冷/热启动到 `/health` 200 的时间 → 取较慢值再加余量（如实测 7/9/12 分钟则留 15～20 分钟），勿只按最快一次设 `initialDelaySeconds`。

Readiness 可更敏感（约 15s 摘流）；Liveness 宜更松，避免繁忙事件循环被误杀。

---

## 4. 排查

```bash
kubectl describe pod <POD>    # Startup/Readiness/Liveness failed
kubectl logs <POD> --previous
```

若见 `KeyboardInterrupt: terminated` 且 Events 有 Startup 失败 → 多半是窗口不够，先测真实启动再提高 `failureThreshold`。

区分：固定阶段被杀 → 加 Startup；CUDA OOM / NCCL / 驱动错误 → 修模型与环境，单加探针无用。

勿用完整 Chat Completion 当探针（耗 GPU、占 KV、污染指标）。

---

## 5. 验收实验

正常/冷启动/缓存启动；模拟健康失败与高并发；删 Pod、Drain。记录 Startup 首次成功、Ready 摘流、Live 重启次数与业务错误率。

---

## 6. 本篇总结

```text
Startup 保护慢启动 → Readiness 控流量 → Liveness 只处理不可恢复故障
先测真实启动时间 → 配 Startup → Readiness → 再谨慎配 Liveness
```

下一篇：[滚动升级与优雅退出](./27-大模型推理服务滚动升级与优雅退出.md)。

---

## 参考与致谢

- [Configure Liveness, Readiness and Startup Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [Using Kubernetes - vLLM](https://docs.vllm.ai/en/latest/deployment/k8s/)

本文按 Kubernetes 探针与 vLLM K8s 文档整理，并按本系列做了交叉链接。
