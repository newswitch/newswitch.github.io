---
title: networkctl 命令详解：systemd-networkd 状态、配置与重载
sidebar_position: 22
description: 以 systemd 上游 networkctl 手册为基线，系统讲解 list/status、operational/setup/online 状态、DHCP lease、LLDP、renew、reconfigure、reload、edit/cat/mask，以及 .network/.netdev/.link 配置模型。
tags: [Linux, networkctl, systemd-networkd, DHCP, LLDP, 路由, 网络配置]
---

# `networkctl` 命令详解：systemd-networkd 状态、配置与重载

`networkctl` 用于查看和控制 `systemd-networkd` 管理的链路。它能展示内核链路状态、networkd 配置匹配、地址、路由、DNS、DHCP lease、LLDP 邻居和日志，也能触发 up/down、renew、reload、reconfigure 和配置文件编辑。

它不是通用的 `ip` 替代品：

```text
ip           -> 直接观察/操作内核网络对象
networkctl   -> 观察/控制 systemd-networkd 的配置与状态
resolvectl   -> 观察/控制 systemd-resolved DNS 路由与缓存
```

## 1. 先确认配置所有权

```bash
networkctl --version
systemctl status systemd-networkd --no-pager
systemctl status NetworkManager --no-pager
networkctl list
```

如果 `networkctl` 显示某接口为 `unmanaged`，不一定是故障，可能由 NetworkManager、ifupdown、CNI 或云代理管理。

```bash
nmcli device status
ip -br link
ip -br address
```

禁止 NetworkManager 与 networkd 同时管理同一接口，否则 DHCP、地址、路由和 DNS 会互相覆盖。

## 2. 权限与安全边界

| 操作 | 级别 | 风险 |
|---|---|---|
| `list/status/cat/lldp/label/dhcp-lease` | `[R]` | 输出含内部地址、DHCP、DNS、邻居和配置 |
| `renew/reconfigure/reload` | `[W]`/`[D]` | DHCP、地址、路由和 DNS 可能变化 |
| `up/down` | `[W]`/`[D]` | down 可立即切断网络 |
| `edit/mask/unmask` | `[W]`/`[D]` | 改变持久或运行时配置优先级 |
| `delete` | `[D]` | 删除虚拟 netdev |

远程变更需要带外控制台和外部回滚机制。`networkctl` 没有与 nmcli checkpoint 完全相同的一站式确认回滚命令。

## 3. 配置文件模型

systemd 网络配置主要分三类：

| 文件 | 作用 |
|---|---|
| `.link` | udev 阶段设置接口名、MAC、MTU、WakeOnLan 等链路属性 |
| `.netdev` | 创建 bridge、bond、VLAN、VXLAN、VRF、veth 等虚拟设备 |
| `.network` | 匹配已有接口并配置地址、DHCP、路由、DNS、加入 bridge/bond 等 |

目录优先级：

```text
/etc/systemd/network    -> 管理员持久配置，优先级最高
/run/systemd/network    -> 运行时配置
/usr/local/lib/systemd/network
/usr/lib/systemd/network -> 发行版/软件包配置
```

所有文件按文件名排序；相同文件名由高优先级目录覆盖。`.network` 通常使用“第一个匹配文件”，因此文件名前缀和 Match 条件非常重要。

```bash
find /etc/systemd/network /run/systemd/network /usr/lib/systemd/network \
  -maxdepth 2 -type f -o -type l
```

## 4. 语法、全部全局参数

```text
networkctl [OPTIONS...] COMMAND [LINK...]
```

| 参数 | 作用 |
|---|---|
| `-a` / `--all` | `status` 时显示所有 link |
| `-s` / `--stats` | `status` 时显示链路统计 |
| `-l` / `--full` | 不截断/省略输出 |
| `-n N` / `--lines=N` | `status` 显示最近 N 行 journal，默认 10 |
| `--drop-in=NAME` | `edit` 编辑指定 drop-in，而不是主文件 |
| `--no-reload` | `edit/mask/unmask` 后不自动 reload networkd/udevd |
| `--runtime` | `edit/mask` 写入 `/run` 而不是 `/etc` |
| `--stdin` | `edit` 从 stdin 读完整新内容并覆盖旧内容，脚本使用时高风险 |
| `--no-ask-password` | 权限不足时不交互询问认证 |
| `--json=MODE` | JSON `short/pretty/off`，并非每个 command 都支持 |
| `-h` / `--help` | 显示帮助 |
| `--version` | 显示 systemd 版本 |
| `--no-legend` | 不显示表头和提示 |
| `--no-pager` | 不使用分页器 |

