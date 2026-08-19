---
title: "对象内存、Spill 与 OOM 排查"
sidebar_label: "30. 对象内存、Spill 与 OOM 排查"
sidebar_position: 30
description: "区分 Worker Heap、Object Store、共享内存、Spill 磁盘与 GPU 显存，系统定位 Ray 内存问题。"
tags: [Ray, Object Store, Object Spilling, OOM, 内存]
---

# 对象内存、Spill 与 OOM 排查

“Ray 内存不足”至少可能指五件事：Worker Heap、Plasma Object Store、共享内存、Spill 磁盘或 GPU HBM。先分类，
否则调大任意一个限制往往会让另一层更快耗尽。

## 1. 内存地图

```text
Host RAM
├─ Ray系统进程：GCS / raylet / Dashboard
├─ Worker Heap：Python、框架、反序列化副本
└─ Object Store：Plasma共享内存
   └─ 压力过高 → Spill到本地盘/外部存储

GPU HBM
├─ 模型权重
├─ KV Cache
├─ 激活与临时Workspace
└─ CUDA/NCCL上下文
```

Linux 进程视角中，Object Store 的共享页会出现在多个 Worker 的 `SHR` 中。估算 Worker 私有内存时常看 `RSS - SHR`，
不能把所有进程的 SHR 直接相加。

## 2. 对象生命周期

`ray.put()`、Task 返回值和对象传输会进入 Object Store。只要集群内还有 `ObjectRef`、待执行任务参数或嵌套引用，对象就
可能被 Pin。主副本在压力下 Spill，使用时再 Restore；引用消失后才可真正回收。

```bash
ray memory --sort-by=OBJECT_SIZE --group-by=STACK_TRACE
ray list objects --detail
```

优先找大对象、同一调用栈大量对象、长期 Pin 和 Driver 保存的引用列表。

## 3. Spill 配置

裸机示例：

```bash
ray start --head \
  --object-store-memory=8589934592 \
  --object-spilling-directory=/mnt/nvme/ray-spill
```

Spill 目录要求：本地高速盘、容量告警、独立于系统根分区、正确权限和生命周期清理。容器内未挂载持久/大容量目录时，
Spill 可能写满容器临时盘并触发 Pod 驱逐。

## 4. 四类典型现象

| 现象 | 常见原因 | 首要证据 |
| --- | --- | --- |
| Object Store 满、Restore 慢 | 活跃对象集大、磁盘慢 | Object Store/Spill 指标 |
| Worker 被 Ray memory monitor 杀 | Heap 总量接近阈值 | raylet 与 Worker 日志 |
| Pod `OOMKilled` | cgroup limit 超出 | `kubectl describe pod` |
| GPU OOM | 权重/KV/Batch/碎片 | Worker 错误和 GPU 指标 |

## 5. 排查顺序

```bash
free -h
df -h
df -i
du -sh /mnt/nvme/ray-spill
ray memory --sort-by=OBJECT_SIZE
ray status
```

Kubernetes：

```bash
kubectl -n ray-system describe pod <pod>
kubectl -n ray-system top pod <pod> --containers
kubectl get node <node> -o jsonpath='{.status.allocatable.memory}'
```

再查看 Dashboard 的每 Task/Actor 内存和同节点 Worker。`OOMKilled` 的退出码与 Ray 主动杀 Worker 的日志不同。

## 6. 代码层减压

### 6.1 有界并发

```python
pending = []
for item in items:
    pending.append(process.remote(item))
    if len(pending) >= 64:
        done, pending = ray.wait(pending, num_returns=16)
        consume(ray.get(done))
```

### 6.2 流式而非一次聚合

- 分块读取与写出；
- 使用生成器/迭代式 API；
- 减少一次 `ray.get()` 巨大列表；
- 处理后及时删除 Driver/Actor 中的 ObjectRef；
- 避免在对象里嵌套长期引用的 ObjectRef。

### 6.3 降低副本

Actor 内的模型、缓存和线程池都是 Heap/显存占用。并发提高不等于 Actor 越多越好。

## 7. Head OOM

Head 还运行 GCS、Dashboard，且 Driver 常默认在 Head。生产可让 Head 不承载普通计算资源，并为控制面保留内存。若 GCS
内存持续增长，检查大量短命 Task/Actor、Job 历史和控制面负载，而不是只扩大 Object Store。

## 8. GPU OOM 的特殊处理

依次核对：其他占卡进程、模型精度/量化、TP、`max_model_len`、最大并发、KV Cache、CUDA Graph 与峰值输入。
自动重试 GPU OOM 可能造成重启风暴，应先限流并降低负载。

## 9. 不要这样修

- 盲目调大 Object Store，挤压 Worker Heap；
- 把 Spill 放根分区；
- 无限提高重试次数；
- 定时 `gc.collect()` 代替修复引用；
- 把 cgroup limit 调到节点全部内存、不留系统余量；
- 只用平均请求长度做 HBM 估算。

## 10. 验收清单

- [ ] 能区分 Heap、Object Store、Spill、cgroup 与 HBM；
- [ ] Spill 目录容量、时延和写入量有监控；
- [ ] 并发和在途 ObjectRef 有上限；
- [ ] 最坏输入分布下不会重试风暴；
- [ ] Head 控制面有独立余量；
- [ ] 内存泄漏可定位到 Task/Actor 和调用栈。

下一篇：[GPU 调度、性能分析与资源死锁](./31-GPU调度性能分析与资源死锁.md)。

## 11. 官方资料 {/* #官方资料 */}

- [Memory management](https://docs.ray.io/en/latest/ray-core/scheduling/memory-management.html)
- [Object spilling](https://docs.ray.io/en/latest/ray-core/internals/object-spilling.html)
- [Debugging memory issues](https://docs.ray.io/en/latest/ray-observability/user-guides/debug-apps/debug-memory.html)
