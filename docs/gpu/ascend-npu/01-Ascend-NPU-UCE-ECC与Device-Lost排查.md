---
title: "Ascend NPU UCE、ECC 与 Device Lost 排查"
sidebar_label: "01. UCE、ECC 与 Device Lost 排查"
sidebar_position: 1
description: "区分昇腾 NPU 的可纠正与不可纠正内存错误、异步 UCE 暴露、设备丢失和软件算子失败，并建立 Pod、Rank 与物理设备证据链。"
tags: [Ascend, NPU, UCE, ECC, Device Lost, CANN]
---

# Ascend NPU UCE、ECC 与 Device Lost 排查

看到 `UCE ERROR` 时，最容易犯两个相反的错误：一是直接认定物理 NPU 已损坏，二是因为重启成功就认定只是软件偶发。正确做法是保存第一条设备证据，建立逻辑 Rank 到物理 NPU 的映射，再用跨设备、跨软件路径的单变量实验判断故障是否跟随硬件。

`Device Lost` 同样是上层观察结果，表示当前进程或运行时无法继续使用设备，不自动等于某一种硬件根因。

## 1. 三个概念分别表示什么

### 1.1 ECC

ECC 用于检测设备内存中的位错误。`npu-smi info -t ecc` 在支持的设备和版本上可能显示 DDR/HBM 的单比特、双比特、累计和隔离页信息。

- 单比特/可纠正错误：硬件可能完成纠正，但短时增长仍要观察；
- 双比特/不可纠正错误：数据完整性无法保证，通常需要更高级别处理；
- 隔离页/隔离行：故障内存区域已被健康机制记录或隔离；
- 当前计数与累计计数：前者用于本次事故，后者用于长期趋势。

实际字段和严重性取决于产品、固件和驱动，不要把其他型号的阈值直接用于 910B。

### 1.2 UCE

UCE 通常表示不可纠正错误语义。它可能在 torch-npu/CANN 的同步边界被应用看到，也可能伴随设备 health、ECC、RAS 或故障码。

重要事实：

```text
算子B触发设备错误
→ Host继续异步提交C、D
→ 在D或synchronize处发现UCE
→ Python堆栈指向D
```

所以报错算子可能只是错误观察点。可在隔离复现环境临时使用 `ASCEND_LAUNCH_BLOCKING=1` 让错误更接近触发位置，但同步模式会关闭/影响异步任务队列并显著改变性能。

### 1.3 Device Lost

Device Lost 表示应用当前无法继续访问或使用目标 NPU，可能来自：

- UCE 或其他设备严重故障；
- 驱动/固件异常；
- 设备被复位或上下文失效；
- 容器设备文件、权限或可见设备变化；
- Device Plugin/运行时注入异常；
- 节点 PCIe、供电或硬件问题；
- 一个 Rank 退出后其他 Rank 传播出来的通信错误。

必须回到 `npu-smi`、驱动日志、CANN 日志和 Device Plugin 状态确定原因。

## 2. 故障怎样向上传导

```text
HBM/AI Core/链路/驱动异常
→ 设备health或故障码变化
→ CANN Runtime在同步边界返回错误
→ torch-npu抛出UCE/Device Lost
→ Worker或某个Rank退出
→ 其他Rank出现HCCL超时
→ EngineCore无法推进
→ API超时、流式中断、Pod重启
```

排查日志时寻找“第一个异常 Rank”和“第一条设备错误”，不要把后续 HCCL Timeout 当成自动根因。

## 3. 第一步：冻结故障时间线

至少记录：

```text
故障时间与时区
Pod UID / Container ID / Node
Worker与TP Rank
容器逻辑Device ID
宿主机物理NPU ID与Chip Logic ID
模型、请求或启动阶段
第一条torch-npu/CANN错误
health/ECC/设备故障码
后续HCCL与Engine错误
```

Kubernetes 侧先采集：

```bash
date -Ins
kubectl -n NAMESPACE get pod POD -o yaml
kubectl -n NAMESPACE describe pod POD
kubectl -n NAMESPACE logs POD -c CONTAINER --since=30m --timestamps
kubectl -n NAMESPACE logs POD -c CONTAINER --previous --timestamps
kubectl get events -A --sort-by=.lastTimestamp
```

Pod YAML 和环境可能包含敏感信息，对外提供前要脱敏。