自动化推荐：

```bash
networkctl --no-pager --no-legend list
networkctl --json=pretty status eth0
```

JSON 支持范围随 systemd 版本变化，脚本应先固定版本和 command schema。

## 5. 命令全集

| command | 作用 | 级别 |
|---|---|---|
| `list [PATTERN...]` | 列出链路，通常为默认命令 | `[R]` |
| `status [PATTERN...]` | 详细状态、配置和日志 | `[R]` |
| `dhcp-lease IFACE [CODE[:FORMAT]...]` | 显示 DHCPACK/option，较新版本支持 | `[R]` |
| `lldp [PATTERN...]` | 显示 networkd 学到的 LLDP 邻居 | `[R]` |
| `label` | 显示 IPv6 address selection label | `[R]` |
| `delete DEVICE...` | 删除虚拟 netdev | `[D]` |
| `up DEVICE...` | 设置管理状态 UP | `[W]` |
| `down DEVICE...` | 设置管理状态 DOWN | `[D]` |
| `renew DEVICE...` | 重新获取 DHCP/动态配置 | `[W]`/`[D]` |
| `forcerenew DEVICE...` | DHCP server 向连接客户端发送 FORCERENEW，适用场景受配置限制 | `[W]`/`[D]` |
| `reconfigure DEVICE...` | 按已加载配置重新配置接口 | `[W]`/`[D]` |
| `reload` | 重新读取 `.network/.netdev`，并处理匹配接口 | `[W]`/`[D]` |
| `edit FILE|@DEVICE...` | 编辑配置或关联 drop-in | `[W]`/`[D]` |
| `cat [FILE|@DEVICE...]` | 显示配置及 drop-in | `[R]` |
| `mask FILE...` | 用 `/dev/null` 链接屏蔽配置 | `[D]` |
| `unmask FILE...` | 解除 mask | `[W]`/`[D]` |
| `persistent-storage BOOL` | 通知 networkd 持久存储就绪，通常仅由系统服务调用 |

## 6. `list`：链路、operational state 与 setup state

```bash
networkctl list
networkctl list 'eth*'
networkctl --no-legend --no-pager list
```

常见列：

```text
IDX LINK TYPE OPERATIONAL SETUP
```

### operational state

| 状态 | 含义 |
|---|---|
| `missing` | 设备暂时不在系统中 |
| `off` | 管理状态关闭 |
| `no-carrier` | UP 但无 carrier |
| `dormant` | 有 carrier，但驱动/协议未准备好 |
| `carrier` | 有 carrier，但还没有地址 |
| `degraded-carrier` | 聚合设备部分 port 无 carrier，版本支持时出现 |
| `degraded` | 有 carrier 和 link-local 范围地址，但未达到 routable |
| `enslaved` | 作为 bond/bridge port |
| `routable` | 有可路由地址；不等于互联网或业务一定可达 |

### setup state

| 状态 | 含义 |
|---|---|
| `pending` | udev 尚未完成处理 |
| `initialized` | udev 已处理，networkd 还未决定是否管理 |
| `configuring` | 正在获取/应用配置 |
| `configured` | networkd 认为配置成功 |
| `unmanaged` | networkd 不管理 |
| `failed` | 配置失败 |
| `linger` | link 已消失但 networkd 尚未清理状态 |

`routable/configured` 是 networkd 状态判断，不会验证远端业务、DNS 或互联网。

## 7. `status`：配置匹配和运行态的核心证据

```bash
networkctl status
networkctl status eth0
networkctl --all --stats --full --lines=50 status
```

重点字段：

