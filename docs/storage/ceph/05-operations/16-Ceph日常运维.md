---
title: "Ceph 日常运维实战：巡检、变更、维护与恢复观察"
sidebar_label: "16. Ceph 日常运维实战：巡检、变更、维护与恢复观察"
sidebar_position: 16
tags: [Ceph, 学习路线, 存储, 运维, cephadm]
description: "建立 Ceph 日常运维方法，覆盖状态、容量、OSD、Pool、PG、配置、主机维护、扩缩容、故障盘更换和恢复验收。"
---

# Ceph 日常运维实战：巡检、变更、维护与恢复观察

《Ceph 从零基础到生产运维实战》第 16 篇

← [第 15 篇：Ceph 接入 Kubernetes](../04-client-usage/15-Ceph接入Kubernetes.md)

Ceph 的日常运维不是每天执行一串命令，然后确认输出里有 `HEALTH_OK`。

真正的目标是：

- 尽早发现容量、硬件和性能趋势
- 理解每个异常影响了哪些业务
- 在变更前识别风险
- 在变更中观察数据保护状态
- 在变更后验证控制面、数据面和业务面
- 为故障排查保留可靠基线

本文面向 cephadm 管理的较新 Ceph 集群。不同 Ceph 版本的命令选项和编排器行为可能不同，生产操作必须先查看当前版本帮助并在测试环境验证。


## 本文目标

完成本文后，你应该能够：

- 按固定顺序读取 `ceph -s`
- 判断容量是总量不足还是分布不均
- 查看 OSD 的进程状态、CRUSH 状态和物理设备
- 识别正常恢复与真正卡住的 PG
- 安全查看和修改 Ceph 配置
- 使用 cephadm 编排 OSD 与 Host
- 区分主机维护、Host Drain 和永久退役
- 为扩容、换盘和维护建立验收标准

## 先建立运维原则

### 先读后写

处理告警时先执行只读命令，保存现场，再决定是否需要改变集群。

### 一次只改变一个主要变量

同时调恢复参数、重启 OSD、修改 CRUSH Rule 和扩容，会让你无法判断哪个动作有效，也更难回退。

### 先看业务影响，再看健康颜色

同样是 `HEALTH_WARN`：

- 一条 crash 归档告警可能没有实时业务影响
- `PG_AVAILABILITY` 可能意味着部分数据已经不可访问
- `OSD_NEARFULL` 可能正在逼近写入停止

严重程度不能只由颜色决定。

### 维护结束不等于服务恢复

必须同时验证：

1. 控制面正常
2. 数据冗余恢复
3. RBD、CephFS 或 RGW 真实业务操作成功
4. 性能回到可接受基线
5. 临时 flag、静默和维护标记已经清理

## 日常状态读取顺序

建议每次都按同一顺序：

```text
集群总览
→ 健康详情
→ 守护进程与主机
→ OSD 和 PG
→ 容量与分布
→ 服务接口
→ 业务探测
```

第一轮命令：

```bash
date -Is
ceph -s
ceph health detail
ceph orch status
ceph orch host ls
ceph orch ps --refresh
ceph osd tree
ceph pg stat
ceph df detail
```

`--refresh` 会请求编排器刷新 daemon 状态，可能比缓存结果更慢，不需要在高频脚本中无节制调用。

## `ceph -s` 状态解读

典型输出包含：

```text
cluster:
  id:
  health:

services:
  mon:
  mgr:
  mds:
  osd:
  rgw:

data:
  pools:
  objects:
  usage:
  pgs:

io:
  client:
  recovery:
```

### cluster

确认：

- FSID 是否为目标集群
- 健康级别是 OK、WARN 还是 ERR
- 当前终端是否连错环境

在多集群环境中，执行写操作前先确认 FSID：

```bash
ceph fsid
```

### services

重点读取：

- MON 是否形成预期 Quorum
- MGR 是否有 Active 和 Standby
- OSD 的 `up/in` 数量是否一致
- CephFS 的 MDS 是否 Active，是否有 Standby
- RGW daemon 数量是否符合 placement

