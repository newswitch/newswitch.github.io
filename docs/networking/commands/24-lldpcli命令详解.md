---
title: lldpcli 命令详解：LLDP 邻居、交换机端口与二层拓扑排查
sidebar_position: 24
description: 以 lldpd 1.0.21 为基线，系统讲解 lldpcli 的守护进程模型、全部全局参数、邻居与接口查询、输出格式、统计、事件监听、LLDP TLV、发送策略、持久配置，以及 Bond、VLAN、AI 集群布线和无邻居故障排查。
tags: [Linux, lldpcli, lldpd, LLDP, 数据中心网络, 二层拓扑]
---

# `lldpcli` 命令详解：LLDP 邻居、交换机端口与二层拓扑排查

`lldpcli` 是 `lldpd` 的控制客户端。它最重要的用途，是回答服务器二层接入中的三个问题：

1. 这块物理网卡实际连接到哪台交换机、哪个端口？
2. 对端宣告的 VLAN、链路聚合、管理地址和端口能力是什么？
3. LLDP 报文是否正在收发，邻居为什么消失或与资产记录不一致？

```text
lldpcli -- Unix socket --> lldpd -- Ethernet 0x88cc --> 直连交换机/服务器
             控制面                         本地链路
```

LLDP 不会被普通三层路由器转发，所以它观察的是**直连二层邻居**，不是整条 IP 路径。要验证三层路由仍应使用 `ip route get`、`ping`、`traceroute`；要验证实际报文则使用 `tcpdump`。

## 1. 先理解客户端、守护进程和协议

这三个对象不能混为一谈：

| 对象 | 职责 | 常见检查 |
|---|---|---|
| `lldpcli` | 向本机守护进程查询或提交配置 | `lldpcli show configuration` |
| `lldpd` | 在接口上发送、接收、缓存 LLDP/CDP 等邻居信息 | `systemctl status lldpd` |
| LLDP | IEEE 802.1AB 定义的链路层发现协议 | `tcpdump ... ether proto 0x88cc` |

没有运行中的 `lldpd`，客户端即使安装成功，也无法给出邻居状态：

```bash
lldpcli -v
systemctl status lldpd --no-pager
lldpcli show configuration
```

本文以 lldpd 1.0.21 官方用法为基线。发行版可能采用更旧版本、不同编译选项或不同 socket/config 路径，应以本机输出复核：

```bash
lldpcli -v
lldpcli -vv
lldpcli help
lldpcli help show
```

`-v` 可重复使用：一次显示版本，重复后会增加编译信息。它不是 verbose 查询选项。

## 2. 配置所有权与安全边界

Linux 上可能有多个 LLDP agent：

- `lldpd`；
- NetworkManager；
- `systemd-networkd`；
- 某些网卡厂商 agent 或交换机管理软件。

先确认谁负责发送和缓存 LLDP，避免同一接口被多个 agent 同时管理：

```bash
systemctl is-active lldpd
systemctl is-active NetworkManager
systemctl is-active systemd-networkd
nmcli device lldp list
networkctl lldp
lldpcli show neighbors
```

这三条查询看到的是各自 agent 的缓存，不是同一份共享状态。`nmcli device lldp list` 有结果，不代表 `lldpd` 已启动；反之亦然。

安全上还要注意：

- LLDP 邻居信息由对端自行宣告，默认没有身份认证，不能作为唯一授权依据；
- system name、management IP、平台、软件版本、序列号和 asset ID 可能暴露资产信息；
- 修改发送内容、agent 状态和端口模式属于 `[W]`，可能影响拓扑系统和交换机自动化；
- `pause`、禁用端口 LLDP 或错误的 interface pattern 可能使邻居从监控中消失；
- 读取控制 socket 也可能受 Unix 权限控制，不要为了方便把 socket 对所有用户开放。

生产环境先执行只读的 `show`，提交 `configure/unconfigure` 前保存现状：

```bash
lldpcli -f keyvalue show configuration
lldpcli -f keyvalue show interfaces details
lldpcli -f keyvalue show neighbors details
```

## 3. LLDP 报文、TLV 和生命周期

