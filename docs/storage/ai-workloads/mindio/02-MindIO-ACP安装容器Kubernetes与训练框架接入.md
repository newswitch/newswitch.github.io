---
title: "MindIO ACP 安装、容器、Kubernetes 与训练框架接入"
sidebar_label: "02. 安装、Kubernetes 与框架接入"
sidebar_position: 2
description: "从版本矩阵、宿主机服务、SDK、UDS与MemFS到容器和Kubernetes挂载，完整说明MindIO ACP的生产接入方法。"
tags: [MindIO, MindIO ACP, Ascend, Checkpoint, Kubernetes, MemFS]
---

# MindIO ACP 安装、容器、Kubernetes 与训练框架接入

MindIO ACP接入不是简单地在训练容器中安装一个Python包。完整链路至少包含训练框架、ACP SDK、宿主机服务、UDS通信目录、内存数据池和可靠存储。只安装SDK却没有打通服务与存储，代码可以成功导入，Checkpoint仍然无法完成异步持久化。

本文不把某一版本的安装包名和接口签名当作永远不变的标准。实际部署前，应先查阅当前MindCluster版本的产品文档和版本配套表，再把本文中的占位符替换为现场值。

## 1. 先画清部署边界

容器化训练时，一条典型保存链路如下：

```text
训练Pod
├─ PyTorch/MindSpore训练进程
├─ MindIO ACP SDK
└─ /usr/local/mindio/uds  ─────────────┐
                                      │ Unix Domain Socket
宿主机                                │
├─ MindIO ACP服务进程  <──────────────┘
├─ MemFS/内存数据池
└─ /checkpoints ── NFS/CephFS/并行文件系统/其他可靠存储
```

各部分职责不能混淆：

| 组件 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| 训练框架 | 定义要保存的模型、优化器、调度器和随机状态 | 不保证ACP后台任务完成 |
| ACP SDK | 把保存与加载请求交给ACP服务 | 不替代可靠存储 |
| ACP服务 | 管理内存数据块、异步任务和后端写入 | 不判断业务Checkpoint是否语义完整 |
| UDS目录 | 让容器内SDK与宿主机服务通信 | 不是Checkpoint存储目录 |
| MemFS/内存池 | 吸收写入突发，缩短前台等待 | 断电后不能作为最终副本 |
| 后端存储 | 保存可恢复的Checkpoint | 性能不足时仍会造成积压 |

## 2. 固定版本矩阵

生产部署前建立一张不可省略的矩阵：

| 层级 | 现场需要记录的内容 |
| --- | --- |
| 服务器 | Atlas/Ascend型号、CPU架构、NUMA拓扑、主机内存 |
| 操作系统 | 发行版、内核、glibc、文件系统 |
| NPU软件栈 | 驱动、固件、CANN、Ascend Docker Runtime |
| 训练栈 | Python、PyTorch与torch-npu或MindSpore、训练框架版本 |
| MindIO | MindCluster版本、MindIO ACP服务端和SDK包版本 |
| 编排层 | Docker/containerd、Kubernetes、Device Plugin |
| 存储 | 挂载协议、客户端版本、挂载参数、路径、吞吐与配额 |

若出现“宿主机服务正常，但容器初始化失败”，优先核对SDK与服务端是否来自同一配套版本，而不是先反复重启训练任务。

## 3. 安装前检查

### 3.1 资源和系统条件

至少确认：

```bash
uname -m
uname -r
cat /etc/os-release
free -h
df -hT
mount | grep -E 'nfs|ceph|lustre|checkpoints'
npu-smi info
```

ACP会使用主机内存缓存Checkpoint。不能只看“空闲内存”，还要给操作系统页缓存、训练DataLoader、通信库、监控Agent和其他Pod保留空间。某些版本文档给出“ACP数据块池不超过主机内存25%”一类建议，它应被视为该版本的起点，而不是所有环境的固定答案。

### 3.2 用户、目录与时钟

服务端与训练容器需要：

- 对UDS目录具有一致的用户或组权限；
- 对Checkpoint目录具有创建、重命名、同步和删除权限；
- 各节点时钟同步，便于关联训练日志、ACP日志和存储监控；
- 相同的Checkpoint路径语义，多机任务不能把同一路径映射到不同后端。

不要为解决权限问题直接给容器添加`privileged: true`。优先使用固定UID/GID、`fsGroup`、目录属组和最小化的挂载权限。

## 4. 安装服务端与SDK

安装包名称通常类似：

```text
Ascend-mindxdl-mindio_{version}_linux-{arch}.zip
mindio_acp-{version}-{python_tag}-linux_{arch}.whl
```

名称和目录随版本变化，下面只展示验证思路：

