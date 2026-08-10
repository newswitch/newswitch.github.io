---
title: Linux 命令手册：AI Infra SRE 从入门到故障排查
tags: [Linux, SRE, 命令行, 故障排查, AI Infra]
---

# Linux 命令手册：AI Infra SRE 从入门到故障排查

Linux 命令不是需要孤立背诵的单词表。真正的目标是：面对 CPU、内存、网络、存储、容器、GPU
或 RDMA 故障时，能够提出假设、选择证据、缩小范围，并留下可复现的诊断记录。

本文按“先只读观察，再定位对象，最后谨慎改变状态”的顺序组织。命令输出因发行版、内核和工具
版本而异；示例中的设备名、PID、Namespace 和路径必须替换。

## 1. 命令行基础

### 1.1 一条命令由什么组成

```text
command [subcommand] [options] [arguments]
```

```bash
ip -brief address show eth0
```

- `ip`：命令；
- `-brief`：输出格式选项；
- `address show`：操作；
- `eth0`：对象。

先读帮助，再执行不熟悉的命令：

```bash
command --help
man command
type -a command
which command
```

`type -a` 能区分 Alias、Shell Builtin、Function 和实际可执行文件。

### 1.2 引号、变量与通配符

```bash
name='gpu-node-01'
printf '%s\n' "$name"
printf '%s\n' '*.log'
printf '%s\n' ./*.log
```

- 单引号：内容原样保留；
- 双引号：允许变量展开，避免空格导致再次分词；
- 未加引号的 `*` 由 Shell 展开，不是命令自己处理；
- 删除、移动、权限修改前不要依赖未经检查的通配符。

### 1.3 管道、重定向和退出码

```bash
journalctl -u kubelet --since '30 min ago' | rg -i 'error|fail|timeout'
echo "$?"
```

管道把左侧标准输出交给右侧标准输入。Shell 通常只返回最后一个命令的退出码；脚本中应使用：

```bash
set -o pipefail
```

重定向需要区分覆盖和追加：

```bash
command > output.txt       # 覆盖
command >> output.txt      # 追加
command 2> error.txt       # 只保存标准错误
command > all.txt 2>&1     # 合并输出
```

在重要文件上使用 `>` 前先确认目标路径。

## 2. 文件、目录和元数据

### 2.1 定位路径

```bash
pwd
ls -lah
realpath ./some-path
stat ./some-file
file ./some-file
```

`ls` 看目录表象，`stat` 看 inode、权限、大小和时间，`file` 根据内容判断类型。

### 2.2 查找文件和内容

文件名查找：

```bash
find /var/log -type f -name '*.log' -mtime -1 -print
```

正文查找优先使用 `rg`：

```bash
rg -n -i 'oom|timeout|xid' /var/log
rg --files /etc | rg 'containerd|kubelet'
```

先让 `find` 打印结果确认范围，再考虑 `-delete` 或 `-exec`。不要把未经验证的查找结果直接交给
破坏性命令。

### 2.3 大小、inode 与打开文件

```bash
df -hT
df -ih
du -xhd1 /var/lib | sort -h
findmnt
lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINTS,MODEL
lsof +L1
```

典型判断：

- `df` 满、`du` 不大：检查被删除但仍被进程打开的文件；
- 容量未满却无法创建文件：检查 inode；
- 只看块设备存在但业务读不到：继续检查文件系统和挂载点。

## 3. 文本和结构化数据处理

### 3.1 查看文件

```bash
less +G /var/log/messages
head -n 50 file.log
tail -n 100 file.log
tail -F service.log
```

`tail -F` 会在日志轮转后重新跟踪文件名，通常比 `-f` 更适合服务日志。

### 3.2 过滤、排序和聚合

```bash
rg 'status=' access.log | awk '{print $9}' | sort | uniq -c | sort -nr
cut -d: -f1 /etc/passwd
sort -k2,2nr metrics.txt
```

复杂处理前先查看 5～10 行真实输入，确认列和分隔符。日志中包含空格、引号或 JSON 时，不要假设
固定 `$9` 永远是状态码。

### 3.3 JSON 与 YAML

