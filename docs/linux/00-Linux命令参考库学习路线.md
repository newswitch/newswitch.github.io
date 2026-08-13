---
title: Linux 命令参考库：从命令行入门到生产故障排查
sidebar_position: 1
description: 按命令来源和使用场景分类学习 Linux 常用命令，每篇完整讲解一个命令的语法、长短参数、输出、风险、实验与生产排障方法。
tags: [Linux, 命令参考, GNU coreutils, SRE, 学习路线]
---

# Linux 命令参考库：从命令行入门到生产故障排查

这套参考库不把命令写成一张速查表，而是把每个命令拆成一篇可以独立学习和查询的技术文章。目标不仅是知道“参数怎么写”，还要理解命令观察或改变了什么内核对象、输出应该怎样判断、失败后从哪里继续排查。

## 1. 收录边界

“Linux 原生命令”不是一个严格的软件包名称。一个常见生产系统至少包含以下几类实现：

| 来源 | 代表命令 | 主要领域 |
|---|---|---|
| Bash Builtin | `cd`、`read`、`export`、`jobs` | Shell 状态与脚本 |
| GNU coreutils | `ls`、`cp`、`mv`、`rm`、`sort` | 文件、文本和基本系统操作 |
| util-linux | `lsblk`、`findmnt`、`mount`、`nsenter` | 块设备、挂载、Namespace |
| procps-ng | `ps`、`top`、`free`、`vmstat`、`sysctl` | 进程、内存和内核参数 |
| iproute2 | `ip`、`ss`、`tc`、`bridge` | 网络、路由和流量控制 |
| systemd | `systemctl`、`journalctl`、`loginctl` | 服务和日志 |
| sysstat | `iostat`、`mpstat`、`pidstat`、`sar` | 性能与历史指标 |
| 专用基础工具 | `strace`、`perf`、`tcpdump`、`ethtool` | 深度诊断 |

本系列收录主流 GNU/Linux 服务器中用于日常管理、自动化和 SRE 排障的命令。`kubectl`、`nvidia-smi`、`ceph`、Kafka CLI 等产品专用命令仍放在各自技术模块中，避免边界混乱。目前可直接进入[Kubernetes 与容器命令参考库](../cloud-native/kubernetes/commands/00-Kubernetes与容器命令参考库学习路线.md)、[GPU 与加速器命令参考库](../gpu/commands/00-GPU与加速器命令参考库学习路线.md)、[网络命令参考库](../networking/commands/00-网络命令参考库学习路线.md)、[存储命令参考库](../storage/commands/00-存储命令参考库学习路线.md)和[包含 10 篇命令与实验手册的大数据学习地图](../data-systems/00-大数据技术学习地图.md)。

## 2. 版本与实现约定

命令的参数不是跨版本永久不变。每篇文章都必须写明：

```text
命令名称
命令类型：Shell Builtin 或外部程序
软件包与实现
文档基线版本
如何查看本机版本
如何确认实际执行的是哪个实现
```

coreutils 命令以 **GNU coreutils 9.11** 官方手册为文档基线，`find` 以 **GNU findutils 4.10.0** 为基线，`file` 以 **file 5.46** 手册为基线。本轮账户工具以 **shadow-utils 4.19** 上游手册为基线，身份切换以当前 **util-linux** 手册为基线，提权工具以 **Sudo 1.9.18** 手册为基线；ACL 工具以 2026 年 5 月获取的上游手册为基线。CPU、内存与负载批次以 **procps-ng 4.0.6**、**util-linux 2.42.2**、**sysstat 12.7.9**、**GNU Time 1.10** 和 **Bash 5.3** 为文档基线。systemd 服务、启动与日志批次以 **systemd 260.2** 上游手册源码为完整接口基线。安全批次以 **SELinux userspace 3.11**、**AppArmor 5.0.2**、**libcap 2.78** 与 **Linux Audit userspace 4.1.x** 的上游接口和当前手册为基线。内核与硬件批次以当前 **kmod**、**pciutils 3.15.0**、**dmidecode 3.7**、**numactl**、**util-linux IRQ 工具**、**systemd-udev** 与 **hwloc 2.14** 上游接口为基线。正文会标出老发行版可能缺少的新接口；你的服务器也可能带发行版补丁，因此执行前仍要检查：

```bash
type -a <command>
command -V <command>
<command> --version
<command> --help
man <command>
```

如果命令同时存在 Shell Builtin 和外部实现，例如 `pwd`，文章会分别说明。BusyBox、BSD/macOS 与 GNU 行为不同的地方也会单独标注。

## 3. 每篇文章的固定结构

每个命令都采用同一套结构：

1. 命令用途和观察对象。
2. 来源、版本和实现识别。
3. 完整语法与参数组成。
4. 全部短参数、长参数和参数值。
5. 默认行为、覆盖顺序和环境变量。
6. 输出字段与退出状态。
7. 从入门到生产的示例。
8. 危险操作、竞态条件与兼容性。
9. 常见错误和故障排查。
10. 动手实验、掌握标准和官方参考。

