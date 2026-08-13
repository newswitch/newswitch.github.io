---
title: kubectl logs、exec、debug、cp 与 port-forward：Pod 调试和取证
sidebar_position: 4
description: 系统使用 kubectl logs、exec、attach、debug、cp、port-forward 和 proxy，处理多容器、崩溃实例、临时容器与节点调试。
tags: [Kubernetes, kubectl, logs, exec, debug, Pod 排障]
---

# kubectl Pod 调试与现场取证

Pod 调试的核心是保持对象身份与时间线：Pod 名可能复用，容器会重启，日志会轮转。先记录 namespace、Pod UID、Node、容器名、restartCount、current/last state，再进入现场。

## 1. logs：当前与前一实例 `[R]`

```bash
kubectl logs pod/inference -n ai-prod -c server --timestamps
kubectl logs pod/inference -n ai-prod -c server --previous --timestamps
kubectl logs pod/inference -n ai-prod -c server --since=30m --tail=500
kubectl logs -n ai-prod -l app=inference --all-containers --prefix --max-log-requests=10
kubectl logs -f pod/inference -n ai-prod -c server
```

常用参数：`-c/--container`、`-f/--follow`、`-p/--previous`、`--since`、`--since-time`、`--tail`、`--limit-bytes`、`--timestamps`、`--all-containers`、`--prefix`、`--max-log-requests`、`--pod-running-timeout`。日志来自 kubelet/CRI 日志，不等于应用全部日志；应用写文件、日志轮转或节点失联时可能取不到。

## 2. exec 与 attach `[A]`

```bash
kubectl exec -it pod/inference -n ai-prod -c server -- sh
kubectl exec pod/inference -n ai-prod -c server -- cat /proc/1/status
kubectl attach pod/inference -n ai-prod -c server -it
```

`--` 分隔 kubectl 参数和容器命令。`exec` 启动新进程，`attach` 连接已有主进程的标准流。不要默认容器有 Bash、curl 或包管理器；也不要在线安装工具污染不可变镜像。

## 3. debug：临时容器、复制 Pod 与节点

```bash
kubectl debug pod/inference -n ai-prod -it \
  --image=registry.example/debug/netshoot@sha256:... \
  --target=server --profile=general

kubectl debug pod/inference -n ai-prod --copy-to=inference-debug \
  --container=server -- sh

kubectl debug node/gpu-01 -it \
  --image=registry.example/debug/node-tools@sha256:... \
  --profile=sysadmin
```

临时容器通常不能删除或修改已加入实例，是否能看目标进程取决于 Runtime 支持和进程 Namespace。节点调试会创建特权程度较高的 Pod，并把 Host 根目录挂到特定路径；`--profile=sysadmin` 权限很高，只在审批后使用。固定镜像 Digest 并审查工具镜像供应链。

## 4. cp：通过 tar 传输 `[R/W]`

```bash
kubectl cp ai-prod/inference:/tmp/report.txt ./evidence/report.txt -c server
kubectl cp ./config.yaml ai-prod/inference:/tmp/config.yaml -c server
```

`kubectl cp` 依赖容器内 `tar`，符号链接、权限、特殊文件和大目录存在安全/兼容边界。复制证据优先单个只读文件并校验哈希；向业务容器写文件会改变现场，正式配置应走镜像、ConfigMap/Secret 或交付系统。

## 5. port-forward 与 proxy `[A]`

```bash
kubectl port-forward -n ai-prod pod/inference 18080:8080 --address=127.0.0.1
kubectl port-forward -n ai-prod service/inference 18080:80
kubectl proxy --port=8001 --address=127.0.0.1 --accept-hosts='^localhost$'
```

Port Forward 是调试隧道，不是生产入口；连接中断时不会自动形成高可用。默认只绑定 Loopback，扩大 `--address` 会把内部服务暴露到其他网络。`kubectl proxy` 使用当前凭证代理 API，同样只应绑定本机。

## 6. 取证顺序

```bash
kubectl get pod inference -n ai-prod -o json > pod.json
kubectl describe pod inference -n ai-prod > pod.describe.txt
kubectl logs inference -n ai-prod -c server --timestamps > current.log
kubectl logs inference -n ai-prod -c server --previous --timestamps > previous.log
kubectl events -n ai-prod --for pod/inference > events.txt
```

输出可能含敏感信息，存入访问受控目录。重启、删除、`exec` 修改、复制文件之前先采集。

## 7. 常见失败

| 现象 | 排查 |
|---|---|
| logs 指定错误容器 | 查看 `spec.containers/initContainers/ephemeralContainers` |
| previous 不存在 | 容器尚未重启、日志已轮转或 Runtime 已清理 |
| exec 报容器不存在 | 使用 Container Name，不是镜像名；确认当前实例状态 |
| debug 看不到进程 | Runtime/Process Namespace、`--target` 支持和安全策略 |
| cp 报 tar not found | 用 exec + 受控编码/流式方式，或调试容器读取共享卷 |
| port-forward 断开 | Pod 重建、目标端口未监听、API/kubelet 隧道中断 |

## 8. 掌握标准

能取到当前和上一实例日志；能解释 exec/attach/debug 的进程和权限差异；能在不修改业务镜像的情况下使用临时容器；能证明调试操作的身份、时间、目标 UID 和影响。

## 官方参考

- [kubectl logs](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_logs/)
- [kubectl exec](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_exec/)
- [Debug Running Pods](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/)
- [kubectl port-forward](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_port-forward/)