| 字段 | 排查问题 |
|---|---|
| State / Online state | link 是否达到配置要求 |
| Path / Driver / Vendor/Model | udev/sysfs 硬件路径和驱动 |
| HW Address / MTU / QDisc | 二层与队列基础 |
| Link File / Network File | 实际匹配哪个 `.link/.network` |
| Addresses / Gateway / Routes | networkd 当前理解的配置 |
| DNS / Search Domains / NTP | per-link 服务配置 |
| Activation Policy / Required For Online | 开机等待和管理策略 |
| LLDP / DHCP / IPv6 RA | 动态配置来源 |
| journal | 最近 networkd 日志 |

必须把 networkctl 与内核实际状态交叉检查：

```bash
networkctl status eth0
ip -d link show eth0
ip address show dev eth0
ip rule show
ip route show table all
resolvectl status eth0
```

## 8. Online state 与 wait-online

整体 `networkctl status` 可能显示：

| Online state | 含义 |
|---|---|
| `unknown` | 没有 required link 或无法判断 |
| `offline` | 所有 required link 均未 online |
| `partial` | 部分 required link online |
| `online` | 所有 required link 达到配置的 online 条件 |

`systemd-networkd-wait-online.service` 等待的是 networkd 定义的 online 条件，不是“能访问业务”。多口服务器、可选存储网、未插线接口和 bond port 应通过 `.network` 的 `RequiredForOnline=`、`RequiredFamilyForOnline=` 等正确建模，避免开机无意义等待。

## 9. `dhcp-lease`

较新 systemd 支持：

```bash
networkctl dhcp-lease eth0
networkctl dhcp-lease eth0 1 3 6 15 51 54 58 59 119
networkctl --json=pretty dhcp-lease eth0
```

常见 option：

| Code | 含义 |
|---|---|
| 1 | subnet mask |
| 3 | router |
| 6 | DNS server |
| 12 | hostname |
| 15 | domain name |
| 42 | NTP server |
| 51 | lease time |
| 54 | DHCP server identifier |
| 58/59 | T1 renewal / T2 rebinding |
| 119 | domain search |

命令支持 `CODE:FORMAT` 自定义格式，取值以本机手册为准。旧 systemd 没有此命令时，从 `networkctl status`、journal 和 lease 文件收集证据。

## 10. `renew` 与 `forcerenew`

```bash
# [W]/[D] DHCP client 重新获取动态配置
sudo networkctl renew eth0

# [W]/[D] DHCP server 场景向客户端触发 FORCERENEW
sudo networkctl forcerenew lan0
```

`renew` 可能改变地址、默认路由、DNS 和 lease，因此远程执行有断连风险。`forcerenew` 不是“更强的客户端 renew”，它用于 networkd DHCP server 的客户端重配置场景。

执行前后保存：

```bash
networkctl status eth0
ip address show dev eth0
ip route show table all
resolvectl status eth0
journalctl -u systemd-networkd --since '-5 min' --no-pager
```

## 11. `reload` 与 `reconfigure`

```text
networkctl reload             -> 重新读取 .network/.netdev，匹配文件变化的接口会处理
networkctl reconfigure eth0   -> 用 networkd 已加载的配置重新配置 eth0
```

正确流程：

```bash
# 1. 保存现状
networkctl cat @eth0:all
networkctl status eth0

# 2. 修改/部署文件并做版本控制审查

# 3. [W]/[D] 重新加载并重新配置
sudo networkctl reload
sudo networkctl reconfigure eth0

# 4. 验证
networkctl status eth0
ip address show dev eth0
ip route show table all
```

当前上游 `reload` 对新建、修改、删除 `.network` 文件会重新配置匹配接口，但不同版本行为有差异。显式 `reconfigure` 仍利于限定对象和理解变更范围。

## 12. reload 不能完成的操作

`.netdev` 中某些创建时属性不能在线修改，例如 VLAN ID。即使配置文件被删除，networkd 也通常不会自动删除已存在的虚拟 netdev。

```text
改 VLAN Id= -> 旧 VLAN 设备仍存在，需规划删除和重建
删 .netdev  -> 对应 bridge/bond/vlan 可能仍留在内核
重启 networkd -> 一般保留已有内核网络配置，不等于清空重建
```