参数表中的“无”表示该选项没有对应的短参数或长参数，不会为了表格整齐而虚构配对。

## 4. 安全分级

- `[R]`：只读观察，不应主动改变目标状态。
- `[W]`：创建或修改文件、进程、网络或系统状态。
- `[D]`：可能删除数据、终止服务、破坏连通性或造成明显性能影响。

同一个命令可能同时包含多种级别，例如 `find` 默认是 `[R]`，但配合 `-delete` 就是 `[D]`。安全级别以具体命令行为准。

## 5. 分类学习路线

```mermaid
flowchart LR
    A["Shell 与帮助系统"] --> B["文件与目录"]
    B --> C["文本处理与查找"]
    C --> D["用户、权限与安全"]
    D --> E["进程、线程与信号"]
    E --> F["CPU、内存与负载"]
    F --> G["systemd 与日志"]
    G --> H["LSM、capabilities 与 Audit"]
    H --> I["网络与 TCP/IP"]
    I --> J["磁盘、文件系统与 IO"]
    J --> K["内核、硬件与模块"]
    K --> L["Namespace 与 cgroup"]
    L --> M["性能分析与故障诊断"]
```

生产 SRE 核心库 v1 已按以下分类全部完成：

1. 命令行、Shell 与帮助系统。
2. 文件与目录。
3. 文件内容、文本处理、查找与统计。
4. 用户、用户组、权限、ACL 与安全上下文。
5. 进程、线程、作业控制与信号。
6. CPU、内存、负载与 `/proc`。
7. systemd 服务、启动过程和日志。
8. SELinux、AppArmor、Linux capabilities 与 Audit。
9. 网卡、地址、路由、TCP、DNS 与抓包。
10. 块设备、文件系统、挂载、LVM、RAID 与 IO；这一类已经建立独立的[存储命令参考库](../storage/commands/00-存储命令参考库学习路线.md)，Linux 路线直接复用，避免重复文章。
11. 内核、模块、PCIe、NUMA、IRQ 与硬件信息。
12. Namespace、cgroup 与容器现场。
13. strace、perf、eBPF 等深度性能和故障诊断工具。
14. Shell 脚本和安全自动化。

v1 共包含 **203 篇核心技术文章、11 篇分类导读和本学习路线**。这里的“完成”指上述有限、可验收的核心范围已经闭环，不表示 Linux 生态中所有可安装命令都已收录；策略工程、发行版专用工具和低频专用命令按实际学习需求进入后续扩展版。

## 6. 已完成：文件与目录

本分类完成二十四篇核心文章，补齐目录观察、创建、复制、移动、删除、链接、路径规范化、遍历查找、文件部署、类型识别、归档、压缩、完整性校验和增量同步闭环：

1. [`pwd`：显示当前工作目录](./commands/01-files-directories/01-pwd命令详解.md)
2. [`ls`：列出目录内容和文件元数据](./commands/01-files-directories/02-ls命令详解.md)
3. [`mkdir`：创建目录](./commands/01-files-directories/03-mkdir命令详解.md)
4. [`rmdir`：删除空目录](./commands/01-files-directories/04-rmdir命令详解.md)
5. [`touch`：创建空文件和修改时间戳](./commands/01-files-directories/05-touch命令详解.md)
6. [`mktemp`：安全创建临时文件和目录](./commands/01-files-directories/06-mktemp命令详解.md)
7. [`cd`：切换工作目录](./commands/01-files-directories/07-cd命令详解.md)
8. [`cp`：复制文件和目录](./commands/01-files-directories/08-cp命令详解.md)
9. [`mv`：重命名和移动文件](./commands/01-files-directories/09-mv命令详解.md)
10. [`rm`：删除文件和目录](./commands/01-files-directories/10-rm命令详解.md)
11. [`ln`：创建硬链接和符号链接](./commands/01-files-directories/11-ln命令详解.md)
12. [`stat`：查询文件与文件系统状态](./commands/01-files-directories/12-stat命令详解.md)
13. [`readlink`：读取符号链接与规范化路径](./commands/01-files-directories/13-readlink命令详解.md)
14. [`realpath`：规范化路径并控制链接策略](./commands/01-files-directories/14-realpath命令详解.md)
15. [`basename`：提取路径末段与删除精确后缀](./commands/01-files-directories/15-basename命令详解.md)
16. [`dirname`：提取路径目录部分](./commands/01-files-directories/16-dirname命令详解.md)
17. [`find`：遍历、测试、表达式、执行与安全删除](./commands/01-files-directories/17-find命令详解.md)
18. [`install`：复制、建目录、权限与部署语义](./commands/01-files-directories/18-install命令详解.md)
19. [`unlink`：删除单个目录项](./commands/01-files-directories/19-unlink命令详解.md)
20. [`file`：文件类型、MIME、magic 与安全检测](./commands/01-files-directories/20-file命令详解.md)
21. [`tar`：归档、元数据、增量与安全解包](./commands/01-files-directories/21-tar命令详解.md)
22. [`gzip/gunzip/zcat`：流压缩、完整性与多成员](./commands/01-files-directories/22-gzip命令详解.md)
23. [`sha256sum`：生成、严格校验与信任边界](./commands/01-files-directories/23-sha256sum命令详解.md)
24. [`rsync`：增量同步、过滤、删除与恢复](./commands/01-files-directories/24-rsync命令详解.md)

