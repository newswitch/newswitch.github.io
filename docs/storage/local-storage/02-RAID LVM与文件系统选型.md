---
title: "RAID、LVM 与文件系统选型"
sidebar_position: 2
tags: [RAID, LVM, ext4, XFS, 文件系统, NVMe, 容量规划]
description: "从故障模型、性能、扩容与恢复出发选择 RAID、LVM、ext4/XFS，并设计 AI 节点本地盘布局。"
---

# RAID、LVM 与文件系统选型

一台 GPU 服务器有多块 NVMe 时，常见问题是：做 RAID0、RAID1，还是每盘独立？是否需要 LVM？ext4 还是 XFS？模型缓存、容器数据、日志和 Checkpoint staging 是否应该放在一起？

选型不能从命令开始，而要从数据价值、故障模型和恢复流程开始。

## 1. 先给数据分类

| 数据 | 是否可重建 | 性能需求 | 建议方向 |
|---|---|---|---|
| 模型节点缓存 | 是，可从制品库重新拉取 | 大文件读、冷启动 | 独立 NVMe/条带，水位治理 |
| 训练数据缓存 | 是 | 高吞吐、多流 | 多盘分片或条带 |
| Checkpoint staging | 暂时不可丢，最终上传 | 大写入、提交 | 冗余/及时上传/完整性 |
| 容器镜像与 writable layer | 可重建但影响节点 | 小随机混合 | 独立容量与 inode 监控 |
| kubelet/日志 | 部分重要 | 小写、容量波动 | 与大模型缓存隔离 |
| 唯一业务数据 | 否 | 取决于业务 | 不应只放单节点本地盘 |

同一物理盘同时承担模型下载、容器 GC、日志和 Checkpoint，任何一个突发都可能拖慢其他路径。

## 2. RAID 解决什么、不解决什么

RAID 将多个块设备组合为逻辑设备，目标可能是容量、吞吐或设备故障冗余。

### 2.1 RAID0

数据条带化到多盘：

```text
block 0 → disk 0
block 1 → disk 1
block 2 → disk 0
block 3 → disk 1
```

- 容量约为各盘之和；
- 顺序/并行吞吐可提高；
- 任意一盘失败会破坏整个阵列；
- 适合完全可重建缓存；
- 不是“没有数据价值也无风险”：重建缓存会造成回源风暴和业务冷启动。

### 2.2 RAID1

同一数据写入镜像盘：

- 可容忍一部分设备故障；
- 读取可并行，写入需多副本完成；
- 可用容量约为一半（两盘镜像）；
- 不是备份：误删除、软件破坏和勒索会同步到所有镜像。

### 2.3 RAID10

镜像组再条带，兼顾并行与冗余：

- 至少需要多盘；
- 可用容量通常约一半；
- 能否容忍多盘失败取决于失败是否落在同一镜像组；
- 重建和故障状态性能仍需测试。

### 2.4 RAID5/6

使用分布式校验提高容量效率，但写入涉及 read-modify-write 或 full-stripe，重建压力和写放大更复杂。对低延迟、高写入 NVMe 工作负载必须认真评估 Controller/软件 RAID、掉电一致性、写洞和重建窗口。

本文不提供“一律不能用”或“一律可用”的结论；以数据保护目标、设备数、写入模型和故障重建测试决定。

## 3. RAID 不是备份与高可用系统

RAID 主要处理单机设备故障，不能自动解决：

- 节点主板、电源或整机故障；
- 机架/机房故障；
- 文件误删除；
- 数据逻辑损坏；
- 软件/固件共同缺陷；
- 操作系统无法启动；
- 灾难恢复和跨站点 RPO。

AI 训练的最终 Checkpoint 应提交到共享/对象存储；本地 RAID 只能作为 staging 或缓存层。

## 4. 软件 RAID 的数据路径

Linux md RAID：

```text
文件系统
→ /dev/mdX
→ md RAID personality
→ /dev/nvme0n1 + /dev/nvme1n1 ...
```

只读识别：

```bash
cat /proc/mdstat
mdadm --detail /dev/<md-device>
lsblk -o NAME,TYPE,SIZE,FSTYPE,MOUNTPOINTS
```

创建/停止/重建阵列均是高风险写操作，必须先确认设备序列号、数据状态和恢复方案。

## 5. 条带大小如何影响性能

条带（chunk/stripe unit）决定连续数据如何跨盘分布。考虑：

- 业务 I/O 大小；
- 文件系统 allocation unit；
- 设备内部写入特征；
- 多线程并行；
- 是否需要 full-stripe write；
- Checkpoint 分片大小。

大顺序模型读取可从多盘条带受益；小随机写如果跨多个成员，可能增加放大。不要仅凭一个“推荐 chunk size”，应使用业务负载矩阵测试。

## 6. LVM 提供什么

LVM 把物理设备抽象为：

```text
PV (Physical Volume)
  → VG (Volume Group)
  → LV (Logical Volume)
  → filesystem
```

能力包括：

- 从同一容量池划分多个逻辑卷；
- 在线扩展 LV；
- 条带/镜像/RAID 类型；
- thin provisioning；
- snapshot；
- 统一设备命名和管理。