```bash
jq '.items[] | {name: .metadata.name, node: .spec.nodeName}' pods.json
kubectl get pods -A -o json | jq -r '.items[] | [.metadata.namespace,.metadata.name,.status.phase] | @tsv'
```

处理 Kubernetes JSON 优先用 `jq` 或 `jsonpath`，不要靠 `grep` 猜嵌套结构。

## 4. 用户、权限和进程身份

```bash
id
getent passwd username
getent group groupname
namei -l /path/to/file
getfacl /path/to/file
```

`Permission denied` 不只由文件最后一级权限决定，还可能是父目录缺少执行权限、ACL、SELinux、
只读挂载或容器安全策略。

查看进程真实身份和能力：

```bash
ps -o pid,user,group,comm,args -p 1234
grep -E 'Uid|Gid|Cap(Inh|Prm|Eff|Bnd)' /proc/1234/status
getcap /path/to/binary
```

不要为了“先跑起来”直接使用 `chmod 777`、关闭 SELinux 或给容器 `privileged`。先确定缺少的最小权限。

## 5. 进程、线程和资源

### 5.1 找到进程

```bash
ps aux --sort=-%cpu | head
ps aux --sort=-%mem | head
pgrep -af 'vllm|python|kubelet'
pstree -ap
```

`ps aux | grep name` 容易匹配到 grep 自身和无关参数，`pgrep -af` 更清楚。

### 5.2 实时观察

```bash
top -H -p 1234
pidstat -p 1234 -t -r -u -w 1
vmstat 1
mpstat -P ALL 1
```

重点含义：

| 指标 | 方向 |
|---|---|
| CPU us/sy | 用户计算与内核开销 |
| wa | CPU 等待 I/O，不等于磁盘一定坏 |
| cswch/nvcswch | 主动/被动上下文切换 |
| majflt | 需要从磁盘取页的 Major Fault |
| run queue | 可运行任务是否超过 CPU 能力 |

### 5.3 `/proc` 是最重要的现场

```bash
tr '\0' ' ' < /proc/1234/cmdline
cat /proc/1234/status
cat /proc/1234/limits
ls -l /proc/1234/fd
cat /proc/1234/mountinfo
cat /proc/1234/cgroup
```

进程看到的 Mount、网络、PID 和 cgroup 可能与宿主机不同。排查容器问题时，先确认自己观察的是
哪个 Namespace。

### 5.4 信号与停止顺序

```bash
kill -TERM 1234
kill -KILL 1234
```

默认先发送 `TERM`，给程序保存状态和优雅退出的机会；`KILL` 无法被捕获，只在进程无法退出且
影响可接受时使用。发送信号前确认 PID 未复用，并保存线程栈、日志和资源证据。

## 6. 内存与 OOM

```bash
free -h
cat /proc/meminfo
ps -eo pid,comm,rss,vsz,%mem --sort=-rss | head
pmap -x 1234 | tail -n 20
cat /proc/1234/smaps_rollup
dmesg -T | rg -i 'oom|out of memory|killed process'
```

不要把 `free` 很小直接判断为内存不足。Linux 会把空闲内存用于 Page Cache，优先观察
`available`、Swap、回收压力和 OOM 记录。

容器还要检查 cgroup：

```bash
cat /sys/fs/cgroup/memory.current
cat /sys/fs/cgroup/memory.max
cat /sys/fs/cgroup/memory.events
```

宿主机有空闲内存但容器被杀，常见原因是容器 cgroup 达到 `memory.max`。

## 7. 系统服务与日志

```bash
systemctl status kubelet --no-pager
systemctl show kubelet -p ActiveState -p SubState -p ExecMainStatus
journalctl -u kubelet --since '1 hour ago' --no-pager
journalctl -k --since today
journalctl --list-boots
```

排查顺序：

```text
服务是否启动
→ 主进程退出码
→ 最近一次启动日志
→ 依赖服务
→ 配置语法
→ 文件权限/端口/资源
```

修改配置前先使用服务自带检查，例如：

```bash
nginx -t
sshd -t
containerd config dump
```

## 8. 网络排查

### 8.1 从链路到路由

```bash
ip -brief link
ip -brief address
ip route
ip rule
ip route get 10.0.0.10
ip neigh show
```

`ip route get` 能给出内核实际选择的源地址、出口接口和下一跳，比只看整张路由表更接近真实请求。

