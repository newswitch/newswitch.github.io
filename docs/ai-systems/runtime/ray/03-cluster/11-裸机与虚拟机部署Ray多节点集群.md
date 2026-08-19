---
title: "裸机与虚拟机部署 Ray 多节点集群"
sidebar_label: "11. 裸机与虚拟机部署 Ray 多节点集群"
sidebar_position: 11
description: "在 Linux 裸机或虚拟机上规划、安装、启动和验收 Ray Head/Worker 多节点集群，并建立服务托管、作业提交和故障排查基线。"
tags: [Ray, 裸机, 虚拟机, 多节点, Head, Worker, 部署]
---

# 裸机与虚拟机部署 Ray 多节点集群

本文用两台 Linux 主机搭建最小 Ray 集群：一台 Head、一台 Worker。手工部署适合理解进程、地址、端口和资源
注册，也适合受控的本地机房实验；需要弹性、声明式升级和自动恢复时，应继续使用 Cluster Launcher 或 KubeRay。

```text
Client / Job Submitter
          │
          ▼
Head：10.20.0.10
├─ GCS / Dashboard / Jobs API
├─ Raylet / Object Store
└─ 可选业务Worker
          │ 双向通信
          ▼
Worker：10.20.0.11
├─ Raylet / Object Store
└─ Task / Actor Worker进程
```

## 1. 实验目标与边界

完成后应能：

- 在所有节点安装完全一致的 Ray/Python 环境；
- 让 Worker 通过可达的私网地址加入 Head；
- 从 Ray Node 映射到主机、PID、逻辑资源和日志；
- 通过 Jobs API 提交任务，而不是长期依赖交互式 SSH；
- 使用 systemd 或其他服务管理器托管 Ray 进程；
- 完成节点退出、重连和资源不足实验。

本实验不提供公网多租户能力。Ray 集群应只运行可信代码并位于受控网络。

## 2. 部署前资产表

| 项目 | Head | Worker 1 |
| --- | --- | --- |
| 主机名 | `ray-head-01` | `ray-worker-01` |
| 管理/业务私网 IP | `10.20.0.10` | `10.20.0.11` |
| OS/架构 | 记录真实值 | 必须兼容 |
| Python | 固定小版本 | 与 Head 一致 |
| Ray | 固定版本 | 与 Head 一致 |
| CPU/内存 | 记录物理与可分配量 | 记录物理与可分配量 |
| GPU | 可选 | 型号、数量、UUID、拓扑 |
| 本地盘 | 日志、临时、Spill | 日志、临时、Spill |
| 共享存储 | 可选模型/数据路径 | 路径和内容一致 |

示例地址只能用于理解，实际环境要使用受控私网。不要把管理网、公网、存储网和高速数据网混成一个未记录的地址。

## 3. 所有节点的前置检查

```bash
hostname -f
ip -br address
ip route
timedatectl status
python3 --version
df -h /dev/shm /tmp
ulimit -n
```

GPU 节点再检查：

```bash
nvidia-smi
nvidia-smi topo -m
```

要求：

- 主机名唯一，正反向解析行为可解释；
- 节点间路由对称，防火墙按最小范围放通；
- 时间同步；
- `/dev/shm`、临时盘和 Spill 目录容量明确；
- 文件描述符、进程数和锁页等限制经过容量评估；
- GPU 驱动、CUDA、PyTorch 和 Ray 镜像/环境兼容；
- 不存在遗留 Ray 进程占用旧端口。

## 4. 创建专用用户和目录

生产主机不应长期以 root 运行应用。以下目录仅为示意：

```text
/opt/ray/venv        Python环境
/opt/ray/app         应用代码或只读制品
/var/lib/ray         本地状态、临时或Spill根目录
/var/log/ray         归档日志目录（若单独采集）
/etc/ray             非敏感配置
```

目录所有者、权限、磁盘配额和清理策略必须明确。模型和数据应使用只读挂载或受控发布，不要依赖 SCP 后“文件名相同”。

## 5. 安装固定环境

在每个节点执行等价流程：

```bash
python3 -m venv /opt/ray/venv
source /opt/ray/venv/bin/activate
python -m pip install --upgrade pip
python -m pip install "ray[default]==<RAY_VERSION>"
python -m pip check
ray --version
```

生产环境应从锁定的内部包源或预构建镜像安装，并保存完整 Hash。先对比：