LLDP 使用链路层帧，常见目的 MAC 为 `01:80:c2:00:00:0e`，EtherType 为 `0x88cc`。一个 LLDPDU 由多个 TLV 组成：

```text
Ethernet header
  ├─ Chassis ID TLV       必选：对端设备标识
  ├─ Port ID TLV          必选：对端端口标识
  ├─ Time To Live TLV     必选：邻居有效期
  ├─ Port Description     可选
  ├─ System Name          可选
  ├─ System Description   可选
  ├─ System Capabilities  可选：bridge/router/telephone 等
  ├─ Management Address   可选
  ├─ 802.1/802.3/MED TLV  可选：VLAN、LAG、MTU、PoE、策略等
  └─ End of LLDPDU TLV
```

默认发送周期通常为 30 秒，hold multiplier 通常为 4，因此常见 TTL 为：

```text
TTL = tx-interval × tx-hold = 30 × 4 = 120 秒
```

在 TTL 到期前没有收到刷新，邻居才会老化删除。因此拔线后邻居不一定立即消失；判断现场时要同时看 TTL、统计和抓包。

## 4. 命令行语法与全部全局参数

官方语法：

```text
lldpcli [-dv] [-u socket] [-f format] [-c file] [command ...]
```

| 参数 | 含义 | 使用要点 |
|---|---|---|
| `-d` | 增加调试级别，可重复 | 客户端排障使用，输出可能较多 |
| `-u socket` | 指定 lldpd Unix socket | 多实例、容器或非默认运行目录时使用 |
| `-v` | 显示版本/构建信息，可重复 | 先确认实际能力和编译特性 |
| `-f plain` | 人类可读文本 | 默认适合交互检查 |
| `-f keyvalue` | 稳定的键值行 | 适合 shell 过滤和证据归档 |
| `-f xml` | XML 输出 | 供支持 XML 的系统消费 |
| `-f json` | JSON 输出 | 层级可能随单/多对象变化，不宜盲写解析器 |
| `-f json0` | 结构稳定的 JSON 输出 | 自动化优先选择，数组/对象结构更可预测 |
| `-c file` | 执行配置文件，可重复 | 文件也可以是目录；目录中的 `*.conf` 按字母顺序读取 |

示例：

```bash
lldpcli -f plain show neighbors
lldpcli -f keyvalue show neighbors details
lldpcli -f json0 show interfaces details
lldpcli -u /run/lldpd.socket show configuration
lldpcli -c /etc/lldpd.conf
```

不要在脚本中解析对齐后的 `plain` 文本。需要机器读取时使用 `json0` 或 `keyvalue`，并保留版本信息。

## 5. 只读查询命令

### 5.1 查看邻居

```bash
lldpcli show neighbors
lldpcli show neighbors summary
lldpcli show neighbors details
lldpcli show neighbors ports eth0 details
lldpcli show neighbors ports eth0,eth1 details
lldpcli show neighbors hidden details
```

`summary` 适合快速看端口—邻居映射；`details` 展开 TLV；`ports` 限定本地接口；`hidden` 还会显示被 smart filtering 隐藏的邻居。

典型阅读顺序：

1. `Interface`：本地从哪个接口收到；
2. `ChassisID`、`SysName`：对端设备是谁；
3. `PortID`、`PortDescr`：对端哪个端口；
4. `MgmtIP`：用于跳转到交换机管理面，但必须和资产系统核对；
5. `Capability`：对端宣告自己是 bridge、router 或其他设备；
6. `TTL`：记录还有多久老化；
7. VLAN、LAG、MAU、MTU 等扩展 TLV：核对接入策略和链路能力。

一条邻居记录证明“某个二层报文声称自己是这个设备/端口”，不等价于交换机配置、线缆标签或 CMDB 一定正确。

### 5.2 查看本地接口与 chassis

```bash
lldpcli show interfaces
lldpcli show interfaces details
lldpcli show interfaces ports eth0 details
lldpcli show chassis
lldpcli show chassis details
```

`show interfaces` 关注本地 agent 在哪些端口工作、采用什么 port ID、发送什么能力；`show chassis` 关注本机作为 LLDP chassis 对外宣告的身份。

把它和内核对象交叉核对：

