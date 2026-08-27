---
title: "Kubernetes CPU CFS 限流导致 P99 延迟飙升排查记录"
sidebar_label: "06. Kubernetes CPU CFS 限流导致 P99 延迟飙升排查记录"
sidebar_position: 6
description: "复盘节点CPU仍有余量但Java服务P99显著升高的故障，理解CPU limit、cgroup配额与CFS限流，建立从内核计数器、Prometheus相关性到Canary因果验证的完整证据链。"
tags: [Kubernetes, cgroup, CPU Throttling, CFS, P99, Prometheus, Java, 故障排查]
date: 2026-08-27 10:00:00
categories: SRE
---

# Kubernetes CPU CFS 限流导致 P99 延迟飙升排查记录

某订单服务平时请求延迟 P99 约为 50 ms，流量高峰时突然升至 500 ms。节点 CPU 约 40%，没有 Full GC，数据库慢查询、错误日志和基础网络也没有明显异常。最终证据指向容器 CPU 配额：多线程在很短时间内用完某些调度周期的额度，随后被内核暂停执行，排队时间被放大到请求尾延迟。

这个案例最值得学习的不是“把 CPU limit 调大”，而是下面四件事：

1. 节点平均CPU、容器平均CPU和毫秒级CPU配额消耗不是同一个量；
2. `nr_throttled`大于零只是线索，不能单独证明它导致了P99；
3. 必须使用同一时间窗口把业务延迟、限流增量、请求并发和其他依赖对齐；
4. 修复方案必须通过受控Canary证明因果，并重新评估容量、隔离和成本。

## 1. 故障摘要

| 项目 | 观察结果 |
| --- | --- |
| 业务现象 | 订单接口P99由约50 ms升至约500 ms |
| 节点CPU | 约40%，仍有明显空闲 |
| 应用 | Java多线程服务，未出现明显错误 |
| JVM | Young GC较短，无Full GC峰值 |
| 数据库 | 没有对应时段的明显慢SQL |
| 基础网络 | ICMP时延与带宽没有明显异常 |
| 容器资源 | CPU limit为2 CPU |
| 关键线索 | cgroup `cpu.stat`中的限流计数在故障窗口快速增长 |
| 根因结论 | 容器周期性用完CPU quota，线程等待配额恢复，放大请求排队和P99 |
| 验证方法 | 同负载Canary提高或取消CPU limit，限流增量与P99同时下降 |

这里的“根因结论”必须建立在相关性与变更实验上。只看到一个很大的累计 `nr_throttled`，最多说明历史上发生过限流。

## 2. 为什么常规监控看起来都正常

### 2.1 “CPU 40%”的分母可能完全不同

排障记录中的“CPU 40%”至少可能表示：

- 整台节点所有逻辑CPU的平均利用率；
- Pod相对于节点CPU容量的比例；
- 容器相对于CPU request的比例；
- 容器相对于CPU limit的比例；
- 某一分钟或五分钟窗口的平均使用量。

例如，一台64 CPU节点使用了25.6 CPU，节点利用率就是40%；其中一个limit为2 CPU的容器仍可能已经碰到自己的硬上限。节点有多少空闲CPU不会自动提高该容器的limit。

即使“40%”表示容器只使用了limit的40%，分钟级平均值仍可能掩盖毫秒级突发：某个100 ms周期内额度提前耗尽，而其他周期几乎空闲，长窗口平均仍然很低。

排障时必须给每个CPU图写清：

```text
指标名称
统计对象：节点 / Pod / 容器 / 进程
单位：CPU核数 / 百分比 / CPU秒
分母：节点容量 / request / limit
采样窗口：15s / 1m / 5m
聚合方式：sum / avg / max
```

### 2.2 五项“正常”并没有真正排除五个方向

