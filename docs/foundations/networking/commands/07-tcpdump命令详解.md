---
title: tcpdump 命令详解：安全抓包、BPF 过滤和协议排障
sidebar_position: 7
description: 系统讲解 tcpdump 的接口、数量、长度、输出、时间戳、文件轮转、权限、方向、协议解析参数，以及 libpcap BPF 过滤表达式与生产抓包方法。
tags: [Linux, tcpdump, libpcap, BPF, 抓包, 网络排障]
---

# `tcpdump` 命令详解：安全抓包、BPF 过滤和协议排障

`tcpdump` 用 libpcap 从捕获接口读取报文，并按 capture filter 在捕获阶段筛选。它提供的是观测点看到的包，不是端到端绝对真相：GRO/LRO/TSO、硬件 Offload、隧道、命名空间、交换芯片卸载和抓包丢包都会改变你看到的形态。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 命令 | `tcpdump` |
| 实现 | The Tcpdump Group，依赖 libpcap |
| 安全级别 | 抓取本身通常为 `[R]`，但可能暴露凭据/业务数据并带来 CPU、I/O 和磁盘压力 |
| 权限 | Linux 实时抓包通常需 root 或 `CAP_NET_RAW`，部分设置还需 `CAP_NET_ADMIN` |
| 过滤器 | libpcap capture filter/BPF 语法，不是 Wireshark display filter |

```bash
tcpdump --version
tcpdump --help
```

## 2. 最小安全模板

```bash
sudo tcpdump -i eth0 -nn -s 128 -c 1000 \
  -w incident-eth0.pcap \
  'host 192.0.2.10 and tcp port 443'
```

这个模板明确：接口、禁用名称解析、每包截断长度、包数上限、输出文件和过滤范围。生产抓包不要默认 `-i any -s 0` 无限运行。

## 3. 参数按功能分类

tcpdump 的可用参数受版本、libpcap、平台和构建选项影响，以下覆盖上游 Linux 排障常用参数族；最终以本机 `--help` 和 `man tcpdump` 为准。

### 3.1 选择捕获源

| 选项 | 作用 |
|---|---|
| `-D` / `--list-interfaces` | 列出可捕获接口 |
| `-i IFACE` / `--interface=IFACE` | 指定接口、编号或 `any` |
| `-L` / `--list-data-link-types` | 列出接口支持的链路层类型 |
| `-y TYPE` / `--linktype=TYPE` | 指定链路层类型 |
| `-I` / `--monitor-mode` | 无线 monitor mode，取决于平台/设备 |
| `--immediate-mode` | 尽快向用户态交付包，降低延迟但可能提高开销 |
| `-Q in|out|inout` / `--direction=...` | 按捕获方向选择，支持度取决于平台 |

Linux `any` 是伪设备，抓到的链路层头可能是 Linux cooked capture，不保证与物理 Ethernet 头完全相同；它也无法替代在每个关键接口分别抓包判断方向。

### 3.2 控制数量、长度和缓冲

| 选项 | 作用 |
|---|---|
| `-c COUNT` | 接收或读取指定包数后退出 |
| `-s BYTES` / `--snapshot-length=BYTES` | 每包最多捕获字节数；`0` 表示使用实现允许的较大长度 |
| `-B KiB` / `--buffer-size=KiB` | 设置操作系统捕获缓冲大小 |
| `--count` | 读取捕获文件时只输出匹配包数量，不逐包解析打印；它不接收数量参数 |
| `--skip COUNT` | 读取捕获文件时跳过前 COUNT 个包，再应用 `-c` 计数 |

截断长度不足时会看不到完整 TCP option、隧道内层或应用头；`-s 0` 又会增加内存、I/O、隐私和磁盘压力。按故障目标选择 96、128、256 或完整包。

### 3.3 名称解析、详细度和载荷显示

| 选项 | 作用 |
|---|---|
| `-n` | 不解析主机名 |
| `-nn` | 也不把端口解析成服务名，生产排障常用 |
| `-N` | 不显示域名的限定后缀 |
| `-f` | 外部 IPv4 地址用数字显示，属于较旧兼容选项 |
| `-q` | 简短协议输出 |
| `-v` / `-vv` / `-vvv` | 逐级增加协议详细度 |
| `-e` | 显示链路层头 |
| `-A` | 以 ASCII 显示载荷 |
| `-x` | 十六进制显示包内容，不含链路层头的具体行为看版本 |
| `-xx` | 十六进制并包含链路层头 |
| `-X` | 十六进制 + ASCII |
| `-XX` | 十六进制 + ASCII，并包含链路层头 |
| `-S` | 打印绝对 TCP 序列号，不使用相对序列号 |
| `-K` | 不验证 TCP/UDP/IP 校验和 |
| `-E` | 为 IPsec ESP 解密提供密钥信息；谨慎处理密钥 |
| `-M SECRET` | 验证 TCP-MD5 摘要，平台/版本相关 |
| `-b` | BGP AS 号使用 RFC 5396 的 asdot 表示 |
| `-H` | 尝试识别 802.11s draft mesh header |
| `-m MODULE` | 加载 SMI MIB 模块，可重复指定 |
| `-T TYPE` | 强制把选定报文按指定上层类型解释；误用会产生误导输出 |
| `-u` | 打印未解码的 NFS file handle |
| `-#` / `--number` | 在每条输出前显示包序号 |
| `--lengths` | 显示捕获长度 caplen 与线上原始长度 len |