```bash
ip -br link
ethtool eth0
lldpcli show interfaces ports eth0 details
```

### 5.3 查看运行配置

```bash
lldpcli show configuration
lldpcli -f keyvalue show configuration
```

重点核对：

- interface pattern 是否选中了期望端口；
- management address pattern 是否泄露或遗漏地址；
- tx interval、hold、fast-start；
- capabilities、port description、management address 是否发送；
- LLDP agent 是收发、只收、只发还是禁用；
- 是否启用了 CDP/FDP/EDP/SONMP 等兼容协议。

### 5.4 查看统计

```bash
lldpcli show statistics
lldpcli show statistics summary
lldpcli show statistics ports eth0
```

统计项随版本和协议而异，排障时重点看：

- transmitted：是否持续发送；
- received：是否收到对端帧；
- discarded/unrecognized：报文是否丢弃或 TLV 无法识别；
- ageout：邻居是否因 TTL 到期反复删除；
- insert/delete：邻居是否频繁抖动。

单次绝对值意义有限，最好间隔采样增量：

```bash
date -Is
lldpcli -f keyvalue show statistics ports eth0
# 等待一个发送周期后再次执行并比较
```

## 6. 事件监听、刷新和交互模式

### 6.1 `watch`

`watch` 持续报告邻居新增、更新和删除事件：

```bash
lldpcli watch
lldpcli watch limit 10
lldpcli -f keyvalue watch limit 20
```

它适合在换线、交换机端口变更或 Bond 切换时观察事件，不适合没有超时和日志轮转的永久脚本。自动化应给进程设置期限，并保存接口、事件类型和时间戳。

### 6.2 `update`

```bash
lldpcli update
```

`update` 要求守护进程立即更新/发送本地信息，适用于修改配置后的受控验证。它不会让对端必须回复，也不能替代抓包。

### 6.3 交互模式与帮助

不带 command 时可以进入交互模式：

```bash
lldpcli
```

在提示符内使用：

```text
help
show neighbors details
show configuration
exit
```

生产自动化建议传入完整命令，避免交互状态和人工输入不可复现。

## 7. 为脚本选择 `json0` 或 `keyvalue`

### 7.1 JSON0

```bash
lldpcli -f json0 show neighbors details
```

`json0` 是比旧 `json` 更适合解析的稳定结构。脚本仍需防御以下现实：

- 某些可选 TLV 完全不存在；
- 一个接口可能存在多个邻居；
- chassis ID/port ID 有 MAC、local、ifname 等不同 subtype；
- 不同交换机厂商的 port description 命名不同；
- 软件升级可能增加字段，解析器应忽略未知键。

先保存原始证据，再提取字段：

```bash
lldpcli -f json0 show neighbors details > /tmp/lldp-neighbors.json
jq . /tmp/lldp-neighbors.json
```

### 7.2 Key-value

```bash
lldpcli -f keyvalue show neighbors ports eth0 details
```

它适合快速比对和归档：

```bash
lldpcli -f keyvalue show neighbors details \
  | grep -E 'chassis.name|chassis.mgmt-ip|port.ifname|port.descr|ttl'
```

字段路径应先在本机样本上确认，不能假设所有版本和邻居都有相同键。

## 8. 从 LLDP 输出还原机架拓扑

以服务器 `eth0` 为例，目标是建立下面的映射：

```text
服务器 hostname / NIC PCI BDF / eth0 / MAC
    ↓ 线缆
Leaf-01 / Ethernet1/17 / VLAN 或 LAG / 速率
```

建议收集：

```bash
hostnamectl --static
ip -br link show eth0
ethtool -i eth0
ethtool eth0
readlink -f /sys/class/net/eth0/device
lldpcli -f keyvalue show neighbors ports eth0 details
```

然后与交换机、CMDB、布线表核对：

| 本机证据 | 对端证据 | 要验证的关系 |
|---|---|---|
| interface/MAC/PCI BDF | switch port | 网卡和物理端口是否一一对应 |
| negotiated speed | port speed | 速率和 FEC 是否符合设计 |
| PortID/PortDescr | interface name/description | 是否接错机架或端口 |
| Link aggregation TLV | LAG/MLAG 成员 | Bond 成员和 port-channel 是否一致 |
| VLAN/PVID TLV | access/trunk 配置 | 本机预期网络和交换机 VLAN 是否一致 |
| management IP/SysName | 资产系统 | 是否连到预期 Leaf |

