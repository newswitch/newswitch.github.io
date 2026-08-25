---
title: "TP、PP、DP、Rank 与通信初始化日志分析"
sidebar_label: "07. 并行与通信初始化日志"
sidebar_position: 7
description: "从并行策略、Rank 映射、Rendezvous、NCCL/HCCL 通信组和拓扑日志定位单卡、多卡与多机启动问题。"
tags: [TP, PP, DP, Rank, NCCL, HCCL]
---

# TP、PP、DP、Rank 与通信初始化日志分析

多卡模型服务不是“启动一个进程，然后自动使用所有卡”。框架通常会创建多个 Worker，每个 Worker
绑定一个设备并拥有 Rank 身份，再按 TP、PP、DP 或 EP 关系建立多个通信组。

```text
启动器
→ 创建 Worker 进程
→ 分配 Rank 与设备
→ Rendezvous
→ 创建通信组
→ 拓扑发现
→ 集合通信自检
→ 各 Rank 加载权重
→ Barrier 后整体 Ready
```

任何一个 Rank 失败，其他 Rank 最终都可能报超时，但只有最先异常的 Rank 接近根因。

## 1. 先理解四种并行

| 并行方式 | 拆分对象 | 主要通信 | 常见用途 |
|---|---|---|---|
| TP | 单层 Tensor | AllReduce、AllGather、ReduceScatter | 单卡装不下或需要更高单副本算力 |
| PP | 模型层 | Stage 间发送激活 | 跨设备/节点放置模型层 |
| DP | 完整模型副本 | 请求路由、部分场景同步状态 | 提高副本吞吐和可用性 |
| EP | MoE Expert | All-to-All | MoE Expert 分布到多设备 |

不同框架对 DP 的实现可能是多个独立服务，也可能在一个引擎内建立 DP Group。读日志时以实际进程和
通信组为准，不要只看参数名。

## 2. Rank 身份

常见字段：

| 字段 | 含义 |
|---|---|
| `rank` | 全局进程编号，范围通常为 `0..world_size-1` |
| `local_rank` | 当前节点内进程编号 |
| `world_size` | 全局参与进程总数 |
| `node_rank` | 节点编号 |
| `master_addr` | Rendezvous 主节点地址 |
| `master_port` | Rendezvous 端口 |

典型映射：

```text
节点 A：global rank 0,1,2,3 → local device 0,1,2,3
节点 B：global rank 4,5,6,7 → local device 0,1,2,3
world_size = 8
```

容器内 `CUDA_VISIBLE_DEVICES=4,6` 时，逻辑 `cuda:0` 可能对应物理 GPU 4。排障记录要同时保存逻辑 ID
和物理 UUID，避免把设备映射错误当作随机硬件故障。

## 3. 通信初始化经过哪些步骤

### 3.1 进程发现与 Rendezvous

所有进程先通过 TCP Store、文件、etcd、Ray 或框架控制面交换身份。此时失败通常表现为：

- 主地址无法解析或不可达。
- 端口被占用或防火墙拦截。
- 各节点的 `world_size`、Rank 配置不一致。
- 某个 Worker 根本没有拉起。

### 3.2 创建设备通信 Context

每个进程绑定设备并创建 NCCL/HCCL Communicator。设备映射错误可能导致两个 Rank 抢同一张卡，
或 Rank 使用了不存在的逻辑设备。

### 3.3 拓扑发现和链路选择

NCCL/HCCL 根据节点内互联和网卡选择通道：

```text
GPU：NVLink / NVSwitch / PCIe / RoCE / InfiniBand
NPU：HCCS / PCIe / RoCE
```

拓扑错误可能不阻止初始化，却使多卡性能严重下降。

### 3.4 创建子通信组

全局 World 之外，框架还会创建 TP、PP、DP、EP Group。一个 Rank 可能属于多个 Group。

## 4. 单卡为什么也会出现 Gloo 或 Rank 日志

`world_size=1` 时，框架仍可能复用分布式初始化代码。类似：

```text
Gloo Rank 0 is connected to 0 peer ranks
```

表示唯一 Rank 没有 Peer，是正常信息。判断是否异常要结合 `world_size`：

- `world_size=1`、0 个 Peer：正常。
- `world_size=8`、Rank 长期只连接部分 Peer：需要排查。

## 5. 从日志还原进程拓扑

建议整理为：

| Global Rank | Node | PID | Local Rank | 逻辑设备 | 物理设备/UUID | TP/PP/DP/EP Group |
|---:|---|---:|---:|---|---|---|
| 0 | node-a | 101 | 0 | cuda:0 | GPU-UUID-A | TP0、PP0 |
| 1 | node-a | 102 | 1 | cuda:1 | GPU-UUID-B | TP0、PP0 |

如果日志不包含 UUID，可从设备工具和容器环境补充。所有 Rank 都应该唯一，设备映射也应符合设计。

## 6. 正常通信初始化的证据

正常启动通常可以看到：

1. 所有预期 Worker 进程出现。
2. 每个 Rank 打印一致的 `world_size`。
3. 每个 Local Rank 绑定唯一设备。
4. Rendezvous 完成。
5. NCCL/HCCL Communicator 创建完成。
6. TP/PP/DP/EP Group 数量符合配置。
7. 所有 Rank 继续进入权重加载或缓存初始化。
8. 最终 Barrier 完成，Engine Ready。

