---
title: "Docker 与 Compose 部署 Ray 集群"
sidebar_label: "12. Docker 与 Compose 部署 Ray 集群"
sidebar_position: 12
description: "使用固定 Ray 镜像、共享内存、容器网络和 Docker Compose 搭建可重复的 Head/Worker 多节点实验集群，并理解生产边界。"
tags: [Ray, Docker, Docker Compose, 容器, 多节点, GPU]
---

# Docker 与 Compose 部署 Ray 集群

Docker 能固定 Ray、Python 和系统用户态依赖，Compose 能在一台主机模拟独立 Head/Worker 节点。它适合开发、
集成测试和故障实验，但同机多个容器共享同一内核、磁盘和物理网络，不能替代真实跨节点性能验证。

## 1. 实验拓扑

```text
宿主机
└─ Docker Network：ray-net
   ├─ ray-head
   │  ├─ GCS 6379
   │  ├─ Dashboard/Jobs 8265
   │  └─ 独立/dev/shm
   ├─ ray-worker-1
   │  └─ 独立/dev/shm
   └─ ray-worker-2
      └─ 独立/dev/shm
```

容器服务名提供内部 DNS。Worker 使用 `ray-head:6379` 加入，客户端只通过绑定到 `127.0.0.1` 的 Dashboard/Jobs
入口访问。

## 2. 镜像选择与固定

Ray 官方镜像通常区分 Ray 版本、Python 版本、CPU/GPU 变体。标签格式和可用组合随版本变化，先在官方镜像
说明中确认，再保存 Digest：

```bash
docker pull rayproject/ray:<RAY_IMAGE_TAG>
docker image inspect rayproject/ray:<RAY_IMAGE_TAG> --format '{{json .RepoDigests}}'
```

生产部署使用：

```text
rayproject/ray:<tag>@sha256:<digest>
```

不要使用 `latest`，也不要让 Head 和 Worker 使用不同 Ray/Python 镜像。

## 3. 单容器基线

```bash
docker run --rm -it \
  --shm-size=2g \
  rayproject/ray:<RAY_IMAGE_TAG> \
  python -c "import ray; ray.init(); print(ray.cluster_resources())"
```

`--shm-size` 必须显式设置。Ray Object Store 使用共享内存；Docker 默认 `/dev/shm` 往往过小。2 GiB 只是实验值，
生产容量应根据对象规模、并发和节点内存计算。

GPU 镜像还需要受控设备分配：

```bash
docker run --rm -it \
  --gpus all \
  --shm-size=8g \
  rayproject/ray:<RAY_GPU_IMAGE_TAG> \
  nvidia-smi
```

先验证容器 GPU，再启动 Ray。`--gpus all` 不适合多个容器需要隔离不同 GPU 的场景。

## 4. Compose 文件

创建 `compose.yaml`：

```yaml
services:
  ray-head:
    image: rayproject/ray:<RAY_IMAGE_TAG>@sha256:<IMAGE_DIGEST>
    command:
      - ray
      - start
      - --head
      - --port=6379
      - --dashboard-host=0.0.0.0
      - --block
    shm_size: 2gb
    ports:
      - "127.0.0.1:8265:8265"
    volumes:
      - ./app:/workspace/app:ro
      - ray-shared:/workspace/shared
    working_dir: /workspace/app
    networks:
      - ray-net
    healthcheck:
      test: ["CMD", "ray", "status", "--address=127.0.0.1:6379"]
      interval: 10s
      timeout: 5s
      retries: 12

  ray-worker:
    image: rayproject/ray:<RAY_IMAGE_TAG>@sha256:<IMAGE_DIGEST>
    command:
      - ray
      - start
      - --address=ray-head:6379
      - --block
    shm_size: 2gb
    depends_on:
      ray-head:
        condition: service_healthy
    volumes:
      - ./app:/workspace/app:ro
      - ray-shared:/workspace/shared
    working_dir: /workspace/app
    networks:
      - ray-net

networks:
  ray-net:
    driver: bridge

volumes:
  ray-shared:
```

