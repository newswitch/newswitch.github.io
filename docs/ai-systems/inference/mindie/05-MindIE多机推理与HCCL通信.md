---
title: "MindIE 多机推理与 HCCL 通信"
sidebar_label: "05. 多机推理与 HCCL 通信"
sidebar_position: 5
description: "解释Rank Table、Master/Slave、HCCN网络和HCCL初始化，给出MindIE多机部署与故障定位方法。"
tags: [MindIE, 多机推理, HCCL, Rank Table, RoCE]
---

# MindIE 多机推理与 HCCL 通信

只有当单机HBM无法容纳模型，或经过容量验证确实需要跨机并行时，才应使用多机推理。跨机并行增加了：

```text
Rank配置 + HCCN/RoCE网络 + HCCL同步 + 多节点生命周期 + 故障放大
```

它不是免费的显存扩展。

## 1. 单机字段与多机字段的边界

单机通常由`worldSize`和`npuDeviceIds`描述本实例设备。多机模式启用后，总Rank和设备映射主要由Rank Table决定。

```text
multiNodesInferEnabled = true
RANK_TABLE_FILE = /path/ranktable.json
```

目标版本对字段的优先级必须查同版本安装指南。单机环境若遗留错误的`RANK_TABLE_FILE`，底层组件也可能尝试读取并导致初始化失败，因此配置切换时要清理旧变量。

## 2. Rank Table表达什么

Rank Table概念上描述：

```text
Server列表
├─ Server ID / 管理IP
├─ 设备列表
│  ├─ device_id
│  ├─ device_ip（HCCN）
│  └─ rank_id
└─ 总Rank数
```

要求：

- Rank ID全局唯一且连续满足目标版本约束；
- Server与设备IP真实可达；
- 每节点看到相同Rank Table内容；
- Rank Table与容器实际注入NPU一致；
- 文件不可在启动过程中被覆盖。

## 3. Master与Slave

官方多机模式通常以Rank 0所在节点作为Master接收推理请求，其他Slave参与模型执行而不直接承接外部业务流量。

这意味着Kubernetes Service不能无差别把请求轮询给所有Rank Pod。服务选择器、端口和Ready语义必须只暴露真正接入节点或使用MindIE上层调度组件。

## 4. 网络分成两张

```text
控制/服务网络：Kubernetes API、HTTP请求、日志和管理
HCCL数据网络：设备HCCN IP、RoCE/专用交换网络
```

Pod能互相`ping`不代表HCCL数据面正确。需要检查：

- 设备IP与Rank Table；
- 端到端MTU；
- 路由和VLAN；
- 网卡/交换机错误、拥塞和PFC/ECN；
- 防火墙与必要端口；
- 多路径选择和NUMA亲和；
- 所有节点驱动、CANN和MindIE一致。

## 5. 多机启动时间线

```text
各节点容器启动
→ 读取相同模型与Rank Table
→ 初始化本地NPU
→ 建立HCCL World
→ 各Rank加载对应权重分片
→ 初始化Cache与Warmup
→ 所有Rank就绪
→ Master服务Ready
```

任意Rank失败都可能让其余Rank停在HCCL或Barrier。排障要找首个失败Rank，而不是最后一个超时日志。

## 6. Kubernetes编排注意事项

- 使用Gang/组调度保证所有Rank同时获得资源；
- 使用固定网络身份或可靠生成Rank Table；
- 模型制品在所有节点一致且加载性能可控；
- Master未完成全组初始化前不能Ready；
- 一个Rank退出时，上层应将整个模型副本摘流；
- Pod重建后Rank、IP和设备映射必须重新验证；
- PDB不能阻止必要修复，也不能允许维护时一次驱逐全部副本。

普通Deployment分别拉起几个Pod不等于完成了分布式生命周期管理。

## 7. 启动卡住排查

1. 列出所有Rank Pod与节点。
2. 对齐各Pod日志时间戳。
3. 找最早的Import、设备、权重、OOM或网络错误。
4. 核对每个Pod读取的Rank Table摘要。
5. 核对容器可见设备与Rank分配。
6. 检查HCCN IP、链路和端到端连通。
7. 使用官方集合通信测试建立网络基线。
8. 回退最近版本或网络变更。

## 8. 性能问题排查

| 现象 | 优先验证 |
| --- | --- |
| 单机快、多机慢很多 | 跨机HCCL占比、并行度收益 |
| TPOT周期性抖动 | 慢Rank、交换拥塞、Host抖动 |
| 所有NPU利用率低 | Rank同步等待、CPU准备、请求不足 |
| 某节点NPU先空闲 | 分片计算不均或该节点先进入通信 |
| 负载升高后超时 | 网络拥塞、HCCL Buffer、SLO容量 |

比较各Rank进入和退出Collective的时间，判断是通信本身慢，还是某Rank计算迟到。

## 9. 故障恢复模型

多数紧耦合TP实例中，一个Rank不可用意味着整个副本不可用：

```text
单Rank故障
→ 全组摘流
→ 保存所有Rank现场
→ 销毁/重建整个分布式实例
→ 重新建立Rank与设备映射
→ Warmup与健康验证
→ 恢复流量
```

不要只重启一个Rank后假设其他进程组能无状态接纳它，除非目标版本明确支持并经过演练。

## 10. 多机验收

```text
[ ] Rank Table由单一受控流程生成并有摘要
[ ] 所有节点软件与模型制品一致
[ ] HCCN IP、MTU和交换网络验收通过
[ ] 全组调度和失败清理无资源泄漏
[ ] Master/Slave服务暴露正确
[ ] 单机与多机性能差异有解释
[ ] 可定位到每Rank、物理NPU和网卡
[ ] 任一Rank退出时能够自动摘流
[ ] 整组重建与回滚时间满足SLO
[ ] 集群保留N-1分布式副本容量
```

## 11. 官方资料

- [MindIE 2.3多机推理](https://www.hiascend.com/document/detail/zh/mindie/230/envpre/instg/mindie_instg_0027.html)
- [HCCL文档入口](https://www.hiascend.com/document/redirect/CannCommunityHccl)