### data

关注：

- Pool 和 PG 数量是否突变
- 对象数量是否异常增长
- PG 是否 `active+clean`
- 是否存在 inactive、unknown、stale、inconsistent、undersized 或 degraded

### io

同时看客户端和恢复流量。如果恢复吞吐很高但业务延迟恶化，需要评估恢复 QoS；如果 PG 长期处于恢复状态但 recovery 吞吐接近零，则可能被容量、网络、磁盘或调度限制阻塞。

## 健康详情怎么读

```bash
ceph health detail
```

处理每条健康检查时记录：

| 字段 | 示例 |
| --- | --- |
| Health Check | `OSD_DOWN` |
| 首次发现 | 2026-08-06 10:15 |
| 影响范围 | osd.12，host ceph06 |
| 业务影响 | 暂无错误，延迟升高 |
| 数据保护 | 128 PG degraded |
| 当前趋势 | recovery 正在推进 |
| 负责人 | 存储值班 |
| 下一次观察 | 10 分钟后 |

不要用 `ceph health mute` 代替修复。确需静默时要设置原因、负责人、到期时间，并确认不会掩盖新的同类故障。

## 查看集群容量

```bash
ceph df
ceph df detail
ceph osd df
ceph osd df tree
```

分别回答：

- 集群整体用了多少
- 各 Pool 有多少逻辑数据和原始占用
- 每个 OSD 利用率是否均衡
- 某个 Host 或设备类是否接近阈值

### 为什么总空闲很多仍会 nearfull

写入由 PG 映射到特定 OSD，不会自动选择全局最空的任意磁盘。因此可能出现：

- 总空闲还有 30%
- 某个 OSD 已经接近 nearfull
- 与该 OSD 相关的 PG 无法继续安全迁移

重点关注分布，而不只看平均值：

```bash
ceph osd df tree
ceph osd utilization
ceph osd pool autoscale-status
ceph balancer status
```

如果 OSD 容量差异大，还要检查：

- CRUSH Weight 是否正确反映磁盘容量
- 是否混入不同容量或设备类
- 是否存在错误的 reweight
- CRUSH Rule 是否只覆盖少量 OSD
- Pool 的目标大小和 PG 是否合理

### 容量运维要看趋势

每天保存：

- 原始已用容量
- 各 Pool 有效数据
- OSD 最大和平均利用率
- 日增长量
- RBD 快照/Trash、CephFS 快照、RGW 版本数据等专项指标

扩容触发点应该早于 nearfull。触发线还要覆盖采购、上架、烧机、数据迁移和最大故障域恢复所需时间。

## 查看 OSD 状态与拓扑

```bash
ceph osd stat
ceph osd tree
ceph osd df tree
ceph orch ps --daemon_type osd --refresh
```

OSD 有两组重要状态：

| 状态 | 含义 |
| --- | --- |
| `up` | OSD 进程可通信 |
| `down` | OSD 当前不可通信 |
| `in` | CRUSH 仍将数据映射给它 |
| `out` | CRUSH 不再把新映射放给它，数据通常需要迁出 |

常见组合：

- `up/in`：正常
- `down/in`：进程不可用，但仍属于数据映射，通常处于故障观察阶段
- `down/out`：不可用且已从数据放置中移出
- `up/out`：进程运行，但不参与正常数据放置

不要看到 `down` 就立即执行 `out`。短暂网络波动或计划重启时，过早 `out` 会触发不必要的数据迁移。

### 定位 OSD 的物理设备

```bash
ceph orch ps --daemon_id 12 --refresh
ceph orch device ls --wide --refresh
ceph device ls-by-daemon osd.12
ceph device info <device-id>
```

在目标 Host 上还可以检查：

```bash
cephadm shell -- ceph-volume lvm list
lsblk -o NAME,SIZE,MODEL,SERIAL,WWN,FSTYPE,MOUNTPOINTS
```

