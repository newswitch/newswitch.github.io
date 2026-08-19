---
title: "GPU 调度、性能分析与资源死锁"
sidebar_label: "31. GPU 调度、性能与资源死锁"
sidebar_position: 31
description: "排查 Ray GPU 不可调度、Placement Group Pending、GPU 利用率低、拓扑错误与嵌套任务资源死锁。"
tags: [Ray, GPU, Placement Group, 性能分析, 资源死锁]
---

# GPU 调度、性能分析与资源死锁

“有空闲 GPU 但任务 Pending”通常不是 Ray 看错了，而是请求的资源形状、Placement Group、标签或节点拓扑无法匹配。

## 1. 三层资源必须一致

```text
物理层：GPU、显存、NVLink、网卡
Kubernetes层：Pod requests/limits、NodeSelector、Taint
Ray层：GPU逻辑资源、自定义资源、Placement Group bundle
```

Ray 的 `num_gpus=1` 是调度许可，不是显存隔离；MIG、分数 GPU 和时间共享还需要设备插件与应用共同保证。

## 2. Pending 排查

```bash
ray status
ray list tasks --filter state=PENDING --detail
ray list actors --filter state=PENDING_CREATION --detail
ray list placement-groups --detail
ray list nodes --detail
```

依次判断：

1. 资源总量是否存在；
2. 单个 bundle 是否能放入任一节点；
3. 所有 bundle 能否同时原子放置；
4. `STRICT_PACK`/`STRICT_SPREAD` 是否过强；
5. 自定义资源和 accelerator label 是否匹配；
6. 资源是否已被 Detached Actor/PG 预留；
7. Autoscaler 是否能创建满足形状的节点。

总空闲 8 GPU 不代表某台节点能容纳 `{"GPU": 8}` bundle。

## 3. 典型资源死锁

Actor 占有全部 CPU，再在方法内等待需要 CPU 的子 Task：

```python
@ray.remote(num_cpus=1)
class Parent:
    def run(self):
        return ray.get(child.remote())

@ray.remote(num_cpus=1)
def child():
    return 1
```

如果所有 CPU 都被 Parent Actor 生命周期预留，Child 永远无法运行。修复方式是减少 Actor 生命周期资源、为方法/子任务预留
容量、改成异步依赖链，或把父协调器设为不占计算 CPU（前提是它确实不计算）。

## 4. Placement Group 泄漏

Driver 退出但 Detached Placement Group 仍存在时会长期占用资源：

```python
from ray.util import get_placement_group, remove_placement_group

pg = get_placement_group("stale-training-group")
remove_placement_group(pg)
```

删除会杀死仍使用其 bundle 的任务/Actor。必须先确认 Owner、名称和业务状态，不能在生产中批量清理未知 PG。

## 5. GPU 低利用率分类

| 表现 | 可能瓶颈 |
| --- | --- |
| GPU 周期性尖峰 | 数据加载、批次太小、同步等待 |
| HBM 高、算力低 | KV/模型占用、访存受限 |
| 多卡一张忙 | rank 放置或进程初始化异常 |
| GPU 等待且网卡满 | TP/梯度集合通信 |
| GPU 等待且 CPU 满 | Tokenizer、序列化、预处理 |
| GPU 与 CPU 都低 | 队列、路由、锁或上游不足 |

## 6. 分层剖析

1. 业务：吞吐、TTFT/TPOT、Batch、输入输出长度；
2. Ray：排队、运行时长、对象传输、Actor 并发；
3. 进程：CPU、线程、RSS、I/O；
4. GPU：SM、Tensor Core、HBM、PCIe/NVLink；
5. 网络：NCCL 带宽、重传、RDMA；
6. Kernel：用 PyTorch Profiler、Nsight Systems/Compute 做受控采样。

剖析工具有开销，生产优先短时采样、影子实例或复现实验。

## 7. 数据本地性

大对象跨节点拉取会让 GPU 等数据。避免把同一个大参数按值重复传给大量 Task；使用 `ray.put()` 复用 ObjectRef，并让计算
尽量靠近对象。但模型权重通常由每个长生命周期 Actor 本地加载，不应频繁通过 Object Store 广播整套模型。

## 8. TP 拓扑

在多机推理中检查每个 rank 的 Node/GPU，结合：

```bash
nvidia-smi topo -m
nvidia-smi dmon
```

TP 通信尽量位于 NVLink/NVSwitch 域。Ray Placement Strategy 是资源放置提示，不会自动修复物理拓扑和慢网卡。

## 9. Autoscaler Pending

Pending demand 应使用 Autoscaler 能识别的资源形状。若请求自定义资源，而节点模板未声明同名资源，扩多少普通节点也不会满足。
同时检查云配额、节点启动失败、Kubernetes Cluster Autoscaler 和 GPU 设备插件。

## 10. 验收清单

- [ ] 物理、Kubernetes 与 Ray 三层资源一致；
- [ ] 每种 bundle 能被某个节点容纳；
- [ ] 没有无 Owner 的 Detached Actor/PG；
- [ ] 嵌套任务不会等待被父对象占满的资源；
- [ ] GPU 性能瓶颈由时间线和剖析证据确认；
- [ ] 自动扩容能创建正确资源形状。

下一篇：[节点掉线、Task 失败与 Actor 异常 Runbook](./32-节点掉线Task失败与Actor异常Runbook.md)。

## 11. 官方资料 {/* #官方资料 */}

- [Placement groups](https://docs.ray.io/en/latest/ray-core/scheduling/placement-group.html)
- [Debugging hangs](https://docs.ray.io/en/latest/ray-observability/user-guides/debug-apps/debug-hangs.html)
- [Profiling](https://docs.ray.io/en/latest/ray-observability/user-guides/debug-apps/optimize-performance.html)
