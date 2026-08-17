---
title: "Lite、Compose Standalone、Helm/K8s Distributed 多种部署"
sidebar_position: 10
tags: [Milvus, 部署, Docker Compose, Helm, Kubernetes]
description: "提供 Milvus 从本地 Lite 到 Standalone 和 Distributed 的可复现交付、验收与迁移流程。"
---

# Lite、Compose Standalone、Helm/K8s Distributed 多种部署

[前文](./02-Milvus-Lite-Standalone-Distributed与一次请求路径.md)解释架构，本篇聚焦交付闭环。

## Lite

固定 Python/`pymilvus`/Embedding 版本，数据库文件放受控目录，执行 create→insert→search→reopen。备份文件前关闭写入，并验证恢复；Lite 结果不用于证明分布式性能。

## Standalone Compose

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

## Distributed Helm

```bash
helm show values zilliztech/milvus --version <chart-version>
helm template milvus zilliztech/milvus \
  --version <chart-version> -f values-prod.yaml > rendered.yaml
```

检查 CR/StatefulSet、PVC、镜像、依赖、RBAC、Service、Secret 和 SecurityContext 后再安装。显式设置组件副本/资源、反亲和、PDB、StorageClass、对象存储、etcd/WAL、认证/TLS和监控。

## 验收门

1. 所有版本/digest 与依赖矩阵归档；
2. 写入固定数据，索引/加载/搜索正确；
3. Recall/P99 基线；
4. 故障 Proxy/Query/Data/依赖单节点；
5. 备份恢复到新 Namespace/集群；
6. 升级 canary 和回滚；
7. 从 Lite/Standalone 迁移用导出/回填/校验，不复制内部文件。

## 验收题

- 为什么 Compose 文件必须与 release 配套？
- Helm install 成功后还需哪些数据验收？
- Lite 文件为什么不能直接挂到 Distributed？
- Milvus 备份为何要协调三类状态？

## 参考资料

- [Install overview](https://milvus.io/docs/install-overview.md)
- [Helm install](https://milvus.io/docs/install_cluster-helm.md)