物理操作必须依据序列号、WWN、槽位和 OSD 映射交叉确认，不能只凭 `/dev/sdX`。

## 查看 Pool 和 PG

```bash
ceph osd pool ls detail
ceph osd pool autoscale-status
ceph pg stat
ceph pg dump pgs_brief
```

快速统计非 clean PG：

```bash
ceph pg dump pgs_brief | grep -v active+clean
```

注意这个文本过滤方式适合人工快速查看，不适合稳定自动化。脚本应使用 JSON：

```bash
ceph pg dump --format json-pretty
```

### PG 非 clean 是否一定有故障

不一定。下面这些操作都会产生暂时的恢复状态：

- OSD 重启或故障
- 新增、移除 OSD
- 修改 CRUSH Rule
- 修改 Pool 副本数
- 调整 PG 数量
- Balancer 执行优化

判断重点：

- PG 数量是否持续减少
- recovery/backfill 是否有吞吐
- 是否出现新告警
- 客户端延迟是否可接受
- 是否被 nearfull/backfillfull 阻塞

深入检查单个 PG：

```bash
ceph pg map <pg-id>
ceph pg <pg-id> query
```

不要在不了解数据一致性和副本历史时使用 `pg repair`、`mark_unfound_lost` 或强制修改 acting set。

## 查看集群配置

Ceph 的中央配置数据库是 cephadm 集群的主要配置入口。

查看配置来源：

```bash
ceph config dump
ceph config get global <option>
ceph config show osd.12
ceph config show-with-defaults osd.12
```

修改前记录：

```bash
ceph config get osd <option>
ceph config log
```

设置：

```bash
ceph config set osd <option> <value>
```

回到默认或继承值：

```bash
ceph config rm osd <option>
```

### 配置变更流程

1. 写明问题和目标指标
2. 查当前值、默认值和生效范围
3. 核对当前版本官方文档
4. 在测试集群验证
5. 选择少量 daemon 或业务做灰度
6. 一次只改一个主要变量
7. 观察健康、延迟、吞吐和资源
8. 达不到目标时回退
9. 记录最终值和原因

不要永久保留没有解释的“祖传参数”。升级后还要重新验证这些 override 是否仍然必要。

## 添加 OSD

### 第一步：检查设备

```bash
ceph orch device ls --wide --refresh
```

只有满足条件的设备才会显示为可用，例如没有分区、LVM、文件系统或旧 Ceph 签名。

### 第二步：查看现有 OSD ServiceSpec

```bash
ceph orch ls --service_type osd --export
```

生产环境推荐用明确的 OSDSpec 管理设备选择，而不是直接消费所有空白盘。

示例：

```yaml
service_type: osd
service_id: ssd-data
placement:
  label: osd
spec:
  data_devices:
    rotational: false
```

实际生产还应通过型号、大小、路径或 Host Pattern 缩小范围。保存为 `osd-ssd.yaml` 后先预览：

```bash
ceph orch apply -i osd-ssd.yaml --dry-run
```

确认匹配的 Host 和设备完全正确，再应用：

```bash
ceph orch apply -i osd-ssd.yaml
```

### 第三步：分批观察

```bash
ceph orch ps --daemon_type osd --refresh
ceph osd tree
ceph -s
ceph pg stat
ceph osd df tree
```

大量扩容应分批完成，让每一批进入稳定状态后再继续。自动 OSDSpec 可能在新盘满足条件后立即创建 OSD，操作前必须理解声明式编排行为。

## 移除 OSD

移除 OSD 会迁移数据并消耗容量和性能。

先检查：

```bash
ceph -s
ceph osd df tree
ceph osd safe-to-destroy <osd-id>
ceph orch osd rm status
```

由 cephadm 调度移除：

```bash
ceph orch osd rm <osd-id>
```

观察：

```bash
ceph orch osd rm status
ceph -s
ceph pg stat
```