LLDP 不一定宣告全部交换机配置。没有 VLAN TLV 不能直接证明端口没有 VLAN；最终仍需交换机配置和数据面测试佐证。

## 9. 配置与反配置的对象模型

`lldpcli` 采用可读命令句式：

```text
configure <object> <property> <value>
unconfigure <object> <property>
```

先用上下文帮助确认本机语法：

```bash
lldpcli help configure
lldpcli help configure system
lldpcli help configure ports
```

### 9.1 系统身份

```bash
lldpcli configure system hostname gpu-node-01
lldpcli configure system description "GPU compute node"
lldpcli configure system platform "x86_64 GPU server"
lldpcli configure system chassisid 02:00:00:00:00:01
```

撤销显式覆盖，恢复自动发现值：

```bash
lldpcli unconfigure system hostname
lldpcli unconfigure system description
lldpcli unconfigure system platform
lldpcli unconfigure system chassisid
```

不要随意伪造 chassis ID。拓扑系统经常用 chassis ID + port ID 作为邻居唯一键，修改它会生成“新设备”。

### 9.2 接口和管理地址 pattern

```bash
lldpcli configure system interface pattern "eth*,enp*,bond*"
lldpcli configure system interface permanent "eth0,eth1"
lldpcli configure system ip management pattern "10.20.*,!10.20.99.*"
```

pattern 的精确语义、否定规则和接口选择优先级随版本配置说明复核。配置前先列出接口，不要用过宽 pattern 将容器 veth、CNI bridge、存储后端或管理外网全部对外宣告。

恢复默认选择：

```bash
lldpcli unconfigure system interface pattern
lldpcli unconfigure system interface permanent
lldpcli unconfigure system ip management pattern
```

### 9.3 端口描述、promiscuous 和 Bond 源 MAC

官方配置还提供端口描述覆盖、接口 promiscuous 行为，以及 Bond slave 发送源 MAC 类型选择。不同版本的枚举值可能不同，应从帮助获取：

```bash
lldpcli help configure system interface description
lldpcli help configure system interface promiscuous
lldpcli help configure system bond-slave-src-mac-type
```

这些选项会改变交换机看到的身份或帧接收行为，不应在生产现场凭经验试值。

## 10. 控制发送周期、TTL 和端口方向

### 10.1 发送周期与 hold

```bash
lldpcli configure lldp tx-interval 30
lldpcli configure lldp tx-hold 4
lldpcli configure lldp tx-interval 500ms
```

官方基线中 `tx-interval` 秒级范围为 1–3600，并支持 `ms`；`tx-hold` 范围为 1–100。过短周期会增加控制报文和事件量，过长周期会延迟拓扑收敛。

恢复默认：

```bash
lldpcli unconfigure lldp tx-interval
lldpcli unconfigure lldp tx-hold
```

### 10.2 每端口 agent 状态

```bash
lldpcli configure ports eth0 lldp status rx-and-tx
lldpcli configure ports eth0 lldp status rx-only
lldpcli configure ports eth0 lldp status tx-only
lldpcli configure ports eth0 lldp status disabled
```

| 状态 | 接收 | 发送 | 场景 |
|---|---:|---:|---|
| `rx-and-tx` | 是 | 是 | 常规双向发现 |
| `rx-only` | 是 | 否 | 只观察邻居，减少本机信息暴露 |
| `tx-only` | 否 | 是 | 特殊自动化场景 |
| `disabled` | 否 | 否 | 明确不参与 LLDP |

修改后立即核对并抓包：

```bash
lldpcli show interfaces ports eth0 details
lldpcli update
tcpdump -i eth0 -nn -e -vv -c 10 'ether proto 0x88cc'
```

## 11. 控制 LLDP 宣告内容

`lldpcli` 能控制 capability、management address、port description、port ID subtype、agent type 和 fast-start 等信息。由于不同版本的精确子句较多，先查看帮助：