| 初步检查 | 能说明什么 | 仍然可能遗漏什么 |
| --- | --- | --- |
| 节点CPU 40% | 整机平均未饱和 | 单容器quota、单核热点、run queue、CPU PSI、NUMA |
| GC正常 | 没有明显Stop-The-World峰值 | GC线程被限流、Safepoint、JIT、锁竞争 |
| 无慢SQL | 已记录SQL未超过慢查询阈值 | 连接池等待、锁等待、下游尾延迟、阈值过高 |
| ping正常 | 基础ICMP路径可达 | TCP重传、连接建立、DNS、MTU、Service Mesh、应用排队 |
| 无5xx | 请求没有显式失败 | 成功但很慢、线程池排队、超时前重试 |

因此更准确的表述应是“这些层没有发现与故障同步的强信号”，而不是简单写成“排除”。

## 3. CPU request、limit和内核控制分别做什么

Kubernetes把容器的CPU request和limit交给容器运行时，运行时再配置Linux cgroup。

```text
Pod YAML
  ├─ requests.cpu
  │    ├─ kube-scheduler：决定节点是否放得下
  │    └─ Linux CPU权重：节点竞争时影响公平份额
  │
  └─ limits.cpu
       └─ Linux CPU bandwidth：形成周期性硬上限
```

CPU与内存limit的失败方式不同：CPU超过额度通常不会杀死容器，而是暂停该cgroup中的可运行任务，等额度恢复后继续；内存超过边界则可能触发OOM处理。

### 3.1 cgroup v1中的配额

常见接口：

```text
cpu.cfs_period_us
cpu.cfs_quota_us
cpu.stat
```

如果：

```text
cpu.cfs_period_us = 100000
cpu.cfs_quota_us  = 200000
```

含义是该cgroup在每个100000 μs，也就是100 ms的周期内，最多获得200000 μs的CPU运行时间，等价于平均2 CPU。

### 3.2 cgroup v2中的配额

cgroup v2使用：

```text
cpu.max
cpu.stat
cpu.pressure
```

同一个2 CPU限制通常表现为：

```text
200000 100000
```

`cpu.max`的第一个值是最大可用时间，第二个值是周期；`max 100000`表示没有CPU带宽上限。

### 3.3 多线程为什么会提前耗尽额度

假设容器有8个可运行线程，CPU limit为2：

```text
周期长度：100 ms
可用额度：200 ms CPU-time
```

如果8个线程同时在8个逻辑CPU上执行25 ms：

```text
8 × 25 ms = 200 ms CPU-time
```

这个cgroup可能在墙钟时间只过去25 ms时就用完本周期额度。剩余75 ms中，即使节点还有空闲CPU，这些线程也必须等待下一次额度补充。

真实实现还包含层级cgroup、per-CPU runtime slice和内核版本差异。Linux文档给出的默认CFS bandwidth slice通常是5 ms，但slice是从全局配额池向各CPU本地运行队列批量转移额度的粒度，不能把它简单理解为“应用每5 ms必然停一次”。

### 3.4 父cgroup也可能是限制来源

cgroup控制是分层的。一个容器可能自己的配额尚有余额，但父级Pod cgroup或更上层cgroup已经用完额度，子级仍会被限流。

所以排查不能只读取一个叶子目录：

```text
容器cgroup
→ Pod cgroup
→ QoS cgroup（Guaranteed/Burstable/BestEffort）
→ kubepods
→ 节点根cgroup
```

如果Pod中有Sidecar，还要判断额度是在容器层独立耗尽，还是共享/父级预算产生影响。

## 4. 正确理解cpu.stat

### 4.1 cgroup v1常见字段

```text
nr_periods       发生过的配额统计周期数
nr_throttled     cgroup被限流的周期数
throttled_time   被限流累计时间，通常为纳秒
nr_bursts        发生burst的周期数，取决于内核支持
burst_time       burst累计时间，取决于内核支持
```

### 4.2 cgroup v2常见字段

```text
usage_usec       总CPU使用时间，微秒
user_usec        用户态CPU时间，微秒
system_usec      内核态CPU时间，微秒
nr_periods       配额周期数
nr_throttled     被限流周期数
throttled_usec   限流累计时间，微秒
nr_bursts        burst周期数，取决于内核支持
burst_usec       burst累计时间，取决于内核支持
```