`--zap`、`--force`、`--replace` 的含义不同，并可能擦除设备或绕过安全等待。除非已经确认目的、设备映射和回退边界，否则不要使用。

需要停止尚未完成的移除任务时，先查看当前版本帮助：

```bash
ceph orch osd rm --help
```

### 移除前的容量问题

“当前还有一份完整副本”不代表“有空间将数据迁移到其他 OSD”。移除前必须确认剩余 OSD：

- 能容纳迁移数据
- 不会触发 backfillfull/full
- 仍满足 CRUSH failure domain
- 恢复期间业务性能可接受

## 更换故障磁盘

换盘流程取决于：

- OSD 是否仍可访问
- 设备是否永久损坏
- 是否需要复用 OSD ID
- 是否为 LVM OSD
- DB/WAL 是否与其他 OSD 共享
- 当前 Ceph 版本是否支持设备替换自动化

第一轮检查：

```bash
ceph health detail
ceph osd tree
ceph orch ps --daemon_id <osd-id> --refresh
ceph device ls-by-daemon osd.<osd-id>
ceph osd safe-to-destroy <osd-id>
```

较新 cephadm 可为符合条件的 LVM OSD 提供设备替换流程：

```bash
ceph orch device replace <host> <device-path>
```

这不是可以盲目执行的通用命令。必须先核对：

- 当前版本是否支持
- `<device-path>` 对应的序列号和槽位
- 是否是共享 DB/WAL 设备
- 编排器给出的影响范围
- 副本与容量是否安全

详细换盘流程见：


## 添加服务器

先完成操作系统、时间、网络、容器运行时和磁盘验收，再加入编排器：

```bash
ceph cephadm get-pub-key > ceph.pub
ssh-copy-id -f -i ceph.pub root@ceph11
ceph orch host add ceph11 10.10.10.21
```

如果生产环境使用非 root SSH 用户或自定义 SSH 配置，应遵循现有 cephadm 管理模型，不要直接照抄示例。

添加标签：

```bash
ceph orch host label add ceph11 osd
```

验证：

```bash
ceph orch host ls
ceph orch device ls --hostname ceph11 --wide --refresh
```

加入 Host 不代表应该立即创建 OSD。先确认 CRUSH Location、网卡、设备序列号、时间同步和 OSDSpec 匹配结果。

## 移除服务器

永久退役 Host 与短时维护完全不同。

退役前确认：

- 最大故障域容量已经重新计算
- 所有 OSD 数据可以安全迁移
- MON、MGR、MDS、RGW 等服务 placement 已移出
- Host 标签和 ServiceSpec 不会重新部署 daemon
- 没有客户端、监控或自动化依赖该 Host

先导出 ServiceSpec：

```bash
ceph orch ls --export
```

更新 placement 后再执行 Drain：

```bash
ceph orch host drain ceph11
```

持续观察：

```bash
ceph orch host ls
ceph orch ps --hostname ceph11 --refresh
ceph orch osd rm status
ceph -s
```

只有 daemon 已清理、数据恢复完成且引用全部解除后，才移除 Host：

```bash
ceph orch host rm ceph11
```

不要随意给 Drain 加擦盘选项。数据擦除应有独立审批和设备身份复核。

## 主机维护模式

计划重启、升级固件或更换非 OSD 硬件时，使用维护模式让 cephadm 进行安全检查并抑制不必要的重新调度。

### 维护前

```bash
ceph -s
ceph health detail
ceph orch ps --hostname ceph05 --refresh
ceph osd ok-to-stop <osd-id-list>
```

检查：

- 当前是否已有故障
- 停止该 Host 是否影响 MON Quorum
- 停止其 OSD 是否让 PG 不可用
- 是否还有足够的 MDS、MGR 和 RGW 实例
- 维护预计多久

进入维护：

```bash
ceph orch host maintenance enter ceph05
```

如果安全检查不通过，不要直接使用强制选项。先理解编排器拒绝的原因。

完成主机操作并确认系统稳定后退出：