查看：

```bash
pvs
vgs
lvs -a -o +devices,segtype,data_percent,metadata_percent
lsblk
```

## 7. LVM 的风险边界

### 7.1 扩容不等于文件系统自动扩容

```text
扩底层设备/PV
→ 扩 VG/LV
→ 扩文件系统
```

每一步支持和命令取决于栈。缩容风险更高，XFS 等文件系统不支持通用在线缩小，不能假定 LV 缩小后文件系统自动适配。

### 7.2 Thin Provisioning

thin LV 的逻辑容量可以超过物理池，但 data 或 metadata pool 满可能造成 I/O 失败、只读或严重恢复问题。必须监控：

- `data_percent`；
- `metadata_percent`；
- 自动扩容是否实际工作；
- 快照增长；
- 后端真实容量。

PVC/容器层看到有空间，不代表 thin pool 有物理空间。

### 7.3 Snapshot

LVM snapshot 不是长期备份。CoW 写入会带来空间和性能开销；origin 与 snapshot 仍可能处于同一故障域。

## 8. 是否需要 LVM

适合：

- 需要把盘分成容器、日志、缓存不同 LV；
- 需要受控扩容；
- 运维团队已有监控、备份和恢复能力；
- 需要为不同用途设置明确容量边界。

不一定需要：

- 每块盘直接作为独立 Local PV；
- 节点缓存完全可重建且布局简单；
- 额外抽象只增加故障定位复杂度；
- 云平台已提供等价卷管理。

简单不是落后。能解释、能恢复、能自动化比层数多更重要。

## 9. ext4 与 XFS 的共同基础

两者都是成熟 Linux 文件系统，均支持 journaling、extent、扩展属性和大文件。选型前先问：

- 主要是大文件还是海量小文件？
- 单卷最大容量、目录规模和 inode 需求？
- 是否需要在线扩展或缩小？
- 发行版和工具链默认支持哪个？
- 备份、修复和团队经验是什么？
- 容器运行时/CSI/厂商是否有支持矩阵？
- 是否需要 project quota、reflink 或特定功能？

## 10. ext4 的考虑点

常见优点：生态广、工具成熟、中小卷和通用场景简单。设计时关注：

- 创建文件系统时的 inode 数量/比例；
- journal 与 data mode；
- 大目录和 extent；
- 在线扩展、离线缩小的支持与风险；
- mount 参数；
- `fsck` 的维护窗口。

不能用 `df -h` 替代 `df -i`。容器或小文件数据可能先耗尽 inode。

## 11. XFS 的考虑点

XFS 擅长大文件、并行 I/O 和大容量文件系统，支持 allocation group、project quota 等。注意：

- 通常支持在线扩展，但不应假定可缩小；
- repair 需要明确停机/救援流程；
- reflink、quota 等功能要在 mkfs/mount 与版本层面确认；
- allocation group 数量和并行性由创建参数与设备大小等决定；
- 空间接近满时性能和碎片也可能恶化。

“大文件用 XFS、小文件用 ext4”只是粗略起点，最终取决于版本、配置和负载实测。

## 12. 文件系统挂载参数

常见选项如 `noatime`、discard、barrier/flush 相关策略、日志模式等会影响性能与语义。原则：

1. 从发行版和文件系统默认值开始；
2. 明确要解决的瓶颈；
3. 查当前版本官方文档；
4. 在隔离环境单变量测试；
5. 验证断电/崩溃恢复与数据语义；
6. 记录到自动化基线。

不要复制旧文章里的 `nobarrier` 等高风险选项。现代设备和文件系统的正确性依赖 flush/barrier 语义。

## 13. discard/TRIM

文件删除后，discard 可通知 SSD 相应 LBA 不再使用，帮助设备管理空间。方式包括：

- 挂载时在线 discard；
- 周期性 `fstrim`。

不同设备和工作负载的延迟影响不同。先检查支持：

```bash
lsblk -D
systemctl status fstrim.timer
```

LVM、dm-crypt、RAID 和虚拟化层都必须正确透传才生效。执行前确认设备与栈支持。

## 14. 容量边界要分层监控

```text
物理 SSD capacity/health
→ RAID usable/degraded/rebuild
→ PV/VG free
→ thin pool data/metadata
→ LV size
→ filesystem blocks/inodes
→ project/user quota
→ Kubernetes ephemeral-storage/PV
→ 应用缓存水位
```

只监控最上层 `df` 会漏掉 thin pool、RAID degraded、SSD spare 和 inode。每层都要有告警与恢复步骤。

## 15. AI 节点建议布局方法

示例思路，不是固定答案：

```text
OS disk
  └─ 系统与最小日志

container disk/LV
  └─ containerd images + writable layers

model-cache NVMe(s)
  └─ /var/lib/model-cache
     可重建，可选 RAID0/每盘分片

checkpoint-staging LV/RAID
  └─ /var/lib/checkpoints
     空间与写入受控，及时上传
```

隔离目标：