### 8.2 端口和连接

```bash
ss -lntup
ss -tan state established
ss -ti dst 10.0.0.10
lsof -nP -iTCP:8000 -sTCP:LISTEN
```

服务进程存在不等于端口在正确地址监听。`127.0.0.1:8000` 和 `0.0.0.0:8000` 的可达范围不同。

### 8.3 DNS、HTTP 与路径 MTU

```bash
getent hosts example.com
dig +short example.com
curl -sv --connect-timeout 3 https://example.com/ -o /dev/null
tracepath 10.0.0.10
ping -M do -s 1472 10.0.0.10
```

`ping` 通只证明 ICMP 某种报文可达，不证明 DNS、TCP、TLS、HTTP、代理和应用都正常。

### 8.4 抓包和网卡

```bash
tcpdump -ni eth0 'host 10.0.0.10 and port 8000'
ethtool eth0
ethtool -S eth0
ethtool -k eth0
ethtool -l eth0
```

抓包先收窄接口、主机和端口，设置合理的文件轮转和数据保密范围。生产流量可能包含凭证与业务数据。

## 9. 存储与 I/O

```bash
lsblk -o NAME,TYPE,SIZE,FSTYPE,MOUNTPOINTS,ROTA,MODEL
findmnt -T /models
df -hT /models
iostat -xz 1
pidstat -d 1
```

`iostat` 需要结合设备类型解释：

- `await`：请求平均完成时间；
- `aqu-sz`：平均队列深度；
- `%util`：设备忙碌程度，不能跨设备类型机械比较；
- `r/s`、`w/s`、`rkB/s`、`wkB/s`：IOPS 与带宽。

块设备健康信息：

```bash
smartctl -a /dev/sda
nvme smart-log /dev/nvme0
dmesg -T | rg -i 'i/o error|nvme|reset|timeout|ext4|xfs'
```

`dd`、`fio` 会产生真实 I/O，错误参数可能覆盖数据或打满生产存储。只在明确的测试文件、容量和
I/O 上限下执行。

## 10. 内核、硬件、PCIe 与中断

```bash
uname -a
lscpu
numactl --hardware
lspci -Dnn
lspci -s 0000:65:00.0 -vv
cat /proc/interrupts
dmesg -T | rg -i 'aer|pcie|iommu|mce|edac'
```

查看内核参数：

```bash
sysctl net.core.somaxconn
sysctl -a | rg 'vm.swappiness|net.ipv4.tcp'
```

不要在不了解作用域和回滚方式时直接 `sysctl -w`。先区分运行时临时修改与 `/etc/sysctl.d/`
持久配置，并记录变更前值。

PCIe 中断、MSI-X 和 IRQ 亲和性详见
[PCIe 中断机制](../../foundations/compute/pcie/PCIe总线学习（三）中断机制.md)。

## 11. 容器与 Kubernetes 节点

### 11.1 容器运行时

```bash
crictl info
crictl ps -a
crictl inspect <container-id>
crictl logs <container-id>
ctr -n k8s.io containers list
```

`crictl` 面向 CRI，通常比直接用 `ctr` 更适合 Kubernetes 排障；`ctr` 主要用于 containerd 底层观察。

### 11.2 Namespace 现场

```bash
lsns
nsenter -t 1234 -m -n -p -- sh
```

进入 Namespace 会改变观察视角。先记录目标 PID 和当前 Shell，退出后再执行宿主机操作。

### 11.3 Kubernetes 证据链

```bash
kubectl get pod -A -o wide
kubectl describe pod -n <ns> <pod>
kubectl logs -n <ns> <pod> --all-containers --timestamps
kubectl get events -A --sort-by=.metadata.creationTimestamp
kubectl get pod -n <ns> <pod> -o yaml
```

`get` 看状态，`describe` 看事件与调度/挂载/探针，`logs` 看进程，`yaml` 看期望状态和控制器写入结果。

## 12. GPU 与 RDMA

### 12.1 GPU

```bash
nvidia-smi
nvidia-smi -L
nvidia-smi topo -m
nvidia-smi -q
nvidia-smi dmon -s pucvmet
dmesg -T | rg -i 'nvrm|xid|nvidia'
```