```bash
ceph orch host maintenance exit ceph05
```

### 维护后

```bash
ceph orch host ls
ceph orch ps --hostname ceph05 --refresh
ceph osd tree
ceph -s
ceph pg stat
```

再执行真实业务探测，例如：

- RBD 创建、写入、读取和删除测试对象
- CephFS 创建、读取、重命名和删除测试文件
- RGW PUT、GET、HEAD 和 DELETE 测试对象

### Maintenance 与 Drain 的区别

| 操作 | 目的 | 数据迁移 |
| --- | --- | --- |
| Maintenance | 主机短时停机后原样回来 | 通常避免不必要迁移 |
| Drain | 永久退役 Host 或迁走 daemon | OSD 数据需要迁出 |

不要使用 Drain 代替一次短时重启，也不要使用 Maintenance 掩盖永久故障。

## 数据均衡与恢复进度

查看：

```bash
ceph -s
ceph pg stat
ceph progress
ceph osd df tree
ceph balancer status
```

判断恢复是否健康：

- degraded/undersized PG 数量总体下降
- recovery/backfill 有稳定吞吐
- 没有新增 inactive 或 inconsistent
- OSD 延迟和客户端延迟可接受
- 没有 nearfull/backfillfull
- OSD 和主机没有反复 flapping

### 恢复慢不等于卡死

恢复可能受这些因素限制：

- 源盘和目标盘性能
- 网络超售或丢包
- OSD CPU 和内存
- mClock QoS
- backfillfull
- CRUSH 约束
- 故障盘仍在反复上线
- 业务高峰主动限制后台任务

在增大恢复并发前，先定位瓶颈。如果瓶颈是目标盘或网络，盲目增加并发只会进一步推高业务延迟。

### Balancer

```bash
ceph balancer status
ceph balancer eval
```

Balancer 适合改善 CRUSH 允许范围内的数据分布，但不能解决：

- 原始容量不足
- CRUSH failure domain 设计错误
- 设备类容量不足
- 磁盘性能严重不一致
- 错误的 Pool 目标或业务模型

启用或执行优化前要理解当前 balancer mode，并避免与手工 reweight、upmap 脚本互相冲突。

## OSD Flags 管理

查看：

```bash
ceph osd dump | grep flags
```

常见 flag 如 `noout`、`norebalance`、`nobackfill`、`norecover` 会改变集群恢复行为。

运维原则：

- 只在明确场景下设置
- 记录设置时间、原因和负责人
- 尽量限制作用范围
- 设置到期提醒
- 操作结束立即清理

长期遗留的 `noout` 可能让永久故障 OSD 的数据迟迟不迁移；长期禁止恢复可能让集群在下一次故障时失去更多冗余。

## 日常巡检周期

### 每日

- `ceph -s` 和健康详情
- MON Quorum、MGR 主备
- OSD up/in 与 Host 在线状态
- 非 clean PG 与恢复趋势
- 集群、Pool 和 OSD 容量
- Crash、慢请求和硬件错误
- RBD/CephFS/RGW 业务探测
- 前一天变更后的指标偏移

### 每周

- 容量增长和扩容提前量
- OSD 利用率离散程度
- scrub/deep-scrub 是否积压
- PG autoscaler 和 balancer 状态
- Cephadm Host/daemon 漂移
- 磁盘 SMART/NVMe 健康趋势
- 备份任务与恢复抽样
- 长期健康静默和 OSD flags

### 每月

- 版本和安全公告评估
- Secret、证书和 keyring 轮换计划
- 故障域与硬件资产核对
- 恢复时间与容量预算复算
- 监控规则、Runbook 和联系人演练
- 随机选择备份执行真实恢复
- 复查手工配置 override

## 一次标准变更

### 变更前

- 记录 FSID、版本、健康和容量基线
- 定义业务影响和维护窗口
- 评估最坏失败模式
- 明确停止条件和回退路径
- 确认监控、人员和通知渠道
- 确认没有其他大规模恢复或变更