字段会受内核、cgroup版本和是否配置quota影响，应以本机实际文件为准。

### 4.3 三个常见误读

**误读一：`nr_throttled > 0`就代表当前故障。**

这些字段是累计Counter。容器运行数天后出现少量历史限流很常见，必须计算故障窗口内的增量或速率。

**误读二：`nr_throttled / nr_periods`越大，P99一定越差。**

一个周期内只被限制很短时间也会计入 `nr_throttled`。比例说明发生频率，不直接表示每次影响时长，更不知道是否命中了请求关键路径。

**误读三：`throttled_time / 容器运行时间`就是请求被阻塞的百分比。**

限流时间的统计语义、并行任务以及cgroup版本可能使它不能直接等价为墙钟停顿比例。应观察其变化速率并与请求时间线对齐，不应机械换算成“业务有多少百分比时间不可用”。

## 5. 建立可复现的排查时间线

先记录统一时间范围：

```text
故障开始与恢复时间
告警评估时间
业务P50/P95/P99/P999
QPS、并发、排队和超时
发布、扩缩容、节点迁移和配置变更
Pod UID、容器ID、节点和副本版本
```

Pod名称可能在滚动发布后复用业务前缀，Counter也会随容器重启归零。证据必须绑定Pod UID和Container ID，而不能只记Deployment名称。

## 6. 第一步：确认受影响实例和资源配置

在控制端执行：

```bash
kubectl get pod <POD_NAME> -n <NAMESPACE> -o wide

kubectl get pod <POD_NAME> -n <NAMESPACE> \
  -o jsonpath='{.metadata.uid}{"\n"}{range .spec.containers[*]}{.name}{" request="}{.resources.requests.cpu}{" limit="}{.resources.limits.cpu}{"\n"}{end}'

kubectl get pod <POD_NAME> -n <NAMESPACE> \
  -o jsonpath='{range .status.containerStatuses[*]}{.name}{" "}{.containerID}{" restart="}{.restartCount}{"\n"}{end}'

kubectl describe pod <POD_NAME> -n <NAMESPACE>
```

同时检查工作负载模板、LimitRange和准入控制是否改写了资源：

```bash
kubectl get deployment <DEPLOYMENT_NAME> -n <NAMESPACE> -o yaml
kubectl get limitrange -n <NAMESPACE> -o yaml
```

不要只看Git中的YAML。最终生效值可能由LimitRange、Webhook、Helm values或运行中resize改变。

`kubectl top`可以帮助了解当前CPU使用，但它不是高分辨率性能分析工具：

```bash
kubectl top pod <POD_NAME> -n <NAMESPACE> --containers
kubectl top node <NODE_NAME>
```

## 7. 第二步：确认cgroup版本和真实配置

在节点执行：

```bash
stat -fc %T /sys/fs/cgroup
findmnt -t cgroup,cgroup2
```

常见输出：

```text
cgroup2fs   cgroup v2统一层级
tmpfs       不能单独据此确认v1，应继续看findmnt
```

### 7.1 优先从容器视角读取

部分运行时会把当前cgroup视图暴露为只读文件系统，可以先尝试：

```bash
kubectl exec -n <NAMESPACE> <POD_NAME> -c <CONTAINER_NAME> -- \
  sh -c 'cat /proc/self/cgroup; cat /sys/fs/cgroup/cpu.stat 2>/dev/null; cat /sys/fs/cgroup/cpu.max 2>/dev/null'
```

是否能看到当前容器、Pod父级还是命名空间根，取决于cgroup版本、运行时和cgroup namespace。必须与节点视角交叉验证。

### 7.2 从节点上的容器PID定位

先用Pod信息找到Container ID，再在节点上执行：

```bash
sudo crictl inspect <CONTAINER_ID>
```

