---
title: GPU Pod 启动但服务无法响应的排查
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["Kubernetes", "vLLM", "Service", "排障", "学习路线"]
---

# GPU Pod 启动但服务无法响应的排查

> 占位符（`NS`/`POD`/服务地址等）请换成自己的真实数据。前置：[探针](./26-大模型服务%20Kubernetes%20探针设计.md)、[六层排障](./43-GPU%20集群六层排障模型.md)。

`Running` 只表示容器已启动，不代表模型能处理请求。常见：READY=0/1、超时、拒绝连接、503。链路：

```text
模型进程 → 监听端口 → Pod IP → Readiness → Service → EndpointSlice
→ DNS → NetworkPolicy → Ingress/网关 → 客户端
```

**从内向外排查**，不要一上来改 Ingress。

---

## 1. 流程概览

```text
容器内 127.0.0.1 → Pod IP → Service ClusterIP → EndpointSlice
→ DNS → NetworkPolicy → Ingress/Gateway → 容量/超时
```

---

## 2. Pod Condition 与日志

```bash
kubectl get pod "$POD" -n "$NS" -o wide   # READY / RESTARTS / IP
kubectl get pod "$POD" -n "$NS" -o json | jq '.status.conditions'
kubectl describe pod "$POD" -n "$NS" | sed -n '/Events:/,$p'
kubectl logs "$POD" -n "$NS" --timestamps --tail=500
# grep: error|oom|cuda|nccl|timeout|listen|started|health
```

`Running` 但 `READY=0/1` → 不会进常规 Service 后端。

---

## 3. 进程、端口、容器内访问

```bash
kubectl exec -it "$POD" -n "$NS" -- bash
ps -ef | grep -E '[v]llm|api_server'
ps -p 1 -o pid,ppid,cmd          # 应为 vllm serve ...
ss -lntp                         # 期望 0.0.0.0:8000，勿仅 127.0.0.1
tr '\0' ' ' < /proc/1/cmdline

curl -v --max-time 10 http://127.0.0.1:8000/health
curl -v http://127.0.0.1:8000/v1/models
curl -s http://127.0.0.1:8000/metrics | head
```

| 结果 | 方向 |
|------|------|
| 容器内拒连 | 进程未起或未监听 |
| 容器内 OK、Pod IP 不通 | 监听地址 / CNI / NetworkPolicy |
| 健康 OK、推理超时 | GPU / KV / 排队 / 参数 |

GPU：`nvidia-smi`、compute-apps、`torch.cuda.is_available()`。metrics 关注 `num_requests_running/waiting`、`kv_cache_usage_perc`、排队与 E2E 延迟。

---

## 4. Pod IP → Service → EndpointSlice → DNS

调试 Pod 访问 `http://${POD_IP}:8000/health`。核对 Service `selector` 与 Pod label、`port`/`targetPort`（真正转发靠 **targetPort**）。

```bash
kubectl get endpointslice -n "$NS" -l kubernetes.io/service-name="$SVC" -o wide
# 空 Endpoint → Selector/Label/Readiness/无 Selector
nslookup "${SVC}.${NS}.svc.cluster.local"
```

Pod IP 通、Service 不通 → Service/EndpointSlice/kube-proxy/CNI；Service 通、域名不通 → CoreDNS。

---

## 5. NetworkPolicy 与 Ingress/网关

查是否默认拒绝 Ingress、调用方 NS/端口/Selector。流式请求须覆盖合理的 `proxy_read_timeout` / upstream / idle timeout。

| 现象 | 重点 |
|------|------|
| Connection refused | 进程/端口 |
| timed out | 网络/策略 |
| 503 | 无可用后端或网关上游 |
| 健康正常、推理超时 | GPU/KV/排队 |

---

## 6. 本篇总结

```text
Condition → 日志 → 进程 → 端口 → 容器内 → GPU/模型
→ Pod IP → Service → EndpointSlice → DNS → Policy → 网关 → 容量
```

下一篇排障后可接治理：[升级与变更管理](./55-GPU%20集群升级与变更管理.md)。

---

## 参考与致谢

- [Debug Services | Kubernetes](https://kubernetes.io/docs/tasks/debug/debug-application/debug-service/)
- [Configure Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [vLLM Production Metrics](https://docs.vllm.ai/en/stable/usage/metrics/)

本文按官方 Service/探针与 vLLM 指标文档整理，并按本系列交叉链接。