删除虚拟设备前确认从属关系、路由、地址和业务：

```bash
networkctl status vlan100
ip -d link show vlan100
# [D] 经审批后
sudo networkctl delete vlan100
```

## 13. `up`、`down` 与 `delete`

```bash
sudo networkctl up eth0
sudo networkctl down eth0
sudo networkctl delete vlan100
```

| command | 对象 | 风险 |
|---|---|---|
| `up` | 设置 link admin up | 仍需 network config/carrier 才能通信 |
| `down` | 设置 admin down | 立即中断该接口流量 |
| `delete` | 删除虚拟 netdev | bridge/bond/VLAN/VXLAN 等数据路径消失 |

硬件接口不能靠 `networkctl delete` 从 PCI/内核永久移除。删除配置文件也不等于删除运行态设备。

## 14. `cat`：查看真正生效的配置来源

```bash
# networkd.conf 及 drop-in
networkctl cat

# 指定文件
networkctl cat 10-eth0.network

# eth0 匹配的 network/link/netdev 配置
networkctl cat @eth0
networkctl cat @eth0:network
networkctl cat @eth0:link
networkctl cat @eth0:netdev
networkctl cat @eth0:all
```

`@DEVICE` 与 suffix 是较新版本能力。旧版本需通过 `networkctl status` 的 Network File/Link File 和文件系统手工检查。

## 15. `edit` 与 drop-in

```bash
# [W] 编辑主配置文件
sudo networkctl edit 10-eth0.network

# [W] 为 eth0 匹配配置创建/编辑 drop-in
sudo networkctl edit --drop-in=50-local.conf @eth0:network

# [W] 临时写入 /run
sudo networkctl --runtime edit --drop-in=50-debug.conf @eth0:network
```

默认编辑完成后会 reload；`--no-reload` 可以分离“部署文件”和“应用变更”。`.link` 重新加载后不会自动把所有链路属性重新应用，可能需要触发 uevent 或重建设备，必须按 `systemd.link` 文档操作。

`--stdin` 会用标准输入内容覆盖目标文件，适合受控部署工具，不适合不透明 shell 拼接：

```text
networkctl edit --stdin ...
```

脚本应先生成、审查、备份并验证明确文件，再调用管理命令。

## 16. `mask` 与 `unmask`

```bash
# [D] 在 /etc 或 --runtime 指定目录创建指向 /dev/null 的同名链接
sudo networkctl mask 80-example.network

# [W]/[D] 解除
sudo networkctl unmask 80-example.network
```

mask 用高优先级同名 `/dev/null` 链接屏蔽供应商配置。风险包括：

- 匹配落到下一份 `.network` 文件；
- 接口变为 unmanaged 或获得完全不同配置；
- runtime mask 重启后消失；
- unmask 不一定自动恢复原运行态。

先用 `networkctl cat`、文件排序和 Match 条件推演回退后的命中结果。

## 17. 静态地址 `.network` 示例

```ini
# /etc/systemd/network/10-eth0.network
[Match]
Name=eth0

[Link]
RequiredForOnline=yes

[Network]
Address=192.0.2.10/24
Gateway=192.0.2.1
DNS=192.0.2.53
Domains=example.com
IPv6AcceptRA=no
```

这是 TEST-NET 示例，不能直接上线。现代配置更推荐在 `[Route]` 明确默认路由：

```ini
[Route]
Destination=0.0.0.0/0
Gateway=192.0.2.1
Metric=100
```

同一接口只能由一套配置管理器负责；云主机还需核对 cloud-init/netplan 是否生成 networkd 文件。

## 18. VLAN `.netdev` 与 `.network`

```ini
# /etc/systemd/network/20-vlan100.netdev
[NetDev]
Name=vlan100
Kind=vlan

[VLAN]
Id=100
```

```ini
# /etc/systemd/network/20-eth0.network
[Match]
Name=eth0

[Network]
VLAN=vlan100
```

```ini
# /etc/systemd/network/20-vlan100.network
[Match]
Name=vlan100

[Network]
Address=192.0.2.10/24
```

验证：

```bash
networkctl status eth0 vlan100
ip -d link show vlan100
bridge vlan show
```