从输出中确认容器PID，然后查看该进程所属层级：

```bash
cat /proc/<CONTAINER_PID>/cgroup
```

cgroup v2输出通常类似：

```text
0::/kubepods.slice/kubepods-burstable.slice/<实际Pod与容器路径>
```

读取对应文件：

```bash
cat /sys/fs/cgroup/<实际cgroup路径>/cpu.max
cat /sys/fs/cgroup/<实际cgroup路径>/cpu.stat
cat /sys/fs/cgroup/<实际cgroup路径>/cpu.pressure
```

cgroup v1需要先通过 `findmnt` 确认CPU controller挂载点，再把 `/proc/<PID>/cgroup` 中的CPU路径拼到该挂载点。不要照抄固定的 `kubepods/burstable/<pod-uid>` 路径：systemd与cgroupfs驱动、不同CRI和QoS类别的目录结构都可能不同。

### 7.3 读取容器和父级

对容器路径以及它的Pod父路径分别记录两次 `cpu.stat`，间隔覆盖故障窗口。重点是Counter增量：

```text
Δnr_periods
Δnr_throttled
Δthrottled_time或Δthrottled_usec
```

如果叶子容器增量不明显但父级增长，问题可能来自Pod级或更上层约束；如果只有某一个Sidecar增长，则应定位具体容器而不是给整个Pod盲目加CPU。

## 8. 第三步：用Prometheus查看限流速率

cAdvisor常见指标包括：

```text
container_cpu_cfs_periods_total
container_cpu_cfs_throttled_periods_total
container_cpu_cfs_throttled_seconds_total
container_cpu_usage_seconds_total
```

具体指标和标签取决于Kubernetes、kubelet/cAdvisor版本和监控采集配置。没有CPU quota的容器可能没有前几项指标。

### 8.1 限流周期比例

```promql
sum by (namespace, pod, container) (
  rate(container_cpu_cfs_throttled_periods_total{
    container!="",
    container!="POD"
  }[5m])
)
/
clamp_min(
  sum by (namespace, pod, container) (
    rate(container_cpu_cfs_periods_total{
      container!="",
      container!="POD"
    }[5m])
  ),
  1
)
```

应当先分别求和再相除，从而得到加权后的总体比例；直接对每条序列的比例取平均，可能让低流量短命容器获得不合理权重。

### 8.2 限流时间变化速率

```promql
sum by (namespace, pod, container) (
  rate(container_cpu_cfs_throttled_seconds_total{
    container!="",
    container!="POD"
  }[5m])
)
```

不要把这个结果未经验证就标成“限流百分比”。它更适合作为强度和趋势信号。

### 8.3 容器实际CPU使用量

```promql
sum by (namespace, pod, container) (
  rate(container_cpu_usage_seconds_total{
    container!="",
    container!="POD"
  }[5m])
)
```

结果单位近似为使用了多少CPU核。例如结果为 `0.8`，表示该窗口平均使用0.8 CPU；需要再与实际limit、request和节点拓扑比较。

### 8.4 为什么不要固定“5%就是故障”

不同应用对限流的敏感度差异很大：

- 离线批处理可能在较高限流比例下仍满足吞吐目标；
- 单线程请求关键路径可能在很低比例下就出现尾延迟；
- 多线程运行时可能产生较高周期计数，但请求并未命中被限流阶段；
- Sidecar限流与主容器限流的业务影响不同。

告警阈值应来自压测和历史基线。可以先用较低阈值建立观察面板，再根据“限流比例—P99—错误预算消耗”的关系设置分级告警。

## 9. 第四步：把业务和内核指标画到同一张图

至少对齐下面几组指标：