## 7. 已完成：文件内容与文本处理

本分类完成二十六篇核心文章：

1. [`cat`：连接文件、显示控制字符与流式复制](./commands/02-file-content-text/01-cat命令详解.md)
2. [`tac`：按记录逆序输出文件](./commands/02-file-content-text/02-tac命令详解.md)
3. [`nl`：逻辑页面、选择性行号与编号格式](./commands/02-file-content-text/03-nl命令详解.md)
4. [`head`：按行、字节与 NUL 记录截取前部](./commands/02-file-content-text/04-head命令详解.md)
5. [`tail`：尾部截取、日志跟踪与轮转语义](./commands/02-file-content-text/05-tail命令详解.md)
6. [`wc`：字节、字符、词、行与最长显示宽度](./commands/02-file-content-text/06-wc命令详解.md)
7. [`cut`：选择字节、字符与字段](./commands/02-file-content-text/07-cut命令详解.md)
8. [`paste`：按列或串行合并记录](./commands/02-file-content-text/08-paste命令详解.md)
9. [`sort`：排序键、locale、外部归并与稳定性](./commands/02-file-content-text/09-sort命令详解.md)
10. [`uniq`：相邻去重、计数与分组输出](./commands/02-file-content-text/10-uniq命令详解.md)
11. [`comm`：比较两个有序集合](./commands/02-file-content-text/11-comm命令详解.md)
12. [`join`：按有序字段连接两个文件](./commands/02-file-content-text/12-join命令详解.md)
13. [`tr`：字符翻译、删除、压缩与补集](./commands/02-file-content-text/13-tr命令详解.md)
14. [`expand`：按制表位把 TAB 转为空格](./commands/02-file-content-text/14-expand命令详解.md)
15. [`unexpand`：按制表位把空白压缩成 TAB](./commands/02-file-content-text/15-unexpand命令详解.md)
16. [`fold`：按显示列、字符或字节折行](./commands/02-file-content-text/16-fold命令详解.md)
17. [`fmt`：段落重排、目标宽度与前缀格式化](./commands/02-file-content-text/17-fmt命令详解.md)
18. [`pr`：分页、多栏、并排合并与打印格式](./commands/02-file-content-text/18-pr命令详解.md)
19. [`split`：按行、字节、记录和分片数量切分](./commands/02-file-content-text/19-split命令详解.md)
20. [`csplit`：按行号、正则上下文与边界切分](./commands/02-file-content-text/20-csplit命令详解.md)
21. [`od`：字节、偏移、端序与数据类型观察](./commands/02-file-content-text/21-od命令详解.md)
22. [`base64`：RFC 4648 编码、解码与安全边界](./commands/02-file-content-text/22-base64命令详解.md)
23. [`grep`：正则、递归、上下文与 NUL 文件名](./commands/02-file-content-text/23-grep命令详解.md)
24. [`sed`：地址、Pattern/Hold Space 与安全原地编辑](./commands/02-file-content-text/24-sed命令详解.md)
25. [`awk/gawk`：记录、字段、数组与安全变量传递](./commands/02-file-content-text/25-awk命令详解.md)
26. [`jq`：JSON 流、Filter、变量与退出状态](./commands/02-file-content-text/26-jq命令详解.md)

本分类已经建立“字节流 → 字符编码 → 记录边界 → 字段选择 → 排序/集合连接 → 字符与显示转换 → 切分/二进制观察 → 正则流编辑 → 字段聚合 → JSON 结构化查询”的完整闭环。

## 8. 已完成：用户、用户组与权限批次

本分类完成二十二个独立命令页面，并建立“身份解析 → 账户生命周期 → 身份切换与授权 → mode/owner/group → 创建掩码 → ACL”的闭环：