仅看到 Rank 0 成功不能证明其他 Rank 成功。

## 7. 故障一：某个 Worker 没有启动

现象：

- 预期 8 个 Rank，只看到 7 个。
- 其他 Rank 卡在 Store、Rendezvous 或 Barrier。
- 上层最后报通信超时。

优先检查缺失 Rank 对应的：

- 容器或子进程退出码。
- 设备是否存在、是否被占用。
- CPU 内存和文件句柄。
- 模型路径和权限。
- Python 导入或设备初始化异常。

通信超时可能只是“等不到已经退出的 Worker”。

## 8. 故障二：Rank 或设备映射冲突

典型问题：

```text
两个进程都使用 local_rank=0
world_size 在不同节点不一致
CUDA_VISIBLE_DEVICES 与 local_rank 计算不一致
Pod 只注入 4 张卡，启动参数要求 TP=8
```

检查：

```bash
env | grep -E 'RANK|WORLD_SIZE|LOCAL_RANK|MASTER|CUDA_VISIBLE|ASCEND'
nvidia-smi -L
npu-smi info
```

Kubernetes 还要比较容器资源声明、Device Plugin 分配结果和容器内可见设备。

## 9. 故障三：网络或网卡选择错误

多机通信可能因为：

- 管理网与计算网选择错误。
- 容器看不到 RoCE/InfiniBand 设备。
- MTU、VLAN、路由或防火墙不一致。
- RDMA 驱动和用户态库不匹配。
- NCCL/HCCL 选择了不可达接口。
- DNS 将主机名解析到错误地址。

先验证控制面 TCP 可达，再验证 RDMA/集合通信。不要一上来就调模型并发。

## 10. 故障四：集合通信卡住或超时

一个典型传播链：

```text
Rank 5：权重加载 OOM
→ Rank 5 退出
→ Rank 0～4、6～7 进入 AllReduce/Barrier
→ 集合通信超时
→ EngineCore 报 Worker failed
```

排查原则：

1. 收集所有 Rank，而不是只看 Rank 0。
2. 统一时间轴。
3. 找每个 Rank 第一条异常。
4. 判断是否有 Rank 在进入 Collective 前已经退出。
5. 若所有 Rank 同时卡在同一 Collective，再查链路和通信库。

## 11. NCCL/HCCL 日志怎样开启

NCCL 常用诊断环境变量包括：

```bash
export NCCL_DEBUG=INFO
export NCCL_DEBUG_SUBSYS=INIT,NET,GRAPH
```

诊断结束后应恢复，避免海量日志影响服务。不要盲目长期设置接口或关闭某种传输；这些变量会改变路径，
可能让问题暂时消失但掩盖根因。

HCCL 的日志级别和路径受 CANN/框架版本影响，应以当前版本官方文档为准。记录所有 HCCL、
Device Plugin 和 RankTable 相关配置，不从其他版本复制未知环境变量。

## 12. 节点内拓扑验证

NVIDIA：

```bash
nvidia-smi topo -m
nvidia-smi topo -p2p r
```

观察 GPU 间是 NVLink/NVSwitch 还是经过 PCIe、CPU Socket。TP 对高频集合通信敏感，跨 NUMA 或跨节点
放置可能导致启动正常但吞吐下降、尾延迟升高。

昇腾环境需要结合服务器硬件拓扑、NPU 逻辑 ID、HCCS 和 RoCE 组网验证。可继续阅读
[Atlas 800I A2 与 Ascend 910B 软硬件架构](../vllm-ascend/05-Atlas-800I-A2与Ascend-910B软硬件架构.md)。

## 13. 分层最小实验

按复杂度逐层增加：

```text
单卡设备算子
→ 单机两卡集合通信
→ 单机全卡集合通信
→ 两节点最小集合通信
→ 全规模通信测试
→ 小模型多卡启动
→ 目标模型启动
```

如果两节点通信测试已经失败，就不需要等待大模型加载 20 分钟后再观察同一个超时。

## 14. 性能问题和启动问题的边界

通信初始化完成只证明通道建立，不证明性能正确。上线前还要检查：

- 集合通信带宽和时延是否达到拓扑基线。
- 是否存在单个慢 Rank。
- 实际走 NVLink/HCCS/RDMA 还是回退路径。
- TP 增加后吞吐是否提升，还是通信占比过高。
- 跨节点放置是否符合设计。

相关案例见[TP 慢 Rank、NVLink 与 NCCL 推理故障排查](../vllm/20-TP慢Rank-NVLink与NCCL推理故障排查.md)和
[HCCL、HCCS 与 TP 慢 Rank 故障排查](../vllm-ascend/12-HCCL-HCCS与TP慢Rank故障排查.md)。

## 15. 参考资料

- [PyTorch Distributed Communication Package](https://docs.pytorch.org/docs/stable/distributed.html)
- [NVIDIA NCCL Documentation](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/)
- [vLLM：Parallelism and Scaling](https://docs.vllm.ai/en/latest/serving/parallelism_scaling.html)