| 维度 | 指标 |
| --- | --- |
| 业务 | QPS、并发、P50/P95/P99/P999、错误、超时 |
| 应用 | 线程池active/queue/reject、事件循环延迟、JVM Safepoint |
| JVM | GC pause、GC CPU、JIT、线程数 |
| cgroup | CPU使用量、限流周期比例、限流时间速率、cpu.pressure |
| 节点 | per-CPU利用率、run queue、上下文切换、软中断、CPU PSI |
| 依赖 | DB连接池等待、SQL延迟、缓存、下游RPC和网络重传 |
| 变更 | 发布、HPA、Pod迁移、节点维护和配置更新时间 |

如果P99峰值与限流峰值重合，只能证明相关性，还需要回答：

1. P99上升是否总伴随限流？
2. 限流出现时P99是否总上升？
3. 其他副本是否出现相同关系？
4. 延迟先升还是限流先升？
5. 请求并发、GC或下游等待是否是共同原因？

例如流量突增可能同时造成P99升高和CPU限流。此时“流量”是共同上游因素，但放宽配额是否能消除P99，还需实验验证。

## 10. 第五步：用Canary完成因果验证

建立两个除CPU策略外尽量一致的副本：

| 变量 | 基准组 | Canary组 |
| --- | --- | --- |
| 镜像摘要 | 相同 | 相同 |
| JVM参数 | 相同 | 相同 |
| 节点池 | 同规格 | 同规格 |
| 请求分布 | 相同或可复现 | 相同或可复现 |
| CPU request | 相同 | 相同 |
| CPU limit | 原值 | 提高后的值或不设limit |

使用固定压测数据和逐级并发，记录：

```text
QPS
P50/P95/P99/P999
错误率与超时
CPU使用核数
限流周期比例
限流时间速率
线程池队列
GC和Safepoint
节点CPU压力
```

强证据链应满足：

```text
提高或取消Canary的CPU limit
→ 请求负载保持可比
→ Canary限流计数显著下降
→ Canary线程池排队下降
→ Canary P99恢复
→ 恢复原limit后问题再次出现（仅在安全测试环境验证）
```

生产环境不必为了追求完美证明而主动恢复故障配置。只要测试环境可复现、生产Canary改善、其他层没有相反证据，通常已经足够做风险受控的修复决策。

## 11. 为什么Java服务容易暴露这个问题

Java服务常同时存在多类CPU消费者：

- 请求处理线程；
- ForkJoinPool或业务线程池；
- GC并发与并行线程；
- JIT编译线程；
- Netty/EventLoop；
- 序列化、压缩、加密和日志线程；
- Service Mesh Sidecar。

如果JVM根据宿主机CPU而不是容器可用CPU创建过多线程，短时并行可能更强。现代JDK通常具备容器感知能力，但仍应实际检查：

```bash
java -XshowSettings:system -version
jcmd <JAVA_PID> VM.flags
jcmd <JAVA_PID> Thread.print
```

重点不是把线程数全部限制到2，而是确认：

- JVM识别到多少可用处理器；
- GC、ForkJoinPool和业务线程池如何计算默认大小；
- 请求高峰时哪些线程真正Runnable；
- 线程池队列是在CPU限流前还是限流后增长；
- Sidecar是否也受到独立CPU limit约束。

GC pause正常不代表GC没有受CPU限制。应同时看GC wall time、GC CPU time、cgroup限流和Safepoint。

## 12. 修复方案一：按压测结果提高CPU limit

这是最直接、最容易灰度的方案。

优点：

- 保留硬上限和故障隔离；
- 修改范围小；
- 可以通过Deployment滚动发布验证。

代价：

- 允许单Pod占用更多CPU；
- request如果同步提高，会降低节点可调度密度；
- request不变而limit大幅提高，节点高竞争时不保证总能获得突发CPU。

不能用固定的 `limit = 2 × request` 作为普适规则。应根据真实请求分布找到：

```text
满足目标P99的最小limit
+ 流量增长余量
+ 故障场景余量
+ GC/JIT/Sidecar余量
```

## 13. 修复方案二：只设CPU request，不设limit

示例结构：

```yaml
resources:
  requests:
    cpu: "2"
    memory: "4Gi"
  limits:
    memory: "4Gi"
```