```bash
sha256sum Ascend-mindxdl-mindio_*.zip
unzip Ascend-mindxdl-mindio_*.zip
python3 -m pip install ./mindio_acp-*.whl --force-reinstall
python3 -c "import mindio_acp; print(mindio_acp.__file__)"
```

服务端应严格使用该版本安装指南或官方部署工具安装。安装后验证的目标不是“命令返回0”，而是：

1. 服务进程处于运行状态；
2. UDS文件已经创建；
3. 服务日志没有持续初始化错误；
4. 后端存储路径可读写；
5. SDK能够与服务端完成最小保存和加载。

不同版本的服务名和日志目录可能不同，可先从进程和安装清单反查：

```bash
ps -ef | grep -i '[m]indio'
find /var/log /opt /usr/local -maxdepth 4 -iname '*mindio*' 2>/dev/null
find /opt/mindio /usr/local/mindio -type s -ls 2>/dev/null
```

## 5. 初始化参数怎样理解

不同版本的`initialize`签名有差异，但核心配置可以归为三类：

```python
server_info = {
    # 示例值；字段和上限必须以现场版本文档为准
    "memfs.data_block_pool_capacity_in_gb": "128",
}

ret = mindio_acp.initialize(server_info=server_info)
if ret != 0:
    raise RuntimeError(f"MindIO ACP initialize failed: {ret}")
```

| 参数类别 | 决定什么 | 配错后的典型现象 |
| --- | --- | --- |
| 内存池容量 | 可以同时容纳多少待持久化数据 | 太小会等待或回退；太大会挤压主机内存 |
| 服务地址/UDS | SDK连接哪个服务实例 | 初始化超时、找不到socket、权限拒绝 |
| 后端与任务参数 | 数据落到哪里、怎样排队 | 路径错误、积压、保存完成但无法恢复 |

初始化成功只证明控制链路基本连通，不证明Checkpoint已经写入可靠存储。

## 6. 改造训练保存逻辑

### 6.1 先定义Checkpoint内容

一个可恢复的训练Checkpoint通常至少包含：

- 模型参数；
- 优化器和学习率调度器状态；
- global step、epoch和数据游标；
- 随机数状态；
- 混合精度状态；
- 并行切分、模型配置和软件版本元数据。

ACP只加速保存，不会自动补齐遗漏的状态。

### 6.2 把“提交”与“完成”分开

接入时应把状态显式建模：

```text
训练线程生成状态
  → 提交ACP保存任务
  → 前台接口返回
  → ACP后台持久化
  → 每Rank完成
  → 全局校验通过
  → 发布manifest/_SUCCESS
```

伪代码如下，真实函数名和返回值以版本API为准：

```python
checkpoint = build_checkpoint_state()
task = mindio_acp.save(checkpoint, checkpoint_path)

# 训练可以继续，但必须记录task状态
register_async_task(task)

# 退出、抢占或发布“可恢复”标志前，等待并检查后台结果
wait_and_verify(task)
publish_commit_marker(checkpoint_path)
```

如果训练进程在SDK返回后立即退出，内存中的数据可能还没有落盘。优雅退出、任务抢占和异常处理都必须等待正在进行的任务，或明确把该Checkpoint标记为不可恢复。

### 6.3 多Rank不能各自宣布成功

多机多卡训练中，单个Rank写完不等于全局Checkpoint可用。推荐：

1. 每个Rank写自己的分片和校验信息；
2. 汇总所有Rank的完成状态；
3. 校验world size、分片数量、字节数和元数据；
4. 由协调者原子发布manifest或`_SUCCESS`；
5. 恢复程序只选择带完成标志的代次。

## 7. Docker接入

容器需要同时看到SDK、UDS和Checkpoint目录。示意命令：

```bash
docker run --rm \
  --name ascend-training \
  --device /dev/davinci0 \
  --mount type=bind,src=/opt/mindio/uds,dst=/usr/local/mindio/uds \
  --mount type=bind,src=/mnt/checkpoints,dst=/checkpoints \
  --shm-size=32g \
  training-image:version
```

注意：

- `/usr/local/mindio/uds`是部分版本文档中的固定容器路径，必须按现场版本确认；
- `--shm-size`解决的是容器`/dev/shm`容量，不等于ACP的MemFS数据块池；
- 设备映射应优先交给Ascend容器运行时和Kubernetes Device Plugin管理；
- 不要把Checkpoint长期写在容器可写层。

## 8. Kubernetes接入