### 变更中

- 一次只执行一个阶段
- 每个阶段保存时间和输出
- 持续观察数据保护与业务 SLI
- 达到停止条件立即暂停
- 不在压力下临时叠加未经验证的命令

### 变更后

- 所有 daemon 达到目标状态
- PG 恢复到接受标准
- 容量和分布符合预期
- 三种存储接口按实际使用范围完成业务验证
- 临时 flag、静默、标签和维护模式已清理
- 记录实际耗时、异常和后续改进

## 常见错误

### 只看 `HEALTH_OK`

业务可能已经出现高延迟、局部路径错误或容量增长异常。

### 看到 OSD down 就立即 out

短暂故障会被放大为全量数据迁移。

### 直接登录 Host 管理容器

使用 `podman restart` 等底层动作可能绕过 cephadm 的期望状态和审计。优先使用 `ceph orch daemon`、`reconfig` 或 `redeploy`。

### 同时扩容和大规模调参

恢复效果和性能变化无法归因。

### 长期设置 noout

它会推迟必要的数据迁移，使风险在表面平静中累积。

### 自动消费所有空白盘

新插入的维修盘、临时盘或错误识别设备可能被立刻创建为 OSD。

### 运维完成后不做业务验证

daemon 存活不代表 CephFS 路径、RBD Image 或 S3 API 一定可用。

## 值班速查清单

### 发现异常

```bash
date -Is
ceph -s
ceph health detail
ceph orch ps --refresh
ceph osd tree
ceph pg stat
ceph df detail
```

### 做决定前

- 影响哪个 Pool 和业务
- 数据是否仍有足够副本
- 问题是否继续扩大
- 当前动作会不会触发迁移
- 剩余容量能否完成迁移
- 是否需要事故升级和业务限流

### 恢复完成

- [ ] MON Quorum 正常
- [ ] MGR 主备正常
- [ ] OSD 达到预期 up/in
- [ ] PG 达到约定状态
- [ ] 无未知容量风险
- [ ] 恢复吞吐归零或任务明确结束
- [ ] 真实业务探测成功
- [ ] 临时 flag 和静默已清理
- [ ] 时间线和操作记录完整

## 本文小结

Ceph 日常运维的核心不是记忆更多命令，而是建立稳定的工作方法：

```text
读取状态
→ 判断影响
→ 保存证据
→ 评估数据保护和容量
→ 做最小变更
→ 观察恢复趋势
→ 验证真实业务
→ 清理临时措施并记录
```


下一篇将把这些状态、指标和业务探测接入 Prometheus、Grafana 与告警系统。

→ [第 17 篇：Ceph 监控告警](./17-Ceph监控告警.md)

## 课后练习

1. `up/down` 与 `in/out` 分别表示什么？
2. 为什么总容量还有空间也会触发 nearfull？
3. 主机 Maintenance 和 Drain 有什么区别？
4. 为什么短时 OSD down 不应该立即 out？
5. 设计一次三节点滚动重启的检查点和停止条件。
6. 为扩容 10 块盘编写分批计划和每批验收标准。
7. 找出集群所有 OSD flags，并解释它们的设置原因和清理条件。
8. 编写一个只读巡检脚本，将核心命令保存为带时间戳的 JSON。

## 官方资料

- [Cephadm Operations](https://docs.ceph.com/en/latest/cephadm/operations/)
- [Cephadm Host Management](https://docs.ceph.com/en/latest/cephadm/host-management/)
- [Cephadm OSD Service](https://docs.ceph.com/en/latest/cephadm/services/osd/)
- [Monitoring OSDs and PGs](https://docs.ceph.com/en/latest/rados/operations/monitoring-osd-pg/)
- [Ceph Health Checks](https://docs.ceph.com/en/latest/rados/operations/health-checks/)
- [Monitoring a Ceph Cluster](https://docs.ceph.com/en/latest/rados/operations/monitoring/)