不配置CPU limit意味着不为该容器设置对应硬配额，通常可以消除由容器自身CPU limit触发的CFS限流。

但这不代表获得了专用CPU：

- 节点忙时仍要与其他cgroup竞争；
- request主要影响调度和竞争权重，不保证瞬时可用CPU；
- 突发服务可能占用节点空闲CPU，影响低权重邻居；
- LimitRange或Webhook可能重新补上默认CPU limit；
- 容量规划必须为突发、系统守护进程和故障迁移保留余量。

适合在经过压测的专用节点池、低超卖环境或延迟敏感服务中使用，并配合PriorityClass、节点池隔离、监控和准入策略。

## 14. 修复方案三：水平扩容和并发整形

如果单Pod在短时间内聚集过多并行工作，仅提高limit不是唯一办法：

- 提前扩容副本，降低单副本并发；
- 使用基于请求队列、并发或P99的扩缩指标；
- 在入口实施有界队列和并发限制；
- 避免无界线程池；
- 将CPU密集任务与请求关键路径拆分；
- 调整负载均衡，避免热点副本；
- 对批任务使用背压而不是无限抢占CPU。

这种方案通常同时改善故障域和单副本尾延迟，但会增加副本、连接池和下游压力，必须联合验证数据库、缓存和网关容量。

## 15. 修复方案四：CPU Manager static与独占CPU

对极低延迟、对调度迁移和邻居干扰敏感的服务，可以建设专用节点池并启用CPU Manager `static`策略。

获得独占CPU的基本条件包括：

- 容器属于Guaranteed QoS Pod；
- CPU request是整数；
- 所有容器的CPU和内存request等于limit，避免Sidecar破坏Guaranteed条件；
- kubelet为系统和Kubernetes进程保留非零CPU；
- 节点已经按官方流程切换策略并重新创建Pod。

工作负载示例：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: latency-sensitive-app
spec:
  containers:
    - name: app
      image: registry.example.com/order-service@sha256:<DIGEST>
      resources:
        requests:
          cpu: "2"
          memory: "4Gi"
        limits:
          cpu: "2"
          memory: "4Gi"
