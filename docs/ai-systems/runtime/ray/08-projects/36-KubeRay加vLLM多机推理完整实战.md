---
title: "KubeRay + vLLM 多机推理完整实战"
sidebar_label: "36. KubeRay + vLLM 多机推理"
sidebar_position: 36
description: "用 RayService、Ray Serve LLM 和 vLLM 在 Kubernetes 上部署两节点八卡 TP/PP 服务，并完成灰度、监控和故障验收。"
tags: [KubeRay, RayService, Ray Serve LLM, vLLM, 多机推理]
---

# KubeRay + vLLM 多机推理完整实战

目标拓扑：两台同构节点，每台 4 张 NVIDIA GPU，一个模型副本使用 `TP=4, PP=2`。生产高可用再复制一套引擎，至少需要
16 张 GPU，并确保两个副本不落在同一故障域。

## 1. 前置验收

- KubeRay Operator 与 CRD 已按固定版本安装；
- GPU Operator/设备插件正常，Pod 可申请 `nvidia.com/gpu`；
- 两节点驱动、CUDA/NCCL、Ray、vLLM 和镜像一致；
- 节点间 NCCL tests 达标；
- 模型制品固定 Revision/哈希且两个节点可读取；
- Gateway、日志、Prometheus/Grafana 和 Secret 注入就绪。

先阅读[Ray 与 vLLM 多机多卡 TP/PP 部署](../06-llm-serving/26-Ray与vLLM多机多卡TP-PP部署.md)和
[Kubernetes 部署 vLLM 推理服务](../../../inference/serving/01-Kubernetes%20部署%20vLLM%20推理服务.md)。

## 2. Serve 配置

```yaml title="serve-config.yaml"
applications:
  - name: llm
    route_prefix: /
    import_path: ray.serve.llm:build_openai_app
    args:
      llm_configs:
        - model_loading_config:
            model_id: production-model
            model_source: /models/production-model
          accelerator_type: H100
          deployment_config:
            num_replicas: 1
            max_ongoing_requests: 64
          engine_kwargs:
            tensor_parallel_size: 4
            pipeline_parallel_size: 2
            max_model_len: 16384
            gpu_memory_utilization: 0.88
            enable_chunked_prefill: true
```

`accelerator_type` 必须与 Ray 节点实际资源标签一致；否则即使 GPU 空闲也会 Pending。

## 3. RayService 骨架

```yaml title="rayservice.yaml"
apiVersion: ray.io/v1
kind: RayService
metadata:
  name: llm-prod
  namespace: ray-system
spec:
  serveConfigV2: |
    applications:
      - name: llm
        route_prefix: /
        import_path: ray.serve.llm:build_openai_app
        args:
          llm_configs:
            - model_loading_config:
                model_id: production-model
                model_source: /models/production-model
              accelerator_type: H100
              deployment_config:
                num_replicas: 1
              engine_kwargs:
                tensor_parallel_size: 4
                pipeline_parallel_size: 2
                max_model_len: 16384
                gpu_memory_utilization: 0.88
  rayClusterConfig:
    rayVersion: "<LOCKED_RAY_VERSION>"
    headGroupSpec:
      rayStartParams:
        num-cpus: "0"
        dashboard-host: "0.0.0.0"
      template:
        spec:
          containers:
            - name: ray-head
              image: registry.example.com/ray-vllm@sha256:<DIGEST>
              resources:
                requests: {cpu: "2", memory: 8Gi}
                limits: {cpu: "4", memory: 16Gi}
    workerGroupSpecs:
      - groupName: h100-workers
        replicas: 2
        minReplicas: 2
        maxReplicas: 2
        rayStartParams:
          resources: '"{\"accelerator_type:H100\": 1}"'
        template:
          spec:
            nodeSelector:
              accelerator: h100-80g
            containers:
              - name: ray-worker
                image: registry.example.com/ray-vllm@sha256:<DIGEST>
                resources:
                  requests:
                    cpu: "16"
                    memory: 128Gi
                    nvidia.com/gpu: "4"
                  limits:
                    cpu: "16"
                    memory: 128Gi
                    nvidia.com/gpu: "4"
                volumeMounts:
                  - {name: models, mountPath: /models, readOnly: true}
                  - {name: shm, mountPath: /dev/shm}
            volumes:
              - name: models
                persistentVolumeClaim: {claimName: llm-models}
              - name: shm
                emptyDir: {medium: Memory, sizeLimit: 64Gi}
```