载荷可能包含 Token、Cookie、SQL、个人信息和模型请求。没有必要时不要 `-A/-X -s 0`，pcap 应按敏感生产数据管理。

### 3.4 时间戳

| 选项 | 作用 |
|---|---|
| `-t` | 不打印时间 |
| `-tt` | 打印 Epoch 秒及小数部分 |
| `-ttt` | 打印相邻包时间差 |
| `-tttt` | 打印日期和时间 |
| `-ttttt` | 打印相对第一包的时间差 |
| `--time-stamp-precision=micro|nano` | 请求微秒/纳秒精度 |
| `-J` / `--list-time-stamp-types` | 列出接口支持的时间戳类型 |
| `-j TYPE` / `--time-stamp-type=TYPE` | 选择 host、adapter 等类型，取决于驱动/平台 |

纳秒“精度”不等于时钟准确度。跨主机分析还要确认 NTP/PTP、时区、时钟源和硬件时间戳位置。

### 3.5 文件读写与轮转

| 选项 | 作用 |
|---|---|
| `-w FILE` | 写 pcap/pcapng 风格捕获文件，具体格式取决于版本 |
| `-r FILE` | 从文件读取；`-` 表示标准输入 |
| `-V FILE` | 从文件读取待分析文件名列表 |
| `-C SIZE` | 输出文件达到指定大小前轮转，单位语义按手册 |
| `-G SECONDS` | 按时间轮转，可在文件名中用 `strftime` 格式 |
| `-W COUNT` | 限制轮转文件数；与 `-C/-G` 组合语义不同 |
| `-z COMMAND` | 每个轮转文件关闭后执行命令 |
| `-Z USER` | 打开捕获设备后降权到指定用户 |
| `-U` | 每收到一包即刷新保存文件 |
| `-l` | 标准输出行缓冲 |
| `-C`、`-G`、`-W` | 组合前必须在测试环境验证文件命名和停止条件 |

安全轮转示例：

```bash
sudo tcpdump -i eth0 -nn -s 256 \
  -G 60 -W 10 \
  -w 'incident-%Y%m%d-%H%M%S.pcap' \
  'host 192.0.2.10'
```

不同 tcpdump 版本中 `-W` 配合 `-G` 的退出/循环语义可能不同，生产前用本机版本小规模验证，并另设磁盘监控和进程超时。

### 3.6 过滤器与调试

| 选项 | 作用 |
|---|---|
| `-F FILE` | 从文件读取 capture filter 表达式 |
| `-d` | 输出编译后的 BPF 指令后退出 |
| `-dd` | 以 C 数组形式输出 BPF |
| `-ddd` | 以十进制数字形式输出 BPF |
| `-O` | 禁用 BPF 优化器，主要用于调试过滤器 |
| `--print` | 即使使用 `-w` 仍打印概要，增加开销 |

`tcpdump -d '...'` 只证明表达式能编译，不证明观测点、封装层次和字段偏移符合预期。

### 3.7 其他控制

| 选项 | 作用 |
|---|---|
| `-p` | 不把接口置为混杂模式 |
| `--print-sampling=N` | 支持版本中只打印采样包，不改变保存行为时需查手册 |
| `--number` | 给输出包编号，等价于 `-#` |
| `--micro` / `--nano` | 时间精度兼容选项，具体版本为准 |
| `--version` / `-h` | 版本/帮助 |

选项新增较快，避免把别的平台 tcpdump 参数直接复制到 Linux。

## 4. libpcap capture filter 语法

基本形式由 primitive 和逻辑运算组成：

```text
[proto] [dir] [type] value
primitive and primitive
primitive or primitive
not primitive
( expression )
```

### 4.1 协议限定词

```text
ether, arp, rarp, ip, ip6, icmp, icmp6, tcp, udp, sctp,
vlan, mpls, pppoe, geneve, vxlan ...
```

具体支持取决于 libpcap 版本和链路类型。

### 4.2 方向与对象

| 表达式 | 作用 |
|---|---|
| `host 192.0.2.10` | 源或目的主机 |
| `src host ...` / `dst host ...` | 指定方向主机 |
| `net 10.0.0.0/8` | 源或目的网段 |
| `port 443` | TCP/UDP/SCTP 源或目的端口 |
| `src portrange 8000-8999` | 源端口范围 |
| `ether host 02:...` | 二层源或目的 MAC |
| `gateway NAME` | 特定平台/名称解析条件下按网关匹配，生产不建议依赖 |
| `broadcast` / `multicast` | 广播/组播 |

### 4.3 逻辑与优先级

```bash
tcpdump -i eth0 -nn '(host 192.0.2.10 or host 192.0.2.11) and tcp port 443'
tcpdump -i eth0 -nn 'net 10.0.0.0/8 and not port 22'
```