```bash
/opt/ray/venv/bin/python --version
/opt/ray/venv/bin/python -m pip freeze
/opt/ray/venv/bin/ray --version
```

Python 小版本、Ray 版本和关键依赖不一致时停止部署，不要期待节点加入后自行兼容。

## 6. 选择 Head 地址

Head 必须使用所有 Worker 都能访问、不会在进程生命周期内漂移的地址。多网卡服务器显式指定：

```bash
/opt/ray/venv/bin/ray start \
  --head \
  --node-ip-address=10.20.0.10 \
  --port=6379 \
  --dashboard-host=127.0.0.1
```

启动输出会给出 Worker 加入地址。记录实际地址，不要只凭默认端口猜测。若 6379 被占用且未显式指定，目标版本
可能选择其他端口。

Dashboard 仅绑定回环地址，可通过 SSH Tunnel 临时访问：

```bash
ssh -L 8265:127.0.0.1:8265 <user>@10.20.0.10
```

不要把 Dashboard 直接暴露到公网。

## 7. 启动 Worker

在 Worker 1 执行：

```bash
/opt/ray/venv/bin/ray start \
  --address=10.20.0.10:6379 \
  --node-ip-address=10.20.0.11
```

如需覆盖自动检测资源：

```bash
/opt/ray/venv/bin/ray start \
  --address=10.20.0.10:6379 \
  --node-ip-address=10.20.0.11 \
  --num-cpus=16 \
  --num-gpus=2 \
  --resources='{"worker_pool_a": 1}'
```

覆盖值是 Ray 逻辑资源，不会改变物理 CPU、容器 Limit 或真实 GPU。注册前必须核对可见设备。

## 8. 验证集群成员

在 Head 执行：

```bash
/opt/ray/venv/bin/ray status
/opt/ray/venv/bin/ray list nodes --format table
```

验证点：

- 两个 Node 都是 Alive；
- IP 与资产表一致；
- CPU/GPU/自定义资源数量正确；
- 无意外的旧 Node；
- Dashboard 与 State CLI 能读取状态；
- Head 与 Worker 日志没有版本、端口或心跳错误。

## 9. 提交跨节点验证程序

```python
import os
import socket

import ray

ray.init(address="auto")

@ray.remote(num_cpus=1, scheduling_strategy="SPREAD")
def inspect(index: int) -> dict:
    context = ray.get_runtime_context()
    return {
        "index": index,
        "host": socket.gethostname(),
        "pid": os.getpid(),
        "node_id": context.get_node_id(),
        "visible_gpu": os.environ.get("CUDA_VISIBLE_DEVICES"),
    }

refs = [inspect.remote(index) for index in range(16)]
for result in ray.get(refs):
    print(result)
```

`SPREAD` 是尽力分散，不能保证每个 Task 位于不同节点。验证结果应结合 Node 资源和实际调度状态解释。

## 10. 通过 Jobs API 提交

在 Head 本机或 SSH Tunnel 后：

```bash
ray job submit \
  --address=http://127.0.0.1:8265 \
  --working-dir . \
  -- python inspect_cluster.py
```

查看：

```bash
ray job list --address=http://127.0.0.1:8265
ray job status <submission-id> --address=http://127.0.0.1:8265
ray job logs <submission-id> --address=http://127.0.0.1:8265
```

Jobs API 地址与 GCS 地址用途不同：`http://...:8265` 是 Dashboard/Jobs 服务，`10.20.0.10:6379` 是集群内部
地址。不要混用。

## 11. 使用 systemd 托管

手工启动只适合实验。以下 Head Unit 是骨架，部署前必须调整用户、路径、地址、端口和限制：

```ini
[Unit]
Description=Ray Head
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ray
Group=ray
EnvironmentFile=/etc/ray/ray-head.env
ExecStart=/opt/ray/venv/bin/ray start --head --block --node-ip-address=${RAY_NODE_IP} --port=${RAY_GCS_PORT} --dashboard-host=127.0.0.1
ExecStop=/opt/ray/venv/bin/ray stop
Restart=on-failure
RestartSec=10
LimitNOFILE=1048576
TimeoutStopSec=60

[Install]
WantedBy=multi-user.target
```

Worker 骨架：