1. [`id`：UID、GID、补充组与安全上下文](./commands/03-users-permissions/01-id命令详解.md)
2. [`whoami`：当前有效用户与脚本身份判断](./commands/03-users-permissions/02-whoami命令详解.md)
3. [`groups`：主组、补充组与会话差异](./commands/03-users-permissions/03-groups命令详解.md)
4. [`getent`：通过 NSS 查询用户、组、主机与服务](./commands/03-users-permissions/04-getent命令详解.md)
5. [`useradd`：创建本地账户、默认值与初始文件](./commands/03-users-permissions/05-useradd命令详解.md)
6. [`usermod`：修改 UID、主组、补充组与账户属性](./commands/03-users-permissions/06-usermod命令详解.md)
7. [`userdel`：安全删除账户、home 与残留所有权](./commands/03-users-permissions/07-userdel命令详解.md)
8. [`groupadd`：创建组、分配 GID 与成员初始化](./commands/03-users-permissions/08-groupadd命令详解.md)
9. [`groupmod`：重命名组、迁移 GID 与成员列表](./commands/03-users-permissions/09-groupmod命令详解.md)
10. [`groupdel`：删除组与孤儿 GID 治理](./commands/03-users-permissions/10-groupdel命令详解.md)
11. [`passwd`：密码修改、锁定、状态与老化策略](./commands/03-users-permissions/11-passwd命令详解.md)
12. [`chage`：密码老化、账户过期与时间计算](./commands/03-users-permissions/12-chage命令详解.md)
13. [`su`：登录式身份切换、PAM 与环境边界](./commands/03-users-permissions/13-su命令详解.md)
14. [`runuser`：root 脚本以低权限用户运行命令](./commands/03-users-permissions/14-runuser命令详解.md)
15. [`sudo`：最小授权、环境、凭据缓存与审计](./commands/03-users-permissions/15-sudo命令详解.md)
16. [`visudo`：安全编辑、严格校验与 sudoers 发布](./commands/03-users-permissions/16-visudo命令详解.md)
17. [`chmod`：符号权限、八进制、特殊位与递归安全](./commands/03-users-permissions/17-chmod命令详解.md)
18. [`chown`：所有者迁移、条件变更与符号链接安全](./commands/03-users-permissions/18-chown命令详解.md)
19. [`chgrp`：组所有权、共享目录与递归边界](./commands/03-users-permissions/19-chgrp命令详解.md)
20. [`umask`：新建文件权限、进程继承与默认 ACL](./commands/03-users-permissions/20-umask命令详解.md)
21. [`getfacl`：访问 ACL、默认 ACL 与有效权限](./commands/03-users-permissions/21-getfacl命令详解.md)
22. [`setfacl`：修改、继承、备份与恢复 POSIX ACL](./commands/03-users-permissions/22-setfacl命令详解.md)

本批有意把传统 DAC/POSIX ACL 与 SELinux、AppArmor、Linux capabilities 分层：前者已经完成；LSM、安全上下文变更和 capability 管理将在后续安全模块独立展开。

## 9. 已完成：进程、线程、作业控制与信号批次

本分类完成十九个独立命令页面，并建立“进程快照与选择 → 父子/线程/进程组/session → Shell 作业表 → 信号与等待 → niceness → SIGHUP/session/期限”的闭环：

1. [`ps`：进程选择、线程、状态与自定义字段](./commands/04-processes-signals/01-ps命令详解.md)
2. [`pgrep`：按名称、身份、状态与 namespace 精确找进程](./commands/04-processes-signals/02-pgrep命令详解.md)
3. [`pidof`：按程序名查询 PID 与实现边界](./commands/04-processes-signals/03-pidof命令详解.md)
4. [`pstree`：父子树、线程、进程组与 namespace 迁移](./commands/04-processes-signals/04-pstree命令详解.md)
5. [`jobs`：Shell 作业表、jobspec 与进程组](./commands/04-processes-signals/05-jobs命令详解.md)
6. [`bg`：让停止的 Shell 作业在后台继续](./commands/04-processes-signals/06-bg命令详解.md)
7. [`fg`：恢复前台进程组与终端控制](./commands/04-processes-signals/07-fg命令详解.md)
8. [`disown`：移除作业记录与 SIGHUP 标记](./commands/04-processes-signals/08-disown命令详解.md)
9. [`wait`：回收子进程、并发完成与退出码](./commands/04-processes-signals/09-wait命令详解.md)
10. [`kill`：信号、进程组、pidfd 与安全升级](./commands/04-processes-signals/10-kill命令详解.md)
11. [`pkill`：按属性筛选并安全发送信号](./commands/04-processes-signals/11-pkill命令详解.md)
12. [`killall`：按名称、年龄、namespace 与进程组发信号](./commands/04-processes-signals/12-killall命令详解.md)
13. [`pidwait`：用 pidfd 等待匹配进程退出](./commands/04-processes-signals/13-pidwait命令详解.md)
14. [`nice`：以调整后的 CPU 调度权重启动程序](./commands/04-processes-signals/14-nice命令详解.md)
15. [`renice`：调整运行中进程、进程组与用户的 niceness](./commands/04-processes-signals/15-renice命令详解.md)
16. [`nohup`：忽略 SIGHUP、重定向终端与后台运行边界](./commands/04-processes-signals/16-nohup命令详解.md)
17. [`setsid`：创建新 session 与控制终端边界](./commands/04-processes-signals/17-setsid命令详解.md)
18. [`timeout`：期限、信号升级、前台 TTY 与退出码](./commands/04-processes-signals/18-timeout命令详解.md)
19. [`sleep`：延迟、信号中断、轮询与指数退避](./commands/04-processes-signals/19-sleep命令详解.md)

CPU、内存与负载内容已经进入下一节；`taskset/chrt` 已在第 13 节的 CPU 拓扑与调度模块完成，systemd 服务生命周期已经进入第 11 节。跨模块的[Kubernetes 与容器命令参考库](../cloud-native/kubernetes/commands/00-Kubernetes与容器命令参考库学习路线.md)、[网络命令参考库](../networking/commands/00-网络命令参考库学习路线.md)、[存储命令参考库](../storage/commands/00-存储命令参考库学习路线.md)、[大数据学习地图](../data-systems/00-大数据技术学习地图.md)和[GPU 与加速器命令参考库](../gpu/commands/00-GPU与加速器命令参考库学习路线.md)继续直接复用。

