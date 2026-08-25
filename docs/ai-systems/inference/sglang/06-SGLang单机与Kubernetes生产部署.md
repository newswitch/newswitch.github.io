---
title: "SGLang 单机与 Kubernetes 生产部署"
sidebar_label: "06. 单机与 Kubernetes 生产部署"
sidebar_position: 6
description: "从单机正确性基线到Kubernetes资源、共享内存、探针、优雅退出、网关和发布验收部署SGLang。"
tags: [SGLang, Kubernetes, 部署, CUDA, 生产]
---

# SGLang 单机与 Kubernetes 生产部署

SGLang生产部署必须同时处理模型进程、Tokenizer/Scheduler/Detokenizer进程、GPU资源、共享内存、ZMQ/IPC、模型存储和HTTP流式连接。

## 1. 先做单机基线

```bash
python -m sglang.launch_server \
  --model-path /models/qwen \
  --host 127.0.0.1 \
  --port 30000 \
  --tp 1 \
  --mem-fraction-static 0.80
```

示例值不是生产推荐。先验证：

- 模型与Tokenizer加载；
- Native/OpenAI兼容接口；
- 流式结束和取消；
- Chat Template与停止条件；
- Eager/Graph基线；
- 单请求TTFT/TPOT；
- 正确退出并释放GPU。

## 2. 不可变坐标

```text
GPU型号/驱动/CUDA
SGLang/PyTorch及Kernel依赖
容器镜像Digest
模型/Tokenizer/Chat Template Revision
量化格式
完整Server Args或YAML摘要
```

Backend和默认值变化快，生产应归档目标镜像内：

```bash
python -m sglang.launch_server --help > launch-server-help.txt
python -m pip freeze > pip-freeze.txt
```

## 3. Kubernetes GPU资源

示意：

```yaml
resources:
  limits:
    nvidia.com/gpu: "2"
```

TP数必须与容器实际分配GPU数一致。还要确认：

- NVIDIA Device Plugin；
- GPU UUID和容器逻辑ID映射；
- `/dev/shm`容量；
- NCCL网络和共享内存；
- 节点GPU/NVLink/NUMA拓扑；
- 模型卷与本地缓存。

## 4. 共享内存

SGLang多进程和通信依赖共享内存。容器默认`/dev/shm`过小可能导致启动失败、NCCL错误或运行不稳定。

Kubernetes可挂载内存型`emptyDir`：

```yaml
volumes:
  - name: dshm
    emptyDir:
      medium: Memory
      sizeLimit: 8Gi
volumeMounts:
  - name: dshm
    mountPath: /dev/shm
```

大小应按目标模型、TP和压力测试确认，并计入节点内存容量。

## 5. 模型存储与冷启动

```text
对象/共享存储
→ 下载或挂载
→ SHA256验证
→ 节点本地只读缓存
→ 各TP Rank加载
→ CUDA Graph Capture
→ Ready
```

Startup时间应拆成下载、权重读取、反序列化、H2D、编译/捕获和Warmup。只优化PVC吞吐可能不改变主要瓶颈。

## 6. 探针

- Startup：允许权重加载和Graph Capture完成；
- Readiness：能够完成真实轻量生成才接流量；
- Liveness：只识别不可恢复卡死，避免高负载误杀；
- 外部Synthetic：周期验证首Token和完整流式结束。

`/health`返回200不一定代表模型Worker可执行，Readiness应按目标版本健康语义设计。

## 7. 优雅退出

```text
Pod收到TERM
→ Readiness失败/网关摘流
→ 停止接收新请求
→ 完成或取消在途流式请求
→ 释放Scheduler/KV/进程组
→ 进程退出
```

`terminationGracePeriodSeconds`必须覆盖最长允许请求或明确的强制取消策略。代理的Connection Draining也要同步。

## 8. 网关与准入

引擎不应直接承受无限请求：

- 按模型和租户限流；
- 以Token而不是只按请求计费/准入；
- 限制上下文和最大输出；
- Queue设上限，过载快速拒绝；
- 路由考虑Radix Cache亲和；
- 失败副本立即摘流；
- 流式代理关闭不必要Buffer。

## 9. 安全

- 不对公网暴露管理与指标端口；
- API鉴权与TLS放在网关或明确责任层；
- `trust_remote_code`只对审计制品开启；
- 模型卷只读；
- Prompt日志脱敏和采样；
- 动态LoRA、Profile等管理接口必须鉴权；
- 容器不使用不必要特权。

## 10. 发布策略

```text
离线接口/精度/性能验收
→ 新Revision独立Deployment
→ 模型预热与Graph Capture
→ Shadow
→ 小流量Canary
→ 逐步扩大
→ 旧RevisionDrain
```

新旧版本必须按Revision分别监控TTFT、TPOT、错误、Cache、GPU和输出一致性。

## 11. 生产验收

```text
[ ] 镜像/模型/参数均可反查
[ ] GPU数量、TP和拓扑一致
[ ] /dev/shm容量经过压力验证
[ ] 流式、停止、取消和错误契约通过
[ ] Startup/Readiness/Liveness职责清晰
[ ] 冷启动和扩容Ready时间可接受
[ ] Radix Cache冷/热行为已测
[ ] 优雅退出不截断正常请求
[ ] 单Pod/单Node故障有N-1容量
[ ] 回滚使用旧Digest和旧参数
```

## 12. 官方资料

- [SGLang Server Arguments](https://docs.sglang.io/advanced_features/server_arguments.html)
- [SGLang Docker镜像](https://docs.sglang.io/start/install.html)
- [SGLang Kubernetes示例](https://github.com/sgl-project/sglang/tree/main/examples)