占位符必须替换成已验证标签和 Digest。Compose/Engine 对 `depends_on.condition`、GPU 字段和资源限制的支持存在
版本差异，先执行：

```bash
docker version
docker compose version
docker compose config
```

## 5. 启动和扩展 Worker

```bash
docker compose up -d --scale ray-worker=2
docker compose ps
```

不要给可扩展的 `ray-worker` 设置固定 `container_name`，否则多个副本名称冲突。

检查 Head：

```bash
docker compose exec ray-head ray status
docker compose exec ray-head ray list nodes --format table
```

查看日志：

```bash
docker compose logs --since=10m ray-head
docker compose logs --since=10m ray-worker
```

## 6. 提交验证 Job

将上一文的 `inspect_cluster.py` 放进只读 `./app`，然后：

```bash
docker compose exec ray-head \
  ray job submit \
  --address=http://127.0.0.1:8265 \
  --working-dir /workspace/app \
  -- python inspect_cluster.py
```

也可从宿主机访问 `http://127.0.0.1:8265`，但不要把 Jobs API 映射到 `0.0.0.0` 或公网。

## 7. 容器 DNS 与 IP

Worker 应使用稳定的 Compose Service DNS `ray-head`，不要把一次性的容器 IP 写进配置。检查：

```bash
docker compose exec ray-worker getent hosts ray-head
docker compose exec ray-worker python -c "import socket; print(socket.gethostbyname('ray-head'))"
```

Ray 还需要节点间双向连接。只映射 Head 的 6379 到宿主机并不等于所有容器内部端口正确；同一 Compose Network
默认允许容器互通，真实多宿主机则必须设计完整端口矩阵。

## 8. 共享内存与容器 Memory Limit

需要同时考虑：

```text
Container Memory Limit
├─ Ray系统进程
├─ Driver/Worker Heap
├─ Object Store映射
└─ 文件缓存和本地库

/dev/shm
└─ Object Store共享内存容量
```

`shm_size` 大于容器 Memory Limit 并不会凭空增加可用物理内存。容器 OOM、Object Store Full 和宿主机内存压力
是不同故障。

验证：

```bash
docker compose exec ray-head df -h /dev/shm
docker stats
```

## 9. 三类 Volume

| 类型 | 示例 | 生命周期与用途 |
| --- | --- | --- |
| 只读代码 | `./app:/workspace/app:ro` | 开发代码；生产应进入镜像或签名制品 |
| 共享数据 | `ray-shared:/workspace/shared` | 同一宿主机实验；不是跨服务器共享存储 |
| 节点本地 Spill | 每容器独立 Volume | Object Spill、临时缓存，不能当持久结果 |

Named Volume 在一台 Docker Host 内共享，不代表多台服务器都能看到。跨宿主机需要 NFS、CephFS、对象存储或
其他明确的数据方案。

不要让多个 Ray Node 共用同一个本地 Session/Spill 目录而没有隔离子路径。

## 10. GPU Compose 边界

GPU 服务需要同时满足：

- 宿主机 NVIDIA Driver 和 Container Toolkit 可用；
- 使用匹配的 Ray GPU 镜像；
- Compose 为每个 Worker 分配明确设备；
- Ray 注册 GPU 数与容器可见数一致；
- 多 Worker 不意外共享同一 GPU；
- `/dev/shm`、IPC 和 NCCL 网络满足模型要求。

验证：

```bash
docker compose exec ray-worker nvidia-smi -L
docker compose exec ray-worker python -c "import torch; print(torch.cuda.device_count())"
docker compose exec ray-head ray status
```

Compose 的 GPU 字段随版本变化，不能只复制旧版 `deploy.resources.reservations.devices` 示例。以目标 Compose 文档
和 `docker compose config` 结果为准。

## 11. 镜像内依赖与 Runtime Env