## 10. 已完成：CPU、内存、负载与 procfs 批次

本分类完成十五个独立命令页面，并建立“资源容量与拓扑 → 全局利用率、队列和压力 → PID/TID 消费者 → 进程映射与内核 slab → RLIMIT/sysctl 约束 → sar 历史回放”的闭环：

1. [`uptime`：运行时间、负载平均与容器时间边界](./commands/05-cpu-memory-load-proc/01-uptime命令详解.md)
2. [`nproc`：可用 CPU、affinity、cgroup 配额与并行度](./commands/05-cpu-memory-load-proc/02-nproc命令详解.md)
3. [`lscpu`：CPU 拓扑、缓存、在线状态与机器输出](./commands/05-cpu-memory-load-proc/03-lscpu命令详解.md)
4. [`top`：CPU、内存、线程、排序与批处理快照](./commands/05-cpu-memory-load-proc/04-top命令详解.md)
5. [`free`：MemAvailable、缓存、Swap 与内存承诺](./commands/05-cpu-memory-load-proc/05-free命令详解.md)
6. [`vmstat`：运行队列、换页、IO、上下文切换与 CPU](./commands/05-cpu-memory-load-proc/06-vmstat命令详解.md)
7. [`mpstat`：逐 CPU、NUMA、拓扑与中断采样](./commands/05-cpu-memory-load-proc/07-mpstat命令详解.md)
8. [`pidstat`：进程线程 CPU、等待、缺页、IO 与切换](./commands/05-cpu-memory-load-proc/08-pidstat命令详解.md)
9. [`sar`：系统活动采集、历史回放与故障时间线](./commands/05-cpu-memory-load-proc/09-sar命令详解.md)
10. [`time`：墙钟、CPU、峰值 RSS、缺页与退出状态](./commands/05-cpu-memory-load-proc/10-time命令详解.md)
11. [`pmap`：进程地址空间、RSS、PSS、匿名页与映射归因](./commands/05-cpu-memory-load-proc/11-pmap命令详解.md)
12. [`slabtop`：内核对象缓存、可回收与不可回收内存](./commands/05-cpu-memory-load-proc/12-slabtop命令详解.md)
13. [`prlimit`：查询修改进程 RLIMIT 与受限启动](./commands/05-cpu-memory-load-proc/13-prlimit命令详解.md)
14. [`ulimit`：Bash 资源限制、soft/hard 与继承](./commands/05-cpu-memory-load-proc/14-ulimit命令详解.md)
15. [`sysctl`：运行时内核参数、加载顺序与安全变更](./commands/05-cpu-memory-load-proc/15-sysctl命令详解.md)

本分类复用存储专栏已有的 [`iostat`](../storage/commands/09-iostat命令详解.md)；`numastat/taskset/chrt` 已在第 13 节完成，`perf/strace/eBPF` 已在第 16 节完成。

## 11. 已完成：systemd 服务、启动过程与日志批次

本分类完成十二个独立命令页面，并建立“PID 1 与 unit → job/transaction → service cgroup → journal 证据 → 启动关键路径 → 登录会话与 core dump → 配置覆盖 → readiness/watchdog → 关机抑制 → UEFI 引导”的闭环：

1. [`systemctl`：unit 生命周期、依赖事务与开机状态](./commands/06-systemd-services-boot-journal/01-systemctl命令详解.md)
2. [`journalctl`：结构化日志、启动时间线与证据保全](./commands/06-systemd-services-boot-journal/02-journalctl命令详解.md)
3. [`systemd-analyze`：启动关键路径、unit 校验与安全评分](./commands/06-systemd-services-boot-journal/03-systemd-analyze命令详解.md)
4. [`systemd-run`：瞬态 service、scope、timer 与资源约束](./commands/06-systemd-services-boot-journal/04-systemd-run命令详解.md)
5. [`systemd-cat`：向 journal 写入结构化可检索消息](./commands/06-systemd-services-boot-journal/05-systemd-cat命令详解.md)
6. [`loginctl`：会话、用户、seat 与 linger 生命周期](./commands/06-systemd-services-boot-journal/06-loginctl命令详解.md)
7. [`coredumpctl`：崩溃转储查询、导出与调试](./commands/06-systemd-services-boot-journal/07-coredumpctl命令详解.md)
8. [`systemd-delta`：发现覆盖、drop-in 与配置漂移](./commands/06-systemd-services-boot-journal/08-systemd-delta命令详解.md)
9. [`systemd-escape`：路径、实例与合法 unit 名转换](./commands/06-systemd-services-boot-journal/09-systemd-escape命令详解.md)
10. [`systemd-notify`：readiness、状态、watchdog 与文件描述符](./commands/06-systemd-services-boot-journal/10-systemd-notify命令详解.md)
11. [`systemd-inhibit`：关机、睡眠与合盖抑制锁](./commands/06-systemd-services-boot-journal/11-systemd-inhibit命令详解.md)
12. [`bootctl`：UEFI、ESP、systemd-boot 与启动项治理](./commands/06-systemd-services-boot-journal/12-bootctl命令详解.md)