```bash
lldpcli help configure system capabilities
lldpcli help configure lldp portidsubtype
lldpcli help configure lldp portdescription
lldpcli help configure lldp management-addresses-advertisements
lldpcli help configure lldp capabilities-advertisements
lldpcli help configure lldp agent-type
lldpcli help configure lldp fast-start
```

设计原则：

- 只宣告拓扑系统真正需要的信息；
- capability 必须与主机真实转发角色一致；
- management address 只选择受控管理网地址；
- port description 保持稳定，避免动态字符串导致 CMDB 反复变更；
- fast-start 适合链路上线后加速通告，但要评估规模和交换机控制面。

## 12. VLAN、链路聚合、自定义 TLV 与 LLDP-MED

### 12.1 VLAN 和链路层扩展

LLDP 802.1/802.3 扩展可以携带 PVID、PPVID、VLAN name、link aggregation、MAC/PHY、maximum frame size 等信息。查询时：

```bash
lldpcli show neighbors ports eth0 details
```

配置端可查看本机支持的语法：

```bash
lldpcli help configure ports eth0 lldp vlan-tx
lldpcli help configure ports eth0 lldp custom-tlv
lldpcli help configure lldp custom-tlv
```

自定义 TLV 很容易产生厂商兼容和信息泄露问题。必须明确 OUI、subtype、payload 编码、长度和删除方式，并用抓包验证，不要把任意文本直接当 payload。

### 12.2 LLDP-MED 与 PoE

LLDP-MED 常见于电话、AP 和终端策略，可宣告：

- location；
- network policy；
- inventory；
- PoE/电源能力。

802.3 power TLV 也能表达供电角色和功率。服务器网络通常只需要识别这些字段，不应在不了解交换机策略时主动修改：

```bash
lldpcli help configure med
lldpcli help configure dot3
lldpcli show neighbors details
```

## 13. 暂停与恢复守护进程工作

```bash
lldpcli pause
lldpcli resume
```

`pause`/`resume` 会影响守护进程协议处理，用于受控维护或测试，不是普通“刷新”手段。生产执行前确认影响范围和回滚，并在恢复后检查：

```bash
lldpcli resume
lldpcli update
lldpcli show statistics
lldpcli show neighbors details
```

排障时不要用重启或 pause/resume 代替证据采集，否则会清理或改变邻居现场。

## 14. 持久配置

交互执行的 `configure` 改变运行中的 lldpd 状态，但服务重启后是否保留取决于发行版启动配置。常见持久入口是：

```text
/etc/lldpd.conf
/etc/lldpd.d/*.conf
```

配置文件中的内容使用 lldpcli 命令语法，例如：

```text
configure system hostname gpu-node-01
configure system interface pattern eth*,enp*,bond*
configure lldp tx-interval 30
configure lldp tx-hold 4
```

先确认软件包实际加载路径：

```bash
systemctl cat lldpd
lldpcli -vv
man lldpd
man lldpcli
```

验证持久性时遵守变更窗口：

1. 保存当前 `show configuration`；
2. 修改最小配置；
3. 先做语法和运行时加载验证；
4. 经批准重启服务；
5. 再次比较 configuration、interfaces、neighbors 和抓包；
6. 准备回滚文件与服务恢复命令。

不要为了测试持久性直接在远程生产节点重启网络相关服务。

## 15. Bond、Bridge、VLAN 和容器环境

### 15.1 Bond/Team

服务器通常在物理 slave 上连接两个交换机，而业务地址位于 Bond master：

```text
eth0 -- Leaf-A ┐
               ├-- bond0 -- IP
eth1 -- Leaf-B ┘
```

因此拓扑排查要同时看：

```bash
cat /proc/net/bonding/bond0
ip -d link show bond0
lldpcli show neighbors ports eth0,eth1 details
```

邻居落在 master 还是 slave、发送源 MAC 如何选择，取决于内核、Bond 模式、lldpd 版本和配置。不要看到 bond0 没邻居就断言 LLDP 失败，应先检查物理成员。

### 15.2 Bridge/VLAN

LLDP 通常属于物理链路发现。Linux bridge、VLAN 子接口和 SR-IOV VF 会增加接口层次：