```

CPU Manager的核心能力是分配专用CPU集合并减少迁移、缓存干扰和邻居竞争。对于经典整数核独占场景，quota与可使用CPU集合的理论容量一致，通常不会出现“在可用CPU仍空闲时提前耗尽额度”的现象；仍应根据实际Kubernetes版本、Sidecar、Pod级资源和cgroup层级读取 `cpu.stat` 验证，而不是仅看到cpuset就宣布零限流。

修改CPU Manager策略是节点级变更，需要drain节点、停止kubelet、按官方步骤处理checkpoint并重新创建Pod，不能作为一次应用告警的临时命令执行。参考 [Kubernetes CPU Manager官方文档](https://kubernetes.io/docs/tasks/administer-cluster/cpu-management-policies/)。

## 16. 修复方案五：调整应用并行度

如果应用的有效CPU需求远低于2 CPU，却因为几十个线程的短时唤醒频繁触发限流，可以评估：

- 请求线程数和队列长度；
- ForkJoinPool并行度；
- GC线程数量和收集器；
- JIT编译线程；
- 压缩、加密、JSON序列化并行度；
- 日志同步写和批量策略；
- Sidecar CPU配额。

降低并行度可能减少瞬时额度消耗和上下文切换，但也可能降低吞吐。必须通过容量曲线确认，不能为了消除 `nr_throttled` 把业务线程改成串行。

## 17. cgroup v2 CPU burst为什么不能直接手改

Linux cgroup v2提供 `cpu.max.burst`，允许在上限范围内使用受控burst；cgroup v1的新内核可能提供 `cpu.cfs_burst_us`。这属于内核CPU bandwidth能力。

但标准Pod资源API并没有一个可以在所有Kubernetes、CRI和内核组合中移植的 `cpuBurst` 字段。直接在节点执行：

```text
echo <VALUE> > cpu.max.burst
```

不是可靠的生产方案，因为：

- 容器重建后cgroup路径和设置会消失；
- kubelet或运行时可能重新写入资源；
- 手工状态无法审计并会产生节点漂移；
- 不同内核可能不支持或统计语义不同；
- burst会改变同节点工作负载之间的干扰模型。

只有平台已经提供受支持、可声明、可回滚的实现，并完成内核、运行时和Kubernetes兼容验证时，才应把CPU burst作为正式方案。

## 18. 方案选择矩阵

| 方案 | 主要收益 | 主要代价 | 适用场景 |
| --- | --- | --- | --- |
| 提高CPU limit | 快速减少配额耗尽 | 峰值占用增加 | 通用服务、需保留硬隔离 |
| 不设CPU limit | 消除自身硬配额限流 | 节点竞争与邻居影响增大 | 有余量、强监控的延迟敏感池 |
| 水平扩容 | 降低单副本并发并提高容错 | 副本和下游连接增加 | 可横向扩展的无状态服务 |
| 并发整形 | 把失控排队变成可控背压 | 可能降低峰值吞吐 | 突发明显、线程池过大的服务 |
| CPU Manager static | 独占CPU、减少迁移和干扰 | 整核分配、节点级运维复杂 | 极低延迟、NFV、核心在线服务 |
| 应用并行度优化 | 减少瞬时争用与切换 | 需要代码/JVM压测 | 线程远多于有效并行度 |
| CPU burst | 吸收短时尖峰 | 兼容与治理复杂 | 平台已有受支持实现的波峰业务 |

多数生产修复会组合使用：先Canary提高limit止损，再通过水平扩容、线程池优化和容量测试找到长期配置。

## 19. 监控与告警设计

### 19.1 先建立Recording Rule

```yaml
groups:
  - name: kubernetes-cpu-throttling
    rules:
      - record: workload:container_cpu_throttled_period_ratio:rate5m
        expr: |
          sum by (cluster, namespace, pod, container) (
            rate(container_cpu_cfs_throttled_periods_total{container!="",container!="POD"}[5m])
          )
          /
          clamp_min(
            sum by (cluster, namespace, pod, container) (
              rate(container_cpu_cfs_periods_total{container!="",container!="POD"}[5m])
            ),
            1
          )
```

如果环境没有 `cluster` 标签，应删除该维度；如果Pod频繁重建，应再通过工作负载映射规则聚合到Deployment或服务维度。

### 19.2 告警应关联业务影响

更合理的层次是：

```text
观察：出现CPU throttling
→ Warning：限流持续高于该服务压测基线
→ Critical：限流与P99/SLO燃烧或队列增长同时发生
```

告警模板至少提供：

- 集群、Namespace、Pod、Container和Node；
- 当前limit、request和CPU使用量；
- 限流周期比例与时间速率；
- 同时段P99、QPS、线程池队列和GC；
- 最近发布与扩缩容；
- 指向本篇Runbook的链接。

不要为所有工作负载设置同一个5%或10%阈值。先用历史数据计算正常分布，再用压测确认从什么位置开始违反SLO。

### 19.3 对PromQL做规则测试

需要覆盖：

- Counter重启归零；
- 没有quota导致指标缺失；
- Pause容器和空container标签；
- 多副本聚合；
- Pod重建和名称变化；
- 采集间隔变化和短时缺点；
- 多集群同名Namespace/Pod。

否则告警可能把监控缺失、短命容器或标签碰撞误判为限流恢复。

## 20. 修复后的验收

变更前后使用相同镜像、请求分布、压测工具和节点规格，至少对比：

| 维度 | 必须记录 |
| --- | --- |
| 业务 | 最大稳定QPS、P50/P95/P99/P999、错误率、超时 |
| CPU | 使用核数、limit、request、限流比例、限流时间、PSI |
| JVM | GC wall/CPU、Safepoint、线程池、JIT |
| 节点 | 节点利用率、run queue、上下文切换、软中断 |
| 成本 | 单Pod容量、副本数、节点密度、故障余量 |
| 稳定性 | 长稳测试、滚动发布、单副本故障、节点故障 |

修复通过标准不是 `nr_throttled=0`，而是：

```text
在目标峰值与故障容量下
→ P99满足SLO
→ 错误预算消耗可接受
→ 限流不再命中请求关键路径
→ 节点和下游仍有安全余量
→ 成本处于可接受范围
```

## 21. 与AI Infra的关系

CPU限流不只影响Java接口。在大模型推理Pod中，CPU还可能负责：

- HTTP/gRPC请求解析；
- Tokenizer和模板处理；
- vLLM/SGLang调度器；
- Python控制线程；
- 数据拷贝与Pinned Memory准备；
- NCCL/HCCL控制路径；
- 指标、日志和Sidecar。

CPU控制线程被周期性限流时，GPU/NPU可能等待下一批输入，表现为：

```text
设备利用率只有30%
+ TTFT/P99升高
+ 请求队列增长
+ 显存仍然占满
+ 没有设备错误
```

此时不要看到GPU利用率低就只调batch或增加副本。应把CPU throttling、调度循环、Tokenizer、网关和设备时间线一起分析。

## 22. 快速排障Runbook

```text
P99突然升高
  ↓