## 4. 第二步：建立 Rank 到物理 NPU 的映射

`Worker_TP1`、`Device:1` 和宿主机 NPU 1 不是天然同一对象。

容器侧采集：

```bash
env | grep -Ei 'ASCEND|NPU|HCCL|RANK'
ls -l /dev/davinci* 2>/dev/null
npu-smi info
```

节点侧采集：

```bash
npu-smi info -m
npu-smi info -l
```

命令支持范围随 `npu-smi` 版本变化，先执行：

```bash
npu-smi info -h
```

最终记录：

```text
Pod UID
→ TP Rank
→ 容器逻辑Device
→ /dev/davinci设备
→ Chip Logic ID
→ 物理NPU ID
→ PCIe/服务器槽位
```

只有完成映射，才能验证故障是否跟随同一物理 NPU。

## 5. 第三步：采集 NPU 健康和 ECC

在宿主机或具备只读权限的诊断环境执行：

```bash
npu-smi info
npu-smi info -i DEVICE_ID -c CHIP_ID -t health
npu-smi info -i DEVICE_ID -t ecc
npu-smi info -i DEVICE_ID -t usages
npu-smi info -i DEVICE_ID -t temp
npu-smi info -i DEVICE_ID -t power
```

不同产品不一定支持全部 `-t` 类型。将“不支持”记录下来，不要解释成状态正常。

重点保存：

- Health Status、Error Code 和 Error Information；
- HBM/DDR 单比特与双比特当前、累计计数；
- 隔离页/隔离行相关信息；
- AI Core、HBM、温度和功耗；
- 故障前后同一物理卡的增量；
- 同节点其他卡是否同时变化。

## 6. 第四步：采集驱动、固件和 CANN 证据

```bash
cat /usr/local/Ascend/driver/version.info 2>/dev/null
cat /usr/local/Ascend/firmware/version.info 2>/dev/null
find /usr/local/Ascend -maxdepth 3 \
  \( -name 'version.info' -o -name '*install.info' \) -print
journalctl -k --since '故障前十分钟' --until '故障后十分钟'
```

CANN 日志路径会随部署方式、用户和版本变化。应从当前安装文档和进程环境确认 plog/slog/设备日志位置，不要在脚本中假设永久固定目录。

关联阅读：

- Python/Worker 日志：谁最先抛出错误；
- CANN Runtime 日志：错误码、Stream、Task 与设备；
- 设备/驱动日志：health、RAS、UCE 和复位事件；
- HCCL 日志：首个异常 Rank 与传播顺序；
- Kubernetes 日志：Device Plugin 是否标记 Fault/Unhealthy。

## 7. Device Plugin 状态怎样看

Ascend Device Plugin/MindCluster 的资源键、ConfigMap 字段和恢复机制随版本变化。常见证据包括：

```bash
kubectl describe node NODE
kubectl get configmap -n kube-system "mindx-dl-deviceinfo-NODE" -o yaml
kubectl get pod -n kube-system -o wide | grep -Ei 'ascend.*device|device.*plugin|npu'
kubectl logs -n kube-system DEVICE_PLUGIN_POD --since=30m --timestamps
```

可能看到的状态方向包括：

- Fault；
- Unhealthy；
- Recovering；
- NetworkUnhealthy；
- ManuallySeparateNPU；
- UpgradeFaultReason。

字段名以目标版本为准。不要手工编辑健康 ConfigMap 来让故障卡重新可调度，这会破坏控制器状态和审计链。

## 8. 怎样区分硬件故障与软件路径

### 8.1 更像物理设备问题

- 同一物理 NPU 在不同模型/算子中出现 UCE；
- 换到健康卡后相同程序通过；
- `health`、ECC、RAS 或 Device Plugin 同时异常；
- 基础矩阵乘和设备诊断也失败；
- 故障在压力、温度或特定物理槽位下复现；
- 重启只能短暂恢复，并在同一物理卡复发。

### 8.2 更像软件或兼容问题

- 所有健康卡都在同一模型/Shape/算子失败；
- 只在某组 CANN、torch-npu、框架版本出现；
- Eager 通过而 Graph/特定融合失败；
- 同步模式将首错稳定定位到不支持的算子或参数；
- 回到官方验证版本矩阵后恢复；
- 设备 health/ECC/RAS 持续正常。

### 8.3 仍无法判定