```bash
ip -d link show
bridge link show
bridge vlan show
lldpcli show interfaces details
```

交换机接收的是哪个设备发出的帧，受 interface pattern、bridge/bond 处理、VLAN tag 和驱动行为影响。用下面的抓包点对比：

```bash
tcpdump -i eth0 -nn -e -vv 'ether proto 0x88cc'
tcpdump -i bond0 -nn -e -vv 'ether proto 0x88cc'
```

### 15.3 Network namespace 和容器

`lldpd` 通常运行在宿主机网络命名空间。容器内即使安装了 `lldpcli`，也可能看不到宿主机 socket 或物理接口。排障先确认：

```bash
readlink /proc/1/ns/net
readlink /proc/self/ns/net
ss -xl | grep lldp
```

不要把宿主机控制 socket 随意挂载到不可信容器，它允许读取资产信息，某些权限下还可修改 LLDP 状态。

## 16. AI/GPU 集群中的典型用途

### 16.1 训练网卡—Leaf 映射

GPU 节点常有管理网、存储网和多 rail 训练网。LLDP 能验证每个 HCA/NIC 是否接到预期 Leaf：

```bash
for dev in eth0 eth1 eth2 eth3; do
  echo "interface=$dev"
  lldpcli -f keyvalue show neighbors ports "$dev" details
done
```

将结果与以下信息串联：

```bash
ethtool -i eth2
readlink -f /sys/class/net/eth2/device
nvidia-smi topo -m
```

最终得到：

```text
GPU / PCIe Root Complex / NUMA
        ↕
NIC PCI BDF / Linux interface
        ↕
Leaf / switch port / rail / failure domain
```

这张关系表可用于 NCCL rail 选择、拓扑感知调度和换线验收，但 LLDP 本身不会告诉你 RDMA QP、PFC/ECN 计数或 NCCL 实际选路。

### 16.2 新节点验收

新 GPU 节点至少核对：

- 每块物理网卡都有且只有预期邻居；
- 双上联落在正确的 Leaf/MLAG 对；
- 对端端口名与机架布线记录一致；
- 链路聚合、VLAN 和 MTU TLV 没有明显矛盾；
- LLDP 邻居在观察期内不反复 ageout；
- CMDB 中 NIC MAC/PCI BDF/交换机端口/rail 关系一致。

## 17. “没有 LLDP 邻居”的分层排查

### 第 1 步：确认客户端和 daemon

```bash
lldpcli -v
systemctl status lldpd --no-pager
lldpcli show configuration
```

如果 socket 连接失败，先查 daemon、socket 路径和权限，不要直接归因于交换机。

### 第 2 步：确认接口存在且有物理链路

```bash
ip -br link show eth0
ethtool eth0
lldpcli show interfaces ports eth0 details
```

检查 interface pattern、端口 agent status、carrier 和正确接口名。

### 第 3 步：直接抓 LLDP 帧

```bash
tcpdump -i eth0 -nn -e -vv -c 20 'ether proto 0x88cc'
```

| 抓包结果 | 初步结论 |
|---|---|
| 有收也有发，cli 无邻居 | 查 smart filter、TLV 解析、daemon 日志与缓存 |
| 只有本机发 | 查交换机 LLDP 是否启用、端口方向、链路层过滤 |
| 只有对端发 | 查 lldpd 发送状态和 interface pattern；接收本身可能正常 |
| 完全没有 | 查抓包接口、daemon、链路、Bond/Bridge 层次和 LLDP 所有者 |

### 第 4 步：显示被隐藏邻居和统计

```bash
lldpcli show neighbors hidden details
lldpcli show statistics ports eth0
journalctl -u lldpd --since '-15 min' --no-pager
```

smart filtering 可能隐藏某些冗余或兼容协议邻居。`hidden` 有记录时，重点查过滤策略，不要误判“没收包”。

### 第 5 步：核对交换机与中间层

由网络侧确认：

- 接口 LLDP transmit/receive 是否启用；
- 是否有 control-plane policing；
- 端口安全、隧道或虚拟交换层是否过滤 `01:80:c2:00:00:0e`；
- MLAG/LAG 成员和实际线缆是否一致；
- 交换机看到的源 MAC/port ID 是否符合预期。