下面展示关键结构，不是可直接复制到所有集群的完整生产清单：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: ascend-training
spec:
  nodeSelector:
    mindio-acp: "enabled"
  securityContext:
    fsGroup: 1000
  containers:
    - name: trainer
      image: registry.example.com/training:version
      resources:
        limits:
          huawei.com/Ascend910: 8
      volumeMounts:
        - name: mindio-uds
          mountPath: /usr/local/mindio/uds
        - name: checkpoints
          mountPath: /checkpoints
        - name: dshm
          mountPath: /dev/shm
  volumes:
    - name: mindio-uds
      hostPath:
        path: /opt/mindio/uds
        type: Directory
    - name: checkpoints
      persistentVolumeClaim:
        claimName: training-checkpoints
    - name: dshm
      emptyDir:
        medium: Memory
        sizeLimit: 32Gi
```

### 8.1 为什么要给节点打标签

UDS对应的是本机服务，Pod不能漂移到没有安装ACP服务的节点。完成节点验收后再打标签：

```bash
kubectl label node <node-name> mindio-acp=enabled
kubectl get nodes -l mindio-acp=enabled
```

标签只是调度约束，不是健康证明。如果节点上的ACP服务停止，标签不会自动消失，因此还需要节点巡检或健康控制器。

### 8.2 Pod退出与抢占

为退出预留持久化时间：

```yaml
terminationGracePeriodSeconds: 300
```

训练进程收到`SIGTERM`后应停止创建新Checkpoint，等待已提交任务完成，最后再退出。宽限期具体多大应由最大Checkpoint大小、后端最差写带宽和安全余量计算，而不是照抄300秒。

## 9. 上线前五级验证

### 9.1 连接验证

- SDK可导入；
- UDS存在且权限正确；
- 初始化成功；
- 服务端能看到客户端连接。

### 9.2 单节点保存和加载

保存一个小对象，等待后台完成，再启动全新进程加载并校验哈希。不能用保存进程内仍然存在的内存对象冒充恢复成功。

### 9.3 多Rank一致性

校验所有分片、manifest、world size和完成标记；模拟一个Rank保存失败，确认该代不会被恢复程序选中。

### 9.4 故障与降级

分别模拟后端变慢、后端不可写、内存池不足、ACP服务停止和Pod被终止，确认：

- 错误能被监控发现；
- 不会把不完整Checkpoint标为成功；
- 原生保存回退路径符合预期；
- 回退发生时有告警，而不是静默隐藏性能退化。

### 9.5 真实恢复

在独立任务中从可靠存储恢复，继续训练若干步，对比global step、loss趋势、优化器状态和随机性。只有完成这一步，Checkpoint才算真正可用。

## 10. 升级与回滚

升级时不要只升级训练镜像中的wheel。服务端和SDK应作为一个配套单元验证：

1. 记录旧版完整矩阵和安装包校验值；
2. 在测试节点验证旧Checkpoint可由新版本读取；
3. 验证新版本保存的Checkpoint是否需要旧版本回读；
4. 进行性能、故障注入和恢复回归；
5. 灰度升级节点与训练任务；
6. 保留原生保存路径和已验证的稳定Checkpoint作为回滚点。

## 11. 课后练习

### 11.1 练习1：为什么Pod能看到Checkpoint PVC，仍可能初始化ACP失败？ {/* #练习1为什么pod能看到checkpoint-pvc仍可能初始化acp失败 */}

**答案：**PVC只打通了数据路径。初始化还依赖SDK和服务端版本、UDS路径、socket权限、宿主机服务状态与配置。数据目录可写不能证明控制链路可用。

### 11.2 练习2：为什么不能在`save()`返回后马上写`_SUCCESS`？ {/* #练习2为什么不能在save返回后马上写success */}

**答案：**异步接口返回通常只代表数据已经提交或进入内存缓冲，后台落盘、所有Rank完成和全局校验可能尚未结束。过早发布完成标志会让恢复程序选择不完整数据。

### 11.3 练习3：为什么`/dev/shm`与ACP内存池不是同一个参数？ {/* #练习3为什么devshm与acp内存池不是同一个参数 */}

**答案：**`/dev/shm`是容器IPC共享内存文件系统的容量；ACP内存池由服务端/MemFS管理，用于缓存Checkpoint数据。两者位于不同组件和资源边界，扩大其中一个不会自动扩大另一个。

## 12. 官方资料

- [MindIO ACP使用指导](https://www.hiascend.com/document/detail/en/mindcluster/2600/clustersched/schedulingug/docs/en/scheduling/optimizing_saving_and_loading_checkpoints/03_usage_guidance.md)
- [MindIO ACP API参考](https://www.hiascend.com/document/detail/en/mindcluster/2600/clustersched/schedulingug/docs/en/scheduling/optimizing_saving_and_loading_checkpoints/05_api_reference.md)
- [MindIO ACP SDK安装](https://www.hiascend.com/document/detail/en/mindcluster/730/clustersched/schedulingug/mindioacp010.html)

下一篇：[MindIO ACP容量、性能、可观测性与故障排查](./03-MindIO-ACP容量性能可观测性与故障排查.md)。