建议分层：

```text
镜像：OS、Python、Ray、PyTorch、CUDA用户态库、大型依赖
只读应用制品：业务代码和固定配置
Runtime Env：小型、频繁变化的代码/依赖
Volume/对象存储：模型、数据、Checkpoint
Secret：短期凭证
```

不要在容器每次启动时 `pip install -U`。它会引入公网、包源漂移和冷启动故障。

## 12. 健康检查不是业务就绪

示例 Healthcheck 只说明 Head 的状态命令可用，不代表：

- 所有 Worker 已加入；
- Runtime Env 已准备；
- GPU、模型和共享存储已就绪；
- Placement Group 可以创建；
- Ray Serve 应用能接收请求。

生产就绪应由分层检查组成，不能只依赖容器 `running`。

## 13. 故障实验

停止一个 Worker：

```bash
docker compose stop ray-worker
```

重新扩展：

```bash
docker compose up -d --scale ray-worker=2
```

观察 Node、Actor、Task、Object 和 Placement Group。Compose 重建后的容器是新 Ray Node，不能假设内存对象或
本地 Spill 自动恢复。

## 14. 常见故障

| 现象 | 首要检查 |
| --- | --- |
| Worker 解析不到 Head | Compose Network、Service 名、DNS |
| Worker 连上后掉线 | 版本、内存、端口、容器日志 |
| Object Store 很小 | `shm_size`、容器内 `/dev/shm` |
| 宿主机能看 Dashboard 但 Job 失败 | Worker 代码/依赖、Volume、Runtime Env |
| 扩展 Worker 数不变 | 是否设置固定 `container_name`、Compose 配置 |
| 多容器看到相同 GPU | 设备分配过宽、`--gpus all`、可见设备 |
| 文件在 Head 存在而 Worker 不存在 | 只挂载 Head、路径或 Volume 不一致 |
| 重启后结果丢失 | 把容器层或 Object Store 当持久存储 |

## 15. 安全基线

- 镜像固定 Digest，使用非 root 用户；
- Root Filesystem 尽量只读，写目录单独挂载；
- 不使用 `--privileged` 解决普通权限问题；
- Dashboard/Jobs 只绑定回环或受控网络；
- Secret 不写入 Compose 文件和镜像；
- 限制容器出站、宿主 Socket 和云元数据访问；
- 代码与模型使用只读挂载和校验；
- 不把 Compose 实验直接当多租户生产平台。

## 16. 清理边界

停止容器：

```bash
docker compose down
```

这不会删除 Named Volume。只有确认 Volume 内没有需要保留的数据时，才考虑显式删除。模型、Checkpoint 和业务结果
不应依赖未备份的 Compose Volume。

## 17. 验收清单

- [ ] 镜像 Tag、Digest、Python 和 Ray 版本一致；
- [ ] `docker compose config` 通过；
- [ ] Head 与两个 Worker 都在 Ray Node 列表中；
- [ ] `/dev/shm` 和 Memory Limit 已核对；
- [ ] 跨容器 Task 和 Object 传输通过；
- [ ] Jobs API 仅通过本机或受控隧道访问；
- [ ] Worker 停止和重建行为符合容错设计；
- [ ] GPU/Volume/Secret 没有越权共享；
- [ ] 已记录 Compose 与真实多机环境的差异。

下一篇：[Ray 多机网络、端口、存储与安全](./13-Ray多机网络端口存储与安全.md)。

## 18. 官方资料 {/* #官方资料 */}

- [Installing Ray：Docker](https://docs.ray.io/en/latest/ray-overview/installation.html#launch-ray-in-docker)
- [Ray Docker Images](https://docs.ray.io/en/latest/ray-overview/installation.html#docker-source-images)
- [Testing Autoscaling Locally](https://docs.ray.io/en/latest/ray-contribute/fake-autoscaler.html)
- [Ray Security](https://docs.ray.io/en/latest/ray-security/index.html)