```ini
[Unit]
Description=Ray Worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ray
Group=ray
EnvironmentFile=/etc/ray/ray-worker.env
ExecStart=/opt/ray/venv/bin/ray start --block --address=${RAY_HEAD_ADDRESS} --node-ip-address=${RAY_NODE_IP}
ExecStop=/opt/ray/venv/bin/ray stop
Restart=on-failure
RestartSec=10
LimitNOFILE=1048576
TimeoutStopSec=60

[Install]
WantedBy=multi-user.target
```

是否允许 systemd 展开 `${...}`、环境文件格式及命令参数需要在目标发行版验证。不要未经测试直接上线模板。

查看：

```bash
systemctl status ray-head
journalctl -u ray-head --since today
systemctl status ray-worker
journalctl -u ray-worker --since today
```

## 12. 日志和临时目录

Ray 会创建 Session 目录和组件日志。常见入口可从：

```bash
ray logs --help
ray list nodes --detail
```

以及目标版本的 Session 路径确认。不要永久依赖 `session_latest` 的内部文件名作为稳定 API。生产采集应标记：

- Cluster、Job、Node、Worker、Actor、Task；
- 主机与 PID；
- 软件版本；
- 首次异常时间；
- 日志是否来自当前 Session。

临时与 Spill 目录需要容量、IOPS、清理和告警，不应默认落在空间有限的系统盘。

## 13. 节点退出实验

在无业务或专用实验集群中停止 Worker：

```bash
/opt/ray/venv/bin/ray stop
```

在 Head 观察：

```bash
ray list nodes --detail
ray status
ray list actors --detail
ray list placement-groups --detail
```

验证：

- Node 进入 Dead/不可用；
- 该节点 Task/Actor/Object 的状态符合重试设计；
- 没有足够资源时工作进入明确 Pending，而不是静默成功；
- Worker 重新启动后以新运行实例加入；
- 外部业务结果没有重复提交。

## 14. 常见故障

| 现象 | 首要检查 |
| --- | --- |
| Worker 无法连接 GCS | Head 是否运行、地址是否可达、版本、路由、防火墙 |
| Worker 加入后立即退出 | Raylet/Agent 日志、端口冲突、内存、临时盘 |
| 显示错误 IP | 多网卡自动选择，显式 `--node-ip-address` |
| Ray 资源数错误 | 自动检测、覆盖参数、cgroup、GPU 可见设备 |
| Task 只在 Head 运行 | Worker 是否 Alive、资源是否匹配、调度策略 |
| Object 获取慢 | 跨节点带宽、MTU、对象大小、Spill、磁盘 |
| Dashboard 可达但 Job 失败 | Runtime Env、代码、权限和 Worker 日志 |
| 重启后出现旧 Node | 心跳判死窗口、Session、重复服务进程 |

## 15. 安全最低要求

- 集群内部端口仅对参与节点开放；
- Dashboard、Jobs API、Ray Client 经 SSH Tunnel、VPN 或受控代理访问；
- 只允许可信主体提交代码；
- Ray 用户使用最小 OS 权限；
- 模型和数据只读，写出目录单独授权；
- 云元数据、对象存储和 Secret 凭证最小化；
- 开启目标版本支持的认证/TLS 时仍保留网络隔离；
- 多租户强隔离使用独立 Ray 集群。

## 16. 生产验收

- [ ] 节点资产、IP、DNS、时钟和路由已归档；
- [ ] Python/Ray/依赖在所有节点完全一致；
- [ ] 端口矩阵和防火墙最小放通；
- [ ] 逻辑 CPU/GPU 与物理资源一致；
- [ ] `/dev/shm`、Heap、Spill 和磁盘容量已压测；
- [ ] Jobs API 提交、日志和取消已验证；
- [ ] systemd 启停、重启、优雅终止已验证；
- [ ] Worker/Head 故障演练满足恢复目标；
- [ ] 外部副作用具备幂等和审计记录。

下一篇：[Docker 与 Compose 部署 Ray 集群](./12-Docker与Compose部署Ray集群.md)。

## 17. 官方资料 {/* #官方资料 */}

- [Launching an On-Premise Cluster](https://docs.ray.io/en/latest/cluster/vms/user-guides/launching-clusters/on-premises.html)
- [Starting Ray](https://docs.ray.io/en/latest/ray-core/starting-ray.html)
- [Configuring Ray](https://docs.ray.io/en/latest/configure.html)
- [Ray Jobs CLI Quickstart](https://docs.ray.io/en/latest/cluster/running-applications/job-submission/quickstart.html)
- [Ray Security](https://docs.ray.io/en/latest/ray-security/index.html)