[`systemd 服务、启动与日志命令导读`](./commands/06-systemd-services-boot-journal/00-systemd服务启动与日志命令导读.md)负责串联对象模型、配置层级、日志字段和标准排障顺序。`machinectl` 与 cgroup 查看工具已在第 15 节完成；systemd-networkd 和 resolved 的专用命令归入网络模块。

## 12. 已完成：LSM、capabilities 与 Audit 批次

本分类完成十九个独立命令页面，并建立“识别实际 LSM → 核对 SELinux/AppArmor 策略与附着 → 分析 file/process capability → 设计和持久化 Audit 规则 → 按 serial 组装事件 → 报表发现热点并下钻原始证据”的闭环：

1. [`getenforce`：读取 SELinux 当前 enforcement 模式](./commands/07-lsm-capabilities-audit/01-getenforce命令详解.md)
2. [`sestatus`：核对 SELinux 模式、策略与配置](./commands/07-lsm-capabilities-audit/02-sestatus命令详解.md)
3. [`setenforce`：受控切换临时 enforcing/permissive](./commands/07-lsm-capabilities-audit/03-setenforce命令详解.md)
4. [`chcon`：修改当前 SELinux 文件上下文](./commands/07-lsm-capabilities-audit/04-chcon命令详解.md)
5. [`restorecon`：按策略恢复默认文件上下文](./commands/07-lsm-capabilities-audit/05-restorecon命令详解.md)
6. [`semanage`：持久管理本地 SELinux policy 定制](./commands/07-lsm-capabilities-audit/06-semanage命令详解.md)
7. [`getsebool`：读取 SELinux boolean 状态](./commands/07-lsm-capabilities-audit/07-getsebool命令详解.md)
8. [`setsebool`：临时或持久修改 SELinux boolean](./commands/07-lsm-capabilities-audit/08-setsebool命令详解.md)
9. [`aa-status`：核对 AppArmor 策略与进程约束](./commands/07-lsm-capabilities-audit/09-aa-status命令详解.md)
10. [`apparmor_parser`：编译、验证和加载 AppArmor profile](./commands/07-lsm-capabilities-audit/10-apparmor_parser命令详解.md)
11. [`aa-enforce`：把 AppArmor profile 切回强制模式](./commands/07-lsm-capabilities-audit/11-aa-enforce命令详解.md)
12. [`aa-complain`：受控观察 AppArmor 策略缺口](./commands/07-lsm-capabilities-audit/12-aa-complain命令详解.md)
13. [`getcap`：检查文件 capabilities 和 namespace root ID](./commands/07-lsm-capabilities-audit/13-getcap命令详解.md)
14. [`setcap`：为可执行文件授予最小 capability](./commands/07-lsm-capabilities-audit/14-setcap命令详解.md)
15. [`capsh`：解码、验证和构造 capability 受限进程](./commands/07-lsm-capabilities-audit/15-capsh命令详解.md)
16. [`auditctl`：设计、加载和诊断内核 Audit 规则](./commands/07-lsm-capabilities-audit/16-auditctl命令详解.md)
17. [`augenrules`：合并并持久化加载 Audit 规则](./commands/07-lsm-capabilities-audit/17-augenrules命令详解.md)
18. [`ausearch`：按完整事件检索 Audit 证据](./commands/07-lsm-capabilities-audit/18-ausearch命令详解.md)
19. [`aureport`：把 Audit 事件汇总成安全报表](./commands/07-lsm-capabilities-audit/19-aureport命令详解.md)

[`LSM、capabilities 与审计命令导读`](./commands/07-lsm-capabilities-audit/00-LSM-capabilities与审计命令导读.md)负责串联 DAC/ACL、capability、LSM、namespace/seccomp 和 Audit 的边界。`audit2why/audit2allow`、`seinfo/sesearch` 与 `aa-logprof` 暂不作为基础命令页：它们属于策略工程，后续会和策略阅读、最小授权评审及回归测试一起写，避免形成“从日志自动放行”的错误习惯。内核与硬件批次已经进入下一节。

## 13. 已完成：内核、模块、PCIe、NUMA、IRQ 与硬件拓扑批次

本分类完成二十个独立命令页面，并建立“固定运行内核 → 保存 kernel log → 解析模块文件、索引、加载状态与设备绑定 → 枚举 PCIe/SMBIOS/udev 对象 → 约束并验证 CPU/NUMA placement → 观察 IRQ/softirq → 合并 GPU、NIC、CPU 和内存拓扑”的闭环：