交换机 trunk、VLAN allowed list、native VLAN 和 MTU 必须匹配。

## 19. LLDP

`.network` 启用：

```ini
[Network]
LLDP=yes
EmitLLDP=yes
```

查询：

```bash
networkctl lldp
networkctl lldp eth0
```

未显示邻居时检查：

- `.network` 是否真正匹配；
- `LLDP=` 是否启用接收；
- 交换机端是否发送 LLDP；
- 接口是否是物理口或 bond/bridge port；
- 抓包能否看到 EtherType `0x88cc`；
- 是否由 lldpd 或其他 daemon 负责 LLDP。

```bash
sudo tcpdump -i eth0 -nn -e ether proto 0x88cc
```

## 20. `label`

```bash
networkctl label
ip addrlabel list
```

它显示 IPv6 source/destination address selection label，与接口 label 或防火墙 mark 不同。多地址 IPv6 环境中，地址选择问题需要结合 RFC 6724、route、scope、precedence 与应用 `getaddrinfo()` 分析。

## 21. 日志与失败状态

```bash
networkctl status eth0
journalctl -u systemd-networkd --since '-10 min' --no-pager
journalctl -u systemd-networkd-wait-online --since '-10 min' --no-pager
```

常见 `configuring` 卡住原因：

- 无 carrier 或 bond/bridge port 未就绪；
- DHCP 没有 Offer/ACK；
- IPv6 DAD 失败；
- 地址/路由冲突；
- `.network` 匹配了错误接口；
- 等待 IPv4/IPv6 family 条件；
- DNS/NTP 配置不影响 link configured，但可能影响上层服务；
- RequiredForOnline 条件过严。

## 22. 生产排障模板

```bash
date -Is
networkctl --version
systemctl is-active systemd-networkd
systemctl is-active NetworkManager

networkctl --no-pager list
networkctl --all --stats --full --lines=50 status
networkctl cat @eth0:all
networkctl dhcp-lease eth0
networkctl lldp eth0

ip -d link show eth0
ip address show dev eth0
ip rule show
ip route show table all
resolvectl status eth0
ethtool eth0
journalctl -u systemd-networkd --since '-10 min' --no-pager
```

旧版本不支持某个 command 时，保留版本信息并用 `ip`、journal、配置文件和对应服务工具替代。

## 23. 常见误区

| 误区 | 正确认识 |
|---|---|
| `configured/routable` 表示业务可用 | 它是 link/IP 配置状态，不验证应用 |
| networkctl 能管理所有 Linux 网络 | 它主要控制 systemd-networkd 管理对象 |
| reload 等于重启和完全重建 | 它重读配置，但某些 netdev 创建属性不能在线改 |
| 删除 `.netdev` 后接口自动消失 | 已有虚拟设备通常仍保留 |
| reconfigure 会先 reload 新文件 | 应先 reload，再 reconfigure，尤其旧版本 |
| renew 只更新 lease 时间 | 地址、路由、DNS 都可能改变 |
| forcerenew 是客户端强制 renew | 它面向 networkd DHCP server 触发客户端重配置 |
| `.network` 最具体匹配获胜 | 通常按文件排序，第一个匹配项生效 |
| `/etc` 的任意文件总覆盖 `/usr` | 相同文件名会覆盖；不同文件仍共同排序和匹配 |
| restart networkd 会自动删掉旧配置 | networkd 通常保留既有内核配置/设备，需明确清理 |

## 24. 官方资料

- [`networkctl(1)` systemd 上游手册镜像](https://man7.org/linux/man-pages/man1/networkctl.1.html)
- [`systemd-networkd.service(8)` 官方手册](https://www.freedesktop.org/software/systemd/man/latest/systemd-networkd.service.html)
- [`systemd.network(5)` 官方手册](https://www.freedesktop.org/software/systemd/man/latest/systemd.network.html)
- [`systemd.netdev(5)` 官方手册](https://www.freedesktop.org/software/systemd/man/latest/systemd.netdev.html)
- [`systemd.link(5)` 官方手册](https://www.freedesktop.org/software/systemd/man/latest/systemd.link.html)