### 第 6 步：最小变更验证

只有在证据指向本机发送状态且变更获批时，才执行：

```bash
lldpcli configure ports eth0 lldp status rx-and-tx
lldpcli update
lldpcli watch limit 10
```

测试完成后应按配置管理的期望恢复，而不是留下临时运行时配置。

## 18. 常见误区

### 误区 1：LLDP 能发现整条网络路径

LLDP 只发现直连链路邻居。跨三层路径用路由和逐跳工具验证。

### 误区 2：看不到邻居就是线缆坏了

daemon、socket 权限、interface pattern、rx/tx 方向、交换机配置、smart filter 都可能造成相同现象。

### 误区 3：`nmcli`、`networkctl`、`lldpcli` 的邻居应该完全一致

它们可能由不同 agent、不同接口选择和不同缓存周期产生，必须先确认配置所有权。

### 误区 4：LLDP 中的 VLAN 就是交换机完整配置

LLDP 只显示对端愿意宣告且本机能够解析的 TLV，不能替代交换机 running configuration。

### 误区 5：用 system name 作为唯一资产键

system name 可以重复或被修改。至少组合 chassis ID、port ID、management IP、MAC、交换机侧接口和 CMDB 信息。

### 误区 6：脚本解析 `plain` 对齐文本

不同版本、字段长度和本地化会破坏脚本。使用 `json0`/`keyvalue`，容忍可选字段和未知字段。

### 误区 7：为了立即看到邻居而高频发送

过短 interval 会扩大整个集群的控制报文与事件量。正常刷新使用 `update`，周期设计要考虑节点规模和拓扑系统处理能力。

## 19. 一份可复用的只读取证模板

```bash
date -Is
hostnamectl --static

# 软件、服务与所有权
lldpcli -vv
systemctl is-active lldpd
systemctl is-active NetworkManager
systemctl is-active systemd-networkd

# 本机链路
ip -br link
ethtool eth0
readlink -f /sys/class/net/eth0/device

# lldpd 配置、接口、邻居和统计
lldpcli -f keyvalue show configuration
lldpcli -f keyvalue show interfaces ports eth0 details
lldpcli -f keyvalue show neighbors ports eth0 details
lldpcli -f keyvalue show neighbors ports eth0 hidden details
lldpcli -f keyvalue show statistics ports eth0

# 最小抓包；生产环境限制数量
tcpdump -i eth0 -nn -e -vv -c 20 'ether proto 0x88cc'
```

这套证据可以区分“客户端无法连接”“daemon 没管理接口”“本机没有发”“交换机没有发”“收到但被过滤/解析失败”和“邻居反复老化”。

## 20. 与其他命令的组合

| 问题 | 组合命令 |
|---|---|
| 接口连到哪里 | `lldpcli` + 交换机 LLDP neighbor/接口配置 |
| 物理链路是否正常 | `lldpcli` + `ethtool` + `ip -s link` |
| VLAN 接入是否正确 | `lldpcli` + `bridge vlan` + `ip -d link` + 抓包 |
| Bond 成员是否接错 | `lldpcli` + `/proc/net/bonding/*` + 交换机 LAG |
| 地址冲突或网关二层可达 | `arping` + `ip neighbour`，不是 LLDP |
| IP 路径异常 | `ip route get` + `ping` + `traceroute/mtr` |
| RoCE/NCCL 性能异常 | LLDP 只核对布线；继续查 PFC/ECN、RDMA counters、PCIe/NUMA 和 NCCL |

## 21. 官方资料

- [lldpd 官方 Usage 与 lldpcli 命令参考](https://lldpd.github.io/usage.html)
- [lldpd 官方项目与发布说明](https://github.com/lldpd/lldpd)
- [IEEE 802.1AB LLDP 标准入口](https://1.ieee802.org/tsn/802-1ab/)

学习 `lldpcli` 的完成标准不是背下 `show neighbors`，而是能将本机接口、NIC PCI 拓扑、线缆、交换机端口、VLAN/LAG 和故障域组成一条可验证的资产链，并在邻居缺失时用 daemon、配置、统计与抓包逐层定位。