- 模型下载不会填满根盘；
- 容器镜像 GC 不会删除模型缓存；
- Checkpoint 写入不阻塞 kubelet/日志；
- 盘故障只影响明确节点/缓存；
- 每个挂载有容量、inode、延迟和健康监控。

## 16. Local PV 与 RAID/LVM

Kubernetes Local PV 把本地路径/设备暴露为 PV，并通过 node affinity 固定到节点。下层可以是：

- 单独分区/文件系统；
- LVM LV；
- md RAID 设备；
- 由 local storage operator 管理的卷。

Local PV 的 `Retain`、清理、节点丢失和重新供给流程必须明确。RAID1 只能在节点仍可用时处理成员盘故障，无法让卷跨节点迁移。

已有实践见[本地 NVMe 与 Local PV](../ai-workloads/03-本地NVMe与Local-PV实践.md)。

## 17. 故障场景设计

### 17.1 单盘失败

- RAID0：整个缓存卷不可用，触发节点隔离和重建；
- RAID1/10：进入 degraded，业务可能继续但需更换成员并监控 rebuild；
- 独立盘：只影响相应挂载/Local PV。

### 17.2 文件系统满

检查 blocks、inode、reserved、quota、deleted-but-open files：

```bash
df -hT <mount>
df -i <mount>
lsof +L1
du -x -h -d 1 <mount>
```

大目录执行 `du` 可能产生显著 I/O，生产使用需控制范围和时机。

### 17.3 thin pool 满

上层 `df` 可能仍有空间。检查 `lvs` 的 data/metadata percent，按预案扩池或释放快照。不要直接删除未知 LV。

### 17.4 RAID 重建拖慢服务

重建会竞争读写与 CPU。需要在验收时测 degraded/rebuild 下的 P99，并决定是否临时降低节点负载或隔离 GPU 作业。

### 17.5 文件系统错误

先保存内核日志与设备健康，隔离节点，按 ext4/XFS 官方恢复流程在正确状态下检查。不要对已挂载读写文件系统随意运行修复命令。

## 18. 选型决策示例

### 18.1 两块盘做模型缓存

数据可从对象存储重建，目标是最快冷启动：可以评估 RAID0 或应用按盘分片。必须接受任一盘坏导致缓存整体/部分重建，并控制回源风暴。

### 18.2 本地 Checkpoint staging

Checkpoint 在上传对象存储前不能丢：可用 RAID1/10、同步写和快速上传；若 RPO 不允许本地节点故障丢失，就不能把本地 staging 当提交完成。

### 18.3 容器数据与模型混盘

小规模实验可简化，但生产最好有容量或卷隔离。至少设置 kubelet eviction、水位、inode、containerd GC 与缓存淘汰的协同。

## 19. 验收矩阵

| 维度 | 用例 |
|---|---|
| 性能 | 单盘、聚合、QD/块大小、持续写、P99 |
| 容量 | block/inode/thin pool/缓存水位告警 |
| 故障 | 单盘、degraded、rebuild、节点重启 |
| 正确性 | fsync/Checkpoint 提交、文件 checksum |
| 恢复 | 阵列成员更换、文件系统检查、缓存重建 |
| Kubernetes | Local PV 绑定、Pod 重建、节点丢失 |
| 隔离 | 模型下载/Checkpoint 不影响 kubelet 和日志 |

## 20. 常见误区

1. **RAID 等于备份。**无法防误删、整机故障和逻辑损坏。
2. **RAID0 只影响可靠性，不影响运维。**重建会产生大规模回源和冷启动。
3. **LVM 自动提供冗余。**普通线性 LV 并没有副本。
4. **thin LV 有多大就能写多大。**底层 pool 可能先满。
5. **文件系统还有空间就一切正常。**inode、thin metadata、SSD spare 可能耗尽。
6. **XFS/Ext4 有绝对赢家。**版本、配置、工具和负载更重要。
7. **Local PV 有 RAID 就能跨节点 HA。**仍绑定单节点。
8. **提高 dirty cache 可解决写性能。**可能只是推迟并放大回写尖峰。

## 21. 掌握标准

应能：

- 根据可重建性与 RPO 选择单盘、RAID0、RAID1/10 或共享存储；
- 解释 RAID degraded 与 rebuild 对性能和风险的影响；
- 画出 PV—VG—LV—文件系统层次；
- 监控 thin pool data/metadata 而不只看 `df`；
- 按大文件、小文件、同步写和恢复能力选择 ext4/XFS；
- 设计 OS、containerd、日志、模型缓存和 staging 隔离；
- 给出单盘故障、盘满和文件系统错误的安全恢复流程；
- 用业务负载验证选型，而不是只引用产品特性。

## 参考资料

- [Linux MD documentation](https://docs.kernel.org/admin-guide/md.html)
- [LVM documentation](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/configuring_and_managing_logical_volumes/)
- [XFS documentation](https://docs.kernel.org/filesystems/xfs/index.html)
- [ext4 documentation](https://docs.kernel.org/filesystems/ext4/)
- [Linux Local Persistent Volumes](https://kubernetes.io/docs/concepts/storage/volumes/#local)
