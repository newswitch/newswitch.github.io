---
title: "HCCL、HCCS 与 TP 慢 Rank 故障排查"
sidebar_label: "12. HCCL 与 TP 慢 Rank 排查"
sidebar_position: 12
description: "从逻辑Rank映射、节点内互联到跨机RoCE，定位vLLM-Ascend张量并行中的通信超时与慢Rank。"
tags: [HCCL, HCCS, Tensor Parallel, 慢Rank, RoCE]
---

# HCCL、HCCS 与 TP 慢 Rank 故障排查

TP实例的速度由最慢Rank限制。即使七张NPU都正常，一张NPU或它的Host线程、链路变慢，也会让其他Rank在集合通信处等待。

```text
T_step
≈ max(T_compute_rank_0 ... T_compute_rank_n)
 + T_collective
 + T_sync
```

所以“HCCL耗时高”不一定表示网络本身故障，也可能是某个Rank迟到。

## 1. 分清三层名称

| 名称 | 含义 |
| --- | --- |
| Rank | 分布式进程中的逻辑编号 |
| HCCL | 昇腾集合通信库 |
| HCCS/PCIe/RoCE | HCCL可能使用的底层设备互联与网络路径 |

日志中的`Worker_TP1`首先表示逻辑Rank。必须完成Rank到物理设备和网卡的映射，才能判断硬件责任域。

## 2. 单机与跨机通信

```text
单机TP：Rank → NPU → 节点内HCCS/PCIe → NPU
跨机TP：Rank → NPU → HCCN/RoCE NIC → Switch → NIC → NPU
```

跨机路径还依赖：

- 每张设备的HCCN IP和路由；
- 交换机VLAN、MTU、PFC/ECN等RoCE配置；
- Rank Table或Rendezvous信息；
- 防火墙与端口；
- 容器网络命名空间和Host Network策略；
- 多机时间与版本一致性。

## 3. 慢Rank的四类根因

### 3.1 计算慢 {/* #计算慢 */}

- 设备降频、温度、健康异常；
- 某Rank进入不同Kernel或Shape；
- 量化/模型分片不均；
- Graph回退或编译缓存不同。

### 3.2 Host慢 {/* #host慢 */}

- Worker绑定到远端NUMA；
- CPU关键核饱和；
- Python GC或日志IO；
- 输入准备、Tokenizer或进程调度抖动。

### 3.3 通信慢 {/* #通信慢 */}

- HCCS/PCIe链路异常；
- HCCN IP、路由或网卡选择错误；
- RoCE丢包、拥塞或MTU不一致；
- HCCL Buffer和版本组合问题。

### 3.4 Rank不同步 {/* #rank不同步 */}

- 某Rank提前异常退出；
- 请求Shape或控制流不一致；
- Graph参数更新顺序问题；
- 初始化阶段Rank信息不一致。

## 4. 第一步：固定映射

保存：

```text
Pod → Node
Worker PID → TP Rank
TP Rank → 容器逻辑NPU
容器逻辑NPU → 宿主机物理NPU
物理NPU → HCCN IP/端口/NUMA
```

命令入口：

```bash
kubectl get pod -n <ns> <pod> -o wide
kubectl exec -n <ns> <pod> -- env | grep -Ei 'RANK|WORLD|ASCEND|HCCL'
kubectl exec -n <ns> <pod> -- npu-smi info
```

节点侧再查询对应物理设备、进程和链路。不要在映射不清时直接复位“第1张卡”。

## 5. 第二步：判断谁先慢

在同一时间线比较每Rank：

```text
模型计算开始/结束
集合通信进入/退出
CPU输入准备
Graph Replay
设备Kernel
```

两种典型模式：

```text
模式A：Rank3计算晚结束 → 所有Rank在HCCL等待
结论：先查Rank3计算/Host，不要先定责网络

模式B：所有Rank同时进入HCCL → 集体长时间不退出
结论：优先查HCCL与底层链路
```

Profiler和带时间戳的Rank日志比单个平均利用率更可靠。

## 6. 第三步：健康与链路检查

```bash
npu-smi info
/usr/local/Ascend/driver/tools/hccn_tool -i <device_id> -ip -g
/usr/local/Ascend/driver/tools/hccn_tool -i <device_id> -link -g
ip -s link show <interface>
ethtool -S <interface>
```

具体工具路径、参数和权限随HDK版本变化，应以节点实际安装为准。重点不是命令是否返回“up”，而是：

- 错包、丢包和重传是否增长；
- MTU是否端到端一致；
- HCCN IP和Rank配置是否一致；
- 故障是否只在某设备或某交换路径出现；
- 同时段交换机是否有拥塞或PFC异常。

## 7. 第四步：最小通信基线

将模型执行与通信拆开：

1. 单NPU模型基线：排除HCCL。
2. 单机两卡集合通信测试：验证节点内路径。
3. 单机全部卡测试：发现特定组合或拓扑问题。
4. 跨机两卡测试：验证RoCE最小路径。
5. 跨机完整World Size：验证规模效应。

通信测试必须使用与目标镜像一致的CANN/HCCL环境，并记录消息大小。小消息正常不代表大消息或高并发稳定。

## 8. HCCL超时怎么读

超时日志至少提取：

- 首个报错Rank和时间；
- Collective类型；
- World Size与Group；
- 对端Rank；
- 超时前最后一个成功Step；
- 是否存在更早的设备、OOM或Python异常。

经常是某个Rank先因OOM/UCE退出，其他Rank随后报HCCL超时。最后出现的“所有Rank通信失败”是连锁结果，不是首因。

## 9. 交换法验证

| 实验 | 结果 | 倾向结论 |
| --- | --- | --- |
| Rank固定，换物理NPU | 故障跟随物理NPU | 设备/设备链路 |
| 物理NPU固定，换Rank | 故障跟随Rank/工作量 | 软件/分片/输入 |
| 同机正常，跨机异常 | 只跨机失败 | RoCE/路由/Rank配置 |
| TP=1正常，TP=2失败 | 通信或并行路径 | HCCL/拓扑/版本 |
| Eager正常，Graph失败 | 图路径相关 | Graph/Shape/同步 |

每次只交换一个因素，并保存映射，才能形成因果证据。

## 10. 生产缓解与永久修复

临时措施可以是：

- 摘流并重建故障副本；
- 隔离可疑节点或物理NPU；
- 降低TP或回到单机边界；
- 回滚已知稳定镜像和通信配置；
- 限制长请求与并发，降低通信压力。

永久修复必须对应根因：驱动/固件升级、网卡或交换配置修复、CPU绑定、拓扑调度、设备更换、版本对齐或代码修复。重启不是永久修复。

## 11. 验收清单

```text
[ ] 每个Rank可映射到物理NPU和HCCN端口
[ ] 单机与跨机通信基线已保存
[ ] 各Rank计算与HCCL时间线可比较
[ ] 交换实验能区分Rank、设备和链路
[ ] 首个失败Rank而不是最后超时Rank已识别
[ ] 故障设备可被调度层隔离
[ ] N-1容量允许摘除一个副本/节点
[ ] 修复后完成长稳与峰值通信压测
```

## 12. 官方资料

- [Ascend HCCL文档入口](https://www.hiascend.com/document/redirect/CannCommunityHccl)
- [vLLM-Ascend多节点通信验证](https://docs.vllm.ai/projects/ascend/en/latest/tutorials/multi_node.html)
- [Ascend故障诊断文档入口](https://www.hiascend.com/document/redirect/MindCluster)
