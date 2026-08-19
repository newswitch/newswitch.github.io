---
title: "安装 Ray 并运行第一个分布式任务"
sidebar_label: "02. 安装 Ray 并运行第一个分布式任务"
sidebar_position: 2
description: "在隔离的 Python 环境中安装并固定 Ray，运行 Task、Actor 和对象依赖实验，并用 Dashboard、ray status 与 State CLI 验证运行状态。"
tags: [Ray, Python, 安装, Task, Actor, Dashboard]
---

# 安装 Ray 并运行第一个分布式任务

本文只搭建单机实验环境，但使用的 Task、Actor、ObjectRef 和状态工具与多节点集群一致。先在单机把代码、
依赖、资源和状态观察跑通，再进入裸机或 Kubernetes 集群，可以显著缩小排障范围。

## 1. 实验目标

完成后应能：

- 创建独立 Python 环境并固定 Ray 版本；
- 区分 `ray.init()`、`ray.init(address="auto")` 和 Ray Client；
- 运行一个无状态 Task 和一个有状态 Actor；
- 用 ObjectRef 构建任务依赖而不提前阻塞；
- 使用 Dashboard、`ray status` 和 State CLI 验证进程与对象状态；
- 正确停止实验集群并清理资源。

## 2. 环境要求

推荐使用 Linux。WSL2 可以完成本地开发实验，但不能据此推断 Linux 生产集群的网络、共享内存和 GPU
行为。生产 Ray 节点应使用相同 CPU 架构、Python 小版本和 Ray 版本。

最低实验资源建议：

- 4 个逻辑 CPU；
- 8 GiB 内存；
- 足够的 `/dev/shm` 和临时磁盘；
- Python 3 的受支持版本；
- 本地回环端口未被安全策略阻断。

先检查：

```bash
python3 --version
python3 -m pip --version
df -h /dev/shm /tmp
```

## 3. 建立隔离环境并固定版本

### 3.1 使用 venv {/* #使用-venv */}

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
```

学习 Core、Dashboard 和 CLI，可以安装默认扩展。将 `<RAY_VERSION>` 替换成已经验证的目标版本：

```bash
python -m pip install "ray[default]==<RAY_VERSION>"
```

如果后续使用 Ray Data、Train、Tune、Serve 或 LLM 组件，应按目标工作负载安装对应 Extra，并把解析后的
完整依赖锁定。不要在生产镜像构建中使用不固定版本的：

```bash
pip install -U "ray[default]"
```

它适合临时探索，不适合作为可复现部署记录。

### 3.2 保存环境证据 {/* #保存环境证据 */}

```bash
python --version
ray --version
python -m pip show ray
python -m pip check
python -m pip freeze
```

`pip freeze` 应进入实验制品或构建记录，不要只保存一条安装命令。Ray 与上层库的兼容范围需要按目标版本
文档验证。

## 4. 本地模式与本地 Ray 实例

最常见的初始化方式是：

```python
import ray

context = ray.init()
print(context.address_info)
```

如果当前进程没有连接现有集群，Ray 会在本机启动运行时。脚本退出时，本地实例通常随 Job 生命周期结束，
但异常进程或手工启动的集群可能仍然存在。

调试器需要逐行进入远程函数时，可以在受控开发场景了解 `local_mode`，但它会改变执行方式和并发语义，
不能用它做性能、竞态、资源调度或故障恢复验证。

## 5. 第一个 Task

创建 `first_task.py`：

```python
import os
import socket
import time

import ray

@ray.remote(num_cpus=1)
def inspect_task(value: int) -> dict:
    time.sleep(0.5)
    return {
        "value": value,
        "square": value * value,
        "host": socket.gethostname(),
        "pid": os.getpid(),
    }

def main() -> None:
    ray.init()
    refs = [inspect_task.remote(value) for value in range(8)]
    results = ray.get(refs)
    for result in results:
        print(result)

if __name__ == "__main__":
    main()
```

运行：

```bash
python first_task.py
```

观察点：

- `.remote()` 返回 `ObjectRef`；
- 循环先提交八个任务，再统一 `ray.get()`；
- Task 运行在 Ray Worker 进程，而不是 Driver 进程；
- 单机可能出现多个 PID，但 Host 相同；
- `num_cpus=1` 是 Ray 逻辑资源请求，不是强制 CPU 隔离。

### 5.1 一个常见的串行化错误 {/* #一个常见的串行化错误 */}

下面的写法每提交一个 Task 就等待结果，失去并行性：

```python
results = []
for value in range(8):
    results.append(ray.get(inspect_task.remote(value)))
```

正确思路通常是分离提交和等待；当任务数量非常大时，再使用 `ray.wait()` 建立有界并发，而不是一次创建
无限数量的 ObjectRef。

## 6. 第一个 Actor

创建 `first_actor.py`：

```python
import os
import socket

import ray

@ray.remote(num_cpus=1)
class Counter:
    def __init__(self) -> None:
        self.value = 0

    def increment(self) -> dict:
        self.value += 1
        return {
            "value": self.value,
            "host": socket.gethostname(),
            "pid": os.getpid(),
        }

def main() -> None:
    ray.init()
    counter = Counter.remote()
    refs = [counter.increment.remote() for _ in range(5)]
    print(ray.get(refs))

if __name__ == "__main__":
    main()
```

Actor 方法访问同一份 `self.value`，并通常由专属 Worker 进程执行。默认 Actor 方法的执行顺序、并发行为、
异步 Actor 和 Concurrency Group 将在 Actor 专题中展开。此处不要根据一个简单实验推导所有 Actor 都是
线程安全或所有方法都能并行。

## 7. 用 ObjectRef 建立依赖

下游 Task 可以直接接收 ObjectRef。Ray 在依赖对象可用后再执行：

```python
import ray