关键问题：

```text
宿主机是否识别全部 GPU
→ 驱动/NVML 是否正常
→ PCIe/NVLink 拓扑是否符合设计
→ 容器是否获得设备与库
→ CUDA 是否可用
→ 应用是否真正产生计算和显存访问
```

### 12.2 RDMA

```bash
rdma link show
rdma dev show
ibv_devices
ibv_devinfo
ibstat
show_gids
```

网卡 Link Up 不等于 RDMA 数据面正常，还要验证 GID/LID、路由、MTU、PFC/ECN、QP 建连和
端到端基准。生产 Fabric 不要随意运行无上限的带宽压测。

## 13. 一套通用故障排查流程

### 13.1 先定义症状

```text
谁失败：用户、Pod、节点、队列还是整个集群
何时开始：绝对时间与时区
影响范围：单请求、单节点、单机架、单租户
失败方式：错误、超时、慢、数据不一致
最近变化：发布、驱动、内核、网络、存储、模型
```

### 13.2 六步证据法

1. **固定对象**：PID、Pod UID、Node、BDF、网卡、磁盘、请求 ID；
2. **建立时间线**：事件、日志、指标使用统一时间；
3. **找到边界**：客户端/服务端、Pod/Node、GPU/NIC、应用/存储；
4. **提出可证伪假设**：例如“流量走错管理网”；
5. **最小验证**：路由、抓包、计数器、日志共同证明；
6. **修复后复测**：原症状消失且没有新错误或性能回退。

### 13.3 推荐的只读采集顺序

```text
date/hostname/uptime
→ 对象状态
→ 最近事件和日志
→ CPU/内存/IO/网络/GPU 快照
→ 配置与拓扑
→ 分层基准
→ 变更前后对比
```

## 14. 高风险命令原则

以下操作必须明确目标、影响范围和恢复方案：

- 删除文件、格式化、分区、文件系统修复；
- `dd`、`fio` 直接指向块设备；
- 重启、卸载驱动、GPU Reset；
- `iptables`/`nft`/`tc` 修改；
- `sysctl`、IRQ Affinity、CPU Governor 修改；
- `kubectl delete`、`drain`、强制移除 Finalizer；
- `kill -9` 关键进程。

执行前至少回答：

```text
精确目标是什么
是否只作用于测试环境
如何停止
如何恢复
如何验证恢复
证据是否已经保存
```

## 15. 从入门到精通的练习

### 入门

- 找到一个服务进程、监听端口、配置和最近日志；
- 解释 `df` 与 `du` 不一致的三个原因；
- 用 `ip route get` 证明到目标 IP 的真实出口。

### 进阶

- 对一个容器建立 PID、Mount、Network、cgroup 的映射；
- 通过 `pidstat`、`iostat` 和日志区分 CPU 慢、IO 慢和锁等待；
- 从 BDF 找到 NIC 的 NUMA、IRQ 和队列。

### 综合

选择一个 GPU Pod，完成：

```text
Pod/Node
→ cgroup 与容器运行时
→ /dev/nvidia* 与驱动库
→ GPU/PCIe/NVLink
→ RDMA NIC/路由/IRQ
→ 模型存储挂载与 I/O
→ 应用端口、探针、日志与指标
```

交付一份带时间戳、原始命令、输出、假设、结论和恢复验证的排障报告。

## 16. 掌握标准

- [ ] 不靠背命令，能从问题选择合适的证据；
- [ ] 能解释命令观察的是宿主机还是 Namespace/cgroup；
- [ ] 能区分状态、配置、计数器和真实数据面；
- [ ] 能把 CPU、内存、网络、存储、GPU、RDMA 证据对齐到同一时间线；
- [ ] 先做只读检查，高风险操作有停止条件和恢复方案；
- [ ] 修复后能证明业务恢复且没有副作用。

## 参考资料

- [The Linux man-pages project](https://www.kernel.org/doc/man-pages/)
- [Linux Kernel Documentation](https://docs.kernel.org/)
- [iproute2 manual pages](https://man7.org/linux/man-pages/man8/ip.8.html)
- [Kubernetes：调试集群](https://kubernetes.io/zh-cn/docs/tasks/debug/debug-cluster/)