这是结构骨架，不是可直接复制的生产清单。必须用目标版本 CRD schema 校验 `rayStartParams`、资源标签和 Serve LLM 字段。

## 4. 部署

```bash
kubectl apply --server-side --dry-run=server -f rayservice.yaml
kubectl apply -f rayservice.yaml
kubectl -n ray-system get rayservice,pods -w
kubectl -n ray-system describe rayservice llm-prod
```

确认 RayService 状态、RayCluster、2 个 GPU Worker、Serve Application 和 LLM Deployment 全部 Ready。

## 5. 验证内部接口

```bash
kubectl -n ray-system port-forward svc/llm-prod-serve-svc 8000:8000
curl http://127.0.0.1:8000/v1/models
curl http://127.0.0.1:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"production-model","messages":[{"role":"user","content":"返回OK"}],"max_tokens":8}'
```

生产流量通过 Gateway，不长期依赖 Port Forward。

## 6. 放置验收

```bash
kubectl -n ray-system exec -it <head-pod> -- ray list placement-groups --detail
kubectl -n ray-system exec -it <head-pod> -- ray list actors --detail
```

核对 8 个 GPU Worker rank 跨 2 个 Ray Node，每台 4 个；结合 `nvidia-smi topo -m` 和日志确认 TP 尽量保持机内。

## 7. 压测与 SLO

使用真实 Prompt/输出长度分布，逐步增加并发。记录成功率、TTFT、TPOT、Token/s、队列、HBM、GPU、网络和成本。
容量报告明确稳态并发、过载点、最大安全上下文和单节点故障后的可用能力。

## 8. 高可用与灰度

单个 8-GPU Replica 只是可运行，不是高可用。方案：

1. 集群内两个副本并跨故障域；或
2. 两个独立 RayService/集群，由 Gateway 灰度和切换。

第二种隔离更强，升级回滚更清晰，但需要更多冗余资源。新集群完成模型加载、预热和 Smoke 后再切小流量。

## 9. 故障演练

- 删除一个 LLM Replica Actor；
- 删除一个 GPU Worker Pod；
- 排空一台 Kubernetes Node；
- 模型存储变慢/只读失败；
- NCCL 网络抖动；
- 客户端中断 SSE；
- 升级到错误模型后回滚旧 RayService。

## 10. 验收清单

- [ ] CRD Dry Run 与固定版本 Schema 通过；
- [ ] 8 个 rank 放置和通信符合拓扑；
- [ ] 模型加载后 Readiness 才成功；
- [ ] 真实流量压测满足 SLO；
- [ ] 管理端口未暴露公网；
- [ ] 有第二副本或第二集群承担故障；
- [ ] 节点故障、灰度和回滚已演练。

下一篇：[NVIDIA 与昇腾双资源池 Ray 部署边界](./37-NVIDIA与昇腾双资源池Ray部署边界.md)。

## 11. 官方资料 {/* #官方资料 */}

- [Deploy Ray Serve on Kubernetes](https://docs.ray.io/en/latest/serve/production-guide/kubernetes.html)
- [Ray Serve LLM quickstart](https://docs.ray.io/en/latest/serve/llm/quick-start.html)
- [Cross-node parallelism](https://docs.ray.io/en/latest/serve/llm/user-guides/cross-node-parallelism.html)