ray.init()

@ray.remote
def load() -> list[int]:
    return [1, 2, 3, 4]

@ray.remote
def transform(values: list[int]) -> list[int]:
    return [value * 10 for value in values]

@ray.remote
def summarize(values: list[int]) -> int:
    return sum(values)

loaded_ref = load.remote()
transformed_ref = transform.remote(loaded_ref)
total_ref = summarize.remote(transformed_ref)
print(ray.get(total_ref))
```

Driver 没有在每一步 `ray.get()`。这种引用传递让 Ray 看见依赖关系，也减少了不必要的 Driver 中转。

## 8. 连接一个手工启动的本地集群

先启动 Head：

```bash
ray start --head --port=6379 --dashboard-host=127.0.0.1
```

再运行连接代码：

```python
import ray

ray.init(address="auto")
print(ray.cluster_resources())
```

结束实验：

```bash
ray stop
```

注意：

- `ray.init()` 可以自行启动本地实例；
- `ray.init(address="auto")` 查找并连接已有集群；
- `ray start --head` 启动的是显式集群进程，脚本退出后不会自动等价清理；
- KubeRay 管理的 Pod 不应通过手工 `ray stop/start` 修复，应修改 CR 并由 Operator 收敛状态；
- 生产环境不要把 Head、GCS、Dashboard 和 Ray Client 端口直接暴露到公网。

端口和参数可能随版本变化，应以目标版本的命令帮助为准：

```bash
ray start --help
```

## 9. Dashboard 与 CLI 验证

本地 Dashboard 通常监听在回环地址。实际地址以 `ray.init()` 输出或启动日志为准。打开后重点观察：

- Nodes：本地 Ray Node 是否 Alive；
- Jobs：Driver 对应的 Job 状态；
- Tasks：Task 的提交、运行和完成；
- Actors：Actor 的状态、PID 和资源；
- Metrics：CPU、内存和对象存储趋势。

命令行先看资源总览：

```bash
ray status
```

再看具体对象：

```bash
ray list nodes --format table
ray list jobs --format table
ray list actors --format table
ray list tasks --limit 100 --format table
```

不同 State CLI 子命令对地址和 Dashboard 组件的要求可能不同。先执行：

```bash
ray list --help
ray summary --help
ray logs --help
```

完整速查见 [Ray CLI 命令详解](../../../training/commands/04-Ray-CLI命令详解.md)。

## 10. 验证资源声明

启动一个只有两个逻辑 CPU 的本地实例：

```python
import time

import ray

ray.init(num_cpus=2)

@ray.remote(num_cpus=1)
def hold(value: int) -> int:
    time.sleep(3)
    return value

refs = [hold.remote(value) for value in range(6)]
print(ray.get(refs))
```

理论上同时只能获得两个 CPU Resource Slot。通过 Dashboard 或 State CLI 验证 Task 分批运行。不要用墙钟时间作为
唯一证据，因为进程启动、系统负载和采样周期都会影响结果。

## 11. 常见失败

| 现象 | 首要检查 |
| --- | --- |
| `ray` 命令不存在 | 是否激活正确虚拟环境，`python -m pip show ray` 是否属于同一 Python |
| Dashboard 无法打开 | 是否安装 `ray[default]`、实际监听地址、Dashboard 日志与端口 |
| Task 一直 Pending | `ray status` 的资源需求与总资源、Task 的 CPU/GPU/自定义资源 |
| 程序看似没有并行 | 是否在提交循环中立即 `ray.get()`、任务是否过短、CPU 数是否足够 |
| Object Store 满 | ObjectRef 是否仍被引用、对象大小、`/dev/shm`、Spill 目录 |
| 脚本退出后仍有进程 | 是否使用了手工 `ray start`，确认目标后执行 `ray stop` |
| 连接到错误集群 | `ray.init()` 地址、环境变量、已有本地实例和命名空间 |

## 12. 安全与可复现性

- Dashboard、GCS、Ray Client 和内部 Worker 端口只应位于受信网络；
- 不要把未知来源的代码、Pickle 对象或 Runtime Env 提交到可信集群；
- 依赖和镜像必须固定版本与哈希；
- 实验目录不要包含密钥、云凭证和生产数据；
- 对外部系统的写操作必须设计幂等键，不能假设 Task 永远只执行一次；
- 性能测试必须关闭无关负载，并保存 CPU、内存、对象存储和任务状态。

## 13. 实验验收

- [ ] Python、Ray 和依赖版本已保存；
- [ ] Task 在独立 Worker PID 中运行；
- [ ] Actor 的多次调用观察到连续状态；
- [ ] ObjectRef 依赖链没有在中间提前 `ray.get()`；
- [ ] `ray status` 与 State CLI 能看到对应资源和对象；
- [ ] 能解释 `ray.init()` 与连接已有集群的差异；
- [ ] 实验结束后确认 Ray 进程和临时资源已清理。

下一篇：[Job、Driver、Task、Actor、Worker 与 Node](./03-Job-Driver-Task-Actor-Worker与Node.md)。

## 14. 官方资料 {/* #官方资料 */}

- [Installing Ray](https://docs.ray.io/en/latest/ray-overview/installation.html)
- [Ray Core Walkthrough](https://docs.ray.io/en/latest/ray-core/walkthrough.html)
- [Starting Ray](https://docs.ray.io/en/latest/ray-core/starting-ray.html)
- [Ray Dashboard](https://docs.ray.io/en/latest/ray-observability/getting-started.html)
- [Ray State CLI](https://docs.ray.io/en/latest/ray-observability/reference/cli.html)