1. [`uname`：固定运行内核、架构与节点身份](./commands/08-kernel-hardware-topology/01-uname命令详解.md)
2. [`dmesg`：读取、筛选和保存内核环形日志](./commands/08-kernel-hardware-topology/02-dmesg命令详解.md)
3. [`lsmod`：读取已加载模块、依赖者与引用计数](./commands/08-kernel-hardware-topology/03-lsmod命令详解.md)
4. [`modinfo`：检查模块文件、参数、ABI 与签名](./commands/08-kernel-hardware-topology/04-modinfo命令详解.md)
5. [`modprobe`：按依赖加载、卸载与诊断模块](./commands/08-kernel-hardware-topology/05-modprobe命令详解.md)
6. [`insmod`：直接插入模块与理解底层失败](./commands/08-kernel-hardware-topology/06-insmod命令详解.md)
7. [`rmmod`：底层卸载、引用与风险控制](./commands/08-kernel-hardware-topology/07-rmmod命令详解.md)
8. [`depmod`：生成模块依赖、别名与符号索引](./commands/08-kernel-hardware-topology/08-depmod命令详解.md)
9. [`lspci`：读懂 BDF、PCIe capability、链路与驱动绑定](./commands/08-kernel-hardware-topology/09-lspci命令详解.md)
10. [`setpci`：安全读取与受控修改 PCI 配置空间](./commands/08-kernel-hardware-topology/10-setpci命令详解.md)
11. [`dmidecode`：解析 SMBIOS、内存插槽与固件资产](./commands/08-kernel-hardware-topology/11-dmidecode命令详解.md)
12. [`lshw`：构建系统硬件树与资产快照](./commands/08-kernel-hardware-topology/12-lshw命令详解.md)
13. [`udevadm`：从内核事件到设备节点与稳定命名](./commands/08-kernel-hardware-topology/13-udevadm命令详解.md)
14. [`numactl`：控制 NUMA CPU 与内存放置策略](./commands/08-kernel-hardware-topology/14-numactl命令详解.md)
15. [`numastat`：验证 NUMA 命中、远端分配与进程驻留页](./commands/08-kernel-hardware-topology/15-numastat命令详解.md)
16. [`taskset`：设置 CPU affinity、线程范围与容器边界](./commands/08-kernel-hardware-topology/16-taskset命令详解.md)
17. [`chrt`：Linux 调度策略、实时优先级与 Deadline](./commands/08-kernel-hardware-topology/17-chrt命令详解.md)
18. [`lsirq`：结构化分析硬中断、softirq 与 CPU 分布](./commands/08-kernel-hardware-topology/18-lsirq命令详解.md)
19. [`irqtop`：实时定位 IRQ 与 softirq 热点](./commands/08-kernel-hardware-topology/19-irqtop命令详解.md)
20. [`lstopo`：联合 CPU、NUMA、PCIe、GPU 与 NIC 拓扑](./commands/08-kernel-hardware-topology/20-lstopo命令详解.md)

[`内核、硬件拓扑与中断命令导读`](./commands/08-kernel-hardware-topology/00-内核硬件拓扑与中断命令导读.md)提供五层对象模型、GPU/NIC/NVMe 综合排障顺序和可复现实验。`lscpu` 已在 CPU 模块完整讲解，本分类直接复用而不重复建页。

## 14. 已完成：Shell、帮助与安全自动化

本分类完成二十篇核心文章，建立“Bash 调用 → 实现识别 → 安全输入输出 → 变量属性与环境 → Shell 行为 → CLI 解析 → 信号清理与进程替换 → 外部批处理”的闭环：

1. [`bash`](./commands/00-shell-help-automation/01-bash命令详解.md)
2. [`help`](./commands/00-shell-help-automation/02-help命令详解.md)
3. [`type`](./commands/00-shell-help-automation/03-type命令详解.md)
4. [`command`](./commands/00-shell-help-automation/04-command命令详解.md)
5. [`printf`](./commands/00-shell-help-automation/05-printf命令详解.md)
6. [`read`](./commands/00-shell-help-automation/06-read命令详解.md)
7. [`mapfile/readarray`](./commands/00-shell-help-automation/07-mapfile命令详解.md)
8. [`declare/typeset`](./commands/00-shell-help-automation/08-declare命令详解.md)
9. [`export`](./commands/00-shell-help-automation/09-export命令详解.md)
10. [`readonly/unset`](./commands/00-shell-help-automation/10-readonly-unset命令详解.md)
11. [`set`](./commands/00-shell-help-automation/11-set命令详解.md)
12. [`shopt`](./commands/00-shell-help-automation/12-shopt命令详解.md)
13. [`test/[ ]/[[ ]]`](./commands/00-shell-help-automation/13-test条件判断详解.md)
14. [`getopts/shift`](./commands/00-shell-help-automation/14-getopts-shift命令详解.md)
15. [`trap`](./commands/00-shell-help-automation/15-trap命令详解.md)
16. [`source/.`](./commands/00-shell-help-automation/16-source命令详解.md)
17. [`exec`](./commands/00-shell-help-automation/17-exec命令详解.md)
18. [`env`](./commands/00-shell-help-automation/18-env命令详解.md)
19. [`xargs`](./commands/00-shell-help-automation/19-xargs命令详解.md)
20. [`tee`](./commands/00-shell-help-automation/20-tee命令详解.md)

