---
title: "模型、镜像、Runtime 与依赖跨集群分发"
sidebar_label: "08. 模型与 Runtime 分发"
sidebar_position: 8
description: "以不可变发布清单将模型、镜像、Tokenizer、Runtime 和兼容矩阵一致地分发到多个集群。"
tags: [模型分发, OCI, Runtime, 多集群, 供应链]
---

# 模型、镜像、Runtime 与依赖跨集群分发

## 1. 发布单元

```yaml
release:
  modelRevision: "immutable-revision"
  modelManifestDigest: "sha256:..."
  imageDigest: "sha256:..."
  tokenizerDigest: "sha256:..."
  runtimeConfigRevision: "git-sha"
  hardwareProfiles: ["gpu-profile-a", "npu-profile-b"]
```

这是概念示例。真正 Schema 应版本化，并记录框架、量化、并行和 Driver/Runtime 兼容范围。

## 2. Pull 与 Replication

- 各集群按需 Pull：简单但冷启动依赖跨区域网络；
- Registry/Object Store 主动复制：启动快但占用存储且有复制延迟；
- 节点预热：最快但需要缓存容量和调度协同；
- P2P/分层分发：降低中心出口但增加一致性和安全复杂度。

## 3. 一致性

全局声明发布某版本，不代表所有集群已经具备。每个成员报告：Manifest 已验证、镜像已拉取、模型对象完整、Runtime 已安装、硬件基线兼容。只有 Ready Cluster 才接收流量或训练任务。

## 4. 带宽与并发

大模型跨区域复制需要计算：对象总量、压缩/量化、链路可用带宽、复制窗口、并发和出口费用。使用 Chunk/Multipart、断点续传、Checksum 和限速。失败只重传缺失 Chunk。

## 5. Runtime 演进

KServe ServingRuntime、Kubeflow TrainingRuntime、Slurm 容器基线等都可能演进。按版本创建新 Runtime，先在目标硬件 Canary 验证；不要原地修改导致不同集群同名 Runtime 语义不一致。

## 6. 回滚

回滚需要保留旧镜像、模型和配置，并确保旧版本仍兼容当前 Driver/固件。回滚的是完整发布单元，不是只切换模型路径。

## 7. 安全

每个集群独立验证签名、Provenance 和 Hash；复制服务使用最小权限，只能从批准源读取并向指定前缀写入。Cache 不能因分发方便而变成跨租户可读 HostPath。

## 8. 指标

Distribution Lag、Bytes、Cache Hit、Checksum Failure、目标集群 Ready 比例、首次加载时间和回源错误。将这些指标与扩容/切流决策关联。

参考：[OCI Distribution Specification](https://github.com/opencontainers/distribution-spec)、[ORAS Documentation](https://oras.land/docs/)、[Sigstore](https://docs.sigstore.dev/)。
