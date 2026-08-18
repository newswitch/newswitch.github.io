---
title: "Lite、Compose Standalone、Helm/K8s Distributed 多种部署"
sidebar_label: "10. Lite、Compose Standalone、Helm/K8s Distributed 多种部署"
sidebar_position: 10
description: "提供 Milvus 从本地 Lite 到 Standalone 和 Distributed 的可复现交付、验收与迁移流程。"
tags: [Milvus, 部署, Docker Compose, Helm, Kubernetes]
---

# Lite、Compose Standalone、Helm/K8s Distributed 多种部署

[前文](./02-Milvus-Lite-Standalone-Distributed与一次请求路径.md)解释架构，本篇聚焦交付闭环。

## 1. Lite {/* #lite */}

固定 Python/`pymilvus`/Embedding 版本，数据库文件放受控目录，执行 create→insert→search→reopen。备份文件前关闭写入，并验证恢复；Lite 结果不用于证明分布式性能。

## 2. Standalone Compose {/* #standalone-compose */}

下载目标 release 配套 Compose，而非复制旧教程：

```text
pin all image tags/digests
→ inspect services and volumes
→ configure auth/network/object paths
→ start dependencies then Milvus
→ create/index/load/search
→ restart and restore test
```

保存 `docker compose config` 渲染结果。不要只备份 Milvus 容器 Volume，需覆盖 metadata、WAL 和 object storage。

## 3. Distributed Helm {/* #distributed-helm */}

```bash
helm show values zilliztech/milvus --version <chart-version>
helm template milvus zilliztech/milvus \
  --version <chart-version> -f values-prod.yaml > rendered.yaml
```

检查 CR/StatefulSet、PVC、镜像、依赖、RBAC、Service、Secret 和 SecurityContext 后再安装。显式设置组件副本/资源、反亲和、PDB、StorageClass、对象存储、etcd/WAL、认证/TLS和监控。

## 4. 验收门 {/* #验收门 */}

1. 所有版本/digest 与依赖矩阵归档；
2. 写入固定数据，索引/加载/搜索正确；
3. Recall/P99 基线；
4. 故障 Proxy/Query/Data/依赖单节点；
5. 备份恢复到新 Namespace/集群；
6. 升级 canary 和回滚；
7. 从 Lite/Standalone 迁移用导出/回填/校验，不复制内部文件。

## 5. 从实验到生产的验收门 {/* #从实验到生产的验收门 */}

Lite 用于 API/数据建模实验，Compose 用于组件认知，Helm/Kubernetes 才进入分布式运维讨论；三种结果不能互相证明性能和高可用。所有镜像、Chart、SDK 固定到兼容版本，Milvus 3.0 还要按官方拓扑部署 Woodpecker 和 Storage V3 所需依赖。

```bash
kubectl get pod,pvc -n milvus -o wide
kubectl get events -n milvus --sort-by=.lastTimestamp
helm get values <release> -n milvus
```

生产验收包括：节点/可用区反亲和、PDB、requests/limits、对象存储与 etcd TLS、Secret 轮换、PVC/本地盘边界、监控、备份恢复、单节点/单区故障和滚动升级。执行 create→insert→index→load→search→restart→search，并对账数量与 Recall；只看到 Pod Running 不算部署完成。

## 6. 验收题 {/* #验收题 */}

- 为什么 Compose 文件必须与 release 配套？
- Helm install 成功后还需哪些数据验收？
- Lite 文件为什么不能直接挂到 Distributed？
- Milvus 备份为何要协调三类状态？

## 7. 参考资料 {/* #参考资料 */}

- [Install overview](https://milvus.io/docs/install-overview.md)
- [Helm install](https://milvus.io/docs/install_cluster-helm.md)