## 15. 已完成：Namespace、cgroup 与容器现场

本分类完成十五篇核心技术文章（其中 libcgroup 六个生命周期命令按同一对象模型联合讲解），覆盖 namespace 盘点/进入/创建、subuid/subgid 映射、最小权限执行、rootfs 切换、SysV IPC、systemd cgroup、machined、libcgroup 与 v2 原生文件接口：

1. [`lsns`](./commands/09-namespaces-cgroups-container/01-lsns命令详解.md)
2. [`nsenter`](./commands/09-namespaces-cgroups-container/02-nsenter命令详解.md)
3. [`unshare`](./commands/09-namespaces-cgroups-container/03-unshare命令详解.md)
4. [`newuidmap`](./commands/09-namespaces-cgroups-container/04-newuidmap命令详解.md)
5. [`newgidmap`](./commands/09-namespaces-cgroups-container/05-newgidmap命令详解.md)
6. [`setpriv`](./commands/09-namespaces-cgroups-container/06-setpriv命令详解.md)
7. [`chroot`](./commands/09-namespaces-cgroups-container/07-chroot命令详解.md)
8. [`pivot_root`](./commands/09-namespaces-cgroups-container/08-pivot_root命令详解.md)
9. [`switch_root`](./commands/09-namespaces-cgroups-container/09-switch_root命令详解.md)
10. [`ipcs`](./commands/09-namespaces-cgroups-container/10-ipcs命令详解.md)
11. [`systemd-cgls`](./commands/09-namespaces-cgroups-container/11-systemd-cgls命令详解.md)
12. [`systemd-cgtop`](./commands/09-namespaces-cgroups-container/12-systemd-cgtop命令详解.md)
13. [`machinectl`](./commands/09-namespaces-cgroups-container/13-machinectl命令详解.md)
14. [`cgcreate/cgexec/cgclassify/cgget/cgset/cgdelete`](./commands/09-namespaces-cgroups-container/14-libcgroup-cgcreate-cgexec命令详解.md)
15. [cgroup v2 原生文件接口](./commands/09-namespaces-cgroups-container/15-cgroup-v2原生文件接口实战.md)

## 16. 已完成：深度性能与故障诊断

本分类完成十一篇核心文章，覆盖 FD/挂载占用、syscall、动态库、PMU 计数、热点与调用栈、调度延迟、ftrace、bpftrace 和 BPF 对象治理：

1. [`lsof`](./commands/10-deep-diagnostics/01-lsof命令详解.md)
2. [`fuser`](./commands/10-deep-diagnostics/02-fuser命令详解.md)
3. [`strace`](./commands/10-deep-diagnostics/03-strace命令详解.md)
4. [`ltrace`](./commands/10-deep-diagnostics/04-ltrace命令详解.md)
5. [`perf stat`](./commands/10-deep-diagnostics/05-perf-stat命令详解.md)
6. [`perf record/report`](./commands/10-deep-diagnostics/06-perf-record-report命令详解.md)
7. [`perf top`](./commands/10-deep-diagnostics/07-perf-top命令详解.md)
8. [`perf sched/trace`](./commands/10-deep-diagnostics/08-perf-sched-trace命令详解.md)
9. [`trace-cmd`](./commands/10-deep-diagnostics/09-trace-cmd命令详解.md)
10. [`bpftrace`](./commands/10-deep-diagnostics/10-bpftrace命令详解.md)
11. [`bpftool`](./commands/10-deep-diagnostics/11-bpftool命令详解.md)

## 17. 学习方法

每篇至少完成四次操作：

1. 用 `type -a` 和 `--version` 确认实现。
2. 把所有参数按“选择对象、控制行为、格式化输出、安全保护”重新分类。
3. 在临时目录完成文章实验，记录命令、输出和退出码。
4. 不看文章，根据一个生产问题选出命令和参数，并解释为什么。

参数不需要一次背完，但必须知道如何查到准确版本、如何识别危险参数，以及怎样根据输出形成下一步假设。

## 18. 最终验收

- 能判断一个名称是 Alias、Shell Builtin、Function 还是外部程序。
- 能区分命令参数、位置参数、子命令和环境变量。
- 能解释 GNU、BusyBox 和发行版版本差异。
- 能在执行写入或删除命令前确认精确目标和回滚方法。
- 能用退出码、标准错误和系统证据判断命令为什么失败。
- 能从 CPU、内存、网络、存储和容器故障反向选择正确命令。

## 官方参考入口

- [GNU Coreutils 9.11 Manual](https://www.gnu.org/software/coreutils/manual/coreutils.html)
- [GNU Findutils 4.10 Manual](https://www.gnu.org/software/findutils/manual/html_node/find_html/)
- [file 5.46 manual page](https://man7.org/linux/man-pages/man1/file.1.html)
- [GNU Bash Manual](https://www.gnu.org/software/bash/manual/)
- [Linux man-pages project](https://www.kernel.org/doc/man-pages/)
- [Linux Kernel Documentation](https://docs.kernel.org/)