必须用引号保护括号、`!` 和 Shell 特殊字符。显式写出括号，避免依赖隐含结合顺序。

### 4.4 按报文字节匹配

```text
proto[offset:size] & mask relation value
```

例如只匹配 TCP SYN 且不含 ACK：

```bash
tcpdump -i eth0 -nn 'tcp[13] & 0x12 = 0x02'
```

这类偏移表达式受 IPv4 options、IPv6 扩展头、VLAN、隧道和报文截断影响。能用语义 primitive 时优先不用硬编码偏移；使用前在已知 pcap 上验证。

## 5. 常见协议模板

```bash
# ARP 与 IPv6 ND
tcpdump -i eth0 -nn -e 'arp or (icmp6 and (ip6[40] >= 133 and ip6[40] <= 136))'

# DNS
tcpdump -i eth0 -nn -s 512 'udp port 53 or tcp port 53'

# TCP 握手、关闭、RST
tcpdump -i eth0 -nn 'tcp[tcpflags] & (tcp-syn|tcp-fin|tcp-rst) != 0'

# ICMP/PMTU
tcpdump -i eth0 -nn -vv 'icmp or icmp6'

# VXLAN underlay
tcpdump -i eth0 -nn -e -vv 'udp port 4789'

# NFS 常见端口，实际 RPC 端口需结合 rpcinfo
tcpdump -i eth0 -nn 'host 192.0.2.20 and (port 2049 or port 111)'

# RoCEv2 常见 UDP 4791
tcpdump -i eth0 -nn -vv 'udp port 4791'
```

抓到 UDP 4791 只能证明 RoCEv2 报文经过观测点；PFC/CNP/ECN、RDMA QP 和 NIC 硬件丢包还要结合交换机、RDMA 与 ethtool 计数。

## 6. 三点抓包定位丢包位置

对容器/VXLAN 路径至少选三个观测点：

```text
Pod/进程 namespace veth
          ↓
宿主机 bridge/隧道设备
          ↓
物理 NIC underlay
```

每个点使用相同的五元组与时间窗口，分别确认：

1. 应用是否发出。
2. NAT/封装前后地址和端口是否符合预期。
3. 物理口是否真的发出/收到。
4. 返回方向在哪一层消失。

不要只抓 `any`：它可能重复观察同一包，也不总能准确表达接口方向和原始二层头。

## 7. Offload 如何影响抓包

- TSO/GSO：发送路径抓包可能看到大于 MTU 的“超级包”，实际由后续层分段。
- GRO/LRO：接收路径多个包可能已合并后才被抓到。
- TX checksum offload：本机出方向抓包可能显示校验和错误，网卡发送前才补全。
- 硬件交换/offload：报文可能不经过预期软件 hook，因此软件接口抓不到。

先查看：

```bash
ethtool -k eth0
ethtool -S eth0
```

不要为了让 pcap “好看”就在生产关闭 Offload；这会改变性能与时序。只有在隔离实验或经过评估的短时诊断中变更，并准备恢复。

## 8. 捕获统计与抓包丢包

退出时 tcpdump/libpcap 通常报告 captured、received by filter、dropped by kernel 等计数。各平台口径不完全相同，但 `dropped by kernel` 增长说明捕获路径本身跟不上，不能据此断言业务网络丢包。

降低抓包损耗：

- 缩小 BPF 过滤范围。
- 合理缩短 snapshot length。
- 写本地高速盘，不同步打印详细解析。
- 增大捕获缓冲 `-B`，同时关注内存。
- 分接口、分时间窗口抓取。
- 对超高速链路使用专用遥测/硬件抓包方案。

## 9. 安全与隐私清单

1. 明确工单、接口、五元组、时长、包数和负责人。
2. 按最小必要长度抓取，不默认完整载荷。
3. 文件权限至少设为仅授权人员可读。
4. 不把 pcap 直接上传到公开 Issue 或博客。
5. 使用完按组织数据保留策略删除或加密归档。
6. 报告中可先导出脱敏统计，避免传播原始载荷。

## 10. 易错点

- capture filter 与 Wireshark display filter 语法不同。
- `port 53` 默认可匹配 TCP/UDP，若只要 UDP 应显式写出。
- 抓不到包可能是接口、命名空间、方向、硬件 offload 或过滤器错误，不等于应用没发。
- 出方向校验和错误常是 Offload 观察效应。
- `-w` 产生二进制捕获文件，不是可直接 `cat` 的文本。
- pcap 时间顺序依赖捕获时钟和缓冲，不应假定多主机天然同步。

## 11. 资料

- [tcpdump 官方仓库](https://github.com/the-tcpdump-group/tcpdump)
- [libpcap 官方仓库与 pcap-filter 源手册](https://github.com/the-tcpdump-group/libpcap)
- [tcpdump 官方手册页](https://www.tcpdump.org/manpages/tcpdump.1.html)
- [pcap-filter 官方手册页](https://www.tcpdump.org/manpages/pcap-filter.7.html)

若官网手册暂时不可访问，可在已安装主机运行 `man tcpdump`、`man pcap-filter`，并以 `tcpdump --version` 记录实际基线。