确认具体Pod、Container、Node、版本和时间窗
  ↓
读取实际request/limit与LimitRange
  ↓
计算故障窗口内CPU throttling增量
  ↓
对齐P99、QPS、线程池、GC、依赖和节点压力
  ↓
检查容器与父级cgroup，排除层级限流
  ↓
Canary修改CPU策略，保持其他变量可比
  ↓
限流、队列和P99同时恢复？
  ├─ 是：确认CPU配额是关键因果因素
  └─ 否：回到锁、GC、网络、DB、IO和下游依赖
  ↓
选择limit、无limit、扩容、独占核或应用优化
  ↓
压测、长稳、故障容量和成本验收
```

现场清单：

- [ ] CPU图的统计对象、分母和窗口已经确认
- [ ] Pod UID、Container ID和Node已经记录
- [ ] 实际request/limit与模板、LimitRange已经对比
- [ ] cgroup版本、CRI和cgroup driver已经确认
- [ ] 容器与父级 `cpu.stat` 已读取
- [ ] 使用Counter增量而不是累计绝对值
- [ ] Prometheus限流比例、限流时间和CPU使用已对齐
- [ ] P99、QPS、队列、GC和下游时间线已对齐
- [ ] Canary只改变一个主要变量
- [ ] 修复后同时验收SLO、节点密度和故障余量
- [ ] 告警阈值来自基线，不是照抄固定百分比

## 23. 复盘结论

这次故障中，真正误导人的不是监控“错了”，而是观察尺度不一致：

```text
节点图回答：整台机器平均忙不忙
容器CPU图回答：某个窗口平均用了多少CPU
cpu.stat回答：配额周期中是否被限制
业务P99回答：最慢那部分请求等待了多久
```

只有把这些指标放到同一实例、同一时间轴和同一负载下，才能从“CPU正常但服务很慢”走到可验证的根因。

最终需要记住三句话：

1. 节点有空闲CPU，不代表容器能够突破自己的CPU limit；
2. 发生过限流，不代表限流一定造成了本次P99；
3. 相关性提出假设，受控变更实验才确认因果。

## 24. 参考资料

- [Kubernetes：Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
- [Kubernetes：Control CPU Management Policies on the Node](https://kubernetes.io/docs/tasks/administer-cluster/cpu-management-policies/)
- [Linux Kernel：CFS Bandwidth Control](https://www.kernel.org/doc/html/latest/scheduler/sched-bwc.html)
- [Linux Kernel：Control Group v2](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html)
- [cAdvisor：Prometheus CPU CFS metrics](https://github.com/google/cadvisor/blob/master/lib/metrics/prometheus.go)