关闭图或融合后不再失败，只能证明故障与该执行路径相关；它也可能改变峰值内存、任务时序和硬件压力。还需物理卡 A/B 和设备证据才能确定因果。

## 9. 最小化验证矩阵

在摘流、隔离的诊断环境中逐项改变：

| 实验 | 保持不变 | 改变项 | 回答的问题 |
| --- | --- | --- | --- |
| A | 小矩阵、版本 | 物理 NPU | 是否跟随设备 |
| B | 模型、卡、版本 | 同步/异步 | 首错是否前移 |
| C | 模型、卡、版本 | Eager/Graph | 是否与图路径相关 |
| D | 模型、卡、Graph | 单个融合开关 | 是否与融合路径相关 |
| E | 模型、版本 | TP=1/TP>1 | 是否进入 HCCL/多进程路径 |
| F | 卡、模型、参数 | 已知稳定镜像 digest | 是否与版本矩阵相关 |

每轮记录物理卡映射、第一条错误、health/ECC 增量和完整版本。

## 10. UCE 后为什么重启可能成功

重启会重新创建进程、Context、Stream、内存布局和物理设备映射，还可能使 Kubernetes 重新分配 NPU。因此成功可能来自：

- 新 Pod 换到了另一张健康卡；
- 瞬态设备状态被复位；
- 内存布局和任务时序变化，没有再次触发；
- 缓存/图编译路径变化；
- 故障本来就是间歇性硬件问题。

必须比较重启前后的 Node、Pod UID、物理 NPU 和版本。没有这些证据，“重启成功”不能区分上述情况。

## 11. 恢复动作边界

看到 UCE/Device Lost 后：

1. 保存日志、health、ECC、设备故障码和映射；
2. 摘流并隔离目标卡或节点；
3. 根据目标 Atlas 产品和故障码文档选择复位、节点重启、DMI 诊断或硬件维修；
4. 不要把环境变量调优当成设备修复；
5. 不要在有业务运行时执行设备复位或主动压力诊断；
6. 未通过健康验收前，不要重新加入资源池。

具体隔离与恢复过程见[Ascend 910B 故障卡隔离与节点恢复](./02-Ascend-910B故障卡隔离与节点恢复.md)。

## 12. 告警设计

联合以下信号：

- NPU Health 非 OK；
- Error Code/Error Information 变化；
- HBM/DDR 双比特或不可纠正错误增量；
- 隔离页/行增长；
- Device Plugin Fault/Unhealthy/资源数量变化；
- Worker、Rank 和 HCCL 首错；
- 同物理 NPU 的重复事故；
- 温度、功耗、HCCS/RoCE 网络健康；
- 业务 TTFT、ITL、错误率和健康副本数。

告警通知必须包含物理 NPU、Node、Pod、Rank、时间、错误码和 Runbook，不要只写 `Device 1 UCE`。

## 13. 常见误区

1. 把 `Worker_TP1` 当作物理 1 号卡；
2. 只保存 Python Traceback，不保存 CANN/设备日志；
3. 看到融合算子名就断定融合实现有 Bug；
4. 同时关闭 Graph、融合、异步和 HCCL 调优，无法判断有效变量；
5. 重启成功后不比较是否换节点/换卡；
6. 手工修改 Device Plugin ConfigMap 恢复资源；
7. health 显示 OK 就忽略事故窗口的历史错误；
8. 把 UCE 当 OOM 处理，只调整内存利用率。

## 14. 参考资料

- [昇腾训练及推理后 NPU 环境检查](https://www.hiascend.com/document/detail/zh/mindcluster/600/faultdiag/faultdiagug/mindxdlFDUG027.html)
- [CANN 社区版文档](https://www.hiascend.com/document/detail/en/CANNCommunityEdition/850/index/index.html)
- [npu-smi 信息查询帮助](https://www.hiascend.com/document/detail/zh/Atlas%20200I%20A2/260RC1/re/npu/npusmi_006.html)
- [torch-npu 与 CANN 异步执行链路](../../ai-systems/inference/vllm-ascend/07-torch-npu与CANN异步执行链路.md)
- [Qwen3.5-27B Worker TP1 UCE ERROR 排障记录](../../ai-systems/inference/vllm-ascend/03-Qwen3.5-27B-Worker-TP1-UCE-ERROR排障记录.md)
