---
title: nmcli 命令详解：NetworkManager 配置、路由、DNS 与安全变更
sidebar_position: 21
description: 以 NetworkManager 1.58 为基线，系统讲解 nmcli 全局参数、device/profile/active connection 模型、静态地址、路由规则、DNS、Bond、Bridge、VLAN、Wi-Fi、LLDP、checkpoint 和自动化。
tags: [Linux, nmcli, NetworkManager, IP, 路由, DNS, Bond, VLAN]
---

# `nmcli` 命令详解：NetworkManager 配置、路由、DNS 与安全变更

`nmcli` 是 NetworkManager 的命令行客户端。它既能查询设备和活动网络状态，也能创建、修改、激活、停用和删除持久连接配置。

学习 `nmcli` 最容易混淆的不是参数，而是三个对象：

```text
device             -> 内核中的网卡/虚拟接口，例如 eth0、bond0
connection profile -> NetworkManager 保存的配置模板，有 name 和 UUID
active connection  -> 某个 profile 当前在某个 device 上激活后的运行态
```

同一 `eth0` 可以保存多个 profile，但通常只有一个 profile 在其上激活。修改 profile 不一定立即改变 active connection；临时修改 active device 也不一定写回 profile。

## 1. 版本、配置所有权与安全

本文以 NetworkManager 1.58 文档为基线：

```bash
nmcli --version
NetworkManager --version
systemctl status NetworkManager --no-pager
nmcli general status
nmcli device status
nmcli connection show --active
```

先排除其他配置管理器：

```bash
systemctl is-active systemd-networkd
networkctl list
ls -l /etc/NetworkManager/system-connections/
```

| 操作 | 级别 | 风险 |
|---|---|---|
| `show/status/get-values/monitor` | `[R]` | 输出可能包含地址、SSID、DHCP 和内部 DNS；`--show-secrets` 会泄露密码 |
| `connection add/modify/clone` | `[W]` | 改 profile 后可能在下次激活/重启生效 |
| `connection up/down`、`device up/down/reapply` | `[W]`/`[D]` | 可能立即更换地址、路由、DNS 或切断 SSH |
| `connection delete`、`device delete` | `[D]` | 删除配置或虚拟接口 |
| `networking off`、`radio off` | `[D]` | 停用受管网络或无线设备 |

远程变更优先使用 `nmcli device checkpoint` 自动回滚，并确保带外控制台可用。

## 2. 全局语法和所有顶层参数

```text
nmcli [GLOBAL OPTIONS] OBJECT { COMMAND | help }
```

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-a` | `--ask` | 交互询问缺少的参数/secret；脚本不要使用 |
| `-c MODE` | `--colors MODE` | `yes/no/auto` 控制颜色 |
| — | `--complete-args` | 输出最后一个参数的补全候选，不执行目标操作 |
| `-e BOOL` | `--escape BOOL` | terse 表格中是否转义 `:` 和反斜杠，默认 yes |
| `-f FIELDS` | `--fields FIELDS` | 选择输出字段，支持 `all/common` |
| `-g FIELDS` | `--get-values FIELDS` | 仅输出字段值，相当于 terse + tabular + fields |
| `-h` | `--help` | 显示帮助 |
| `-m MODE` | `--mode MODE` | `tabular` 或 `multiline` |
| `-p` | `--pretty` | 人类友好的对齐、标题和进度 |
| `-s` | `--show-secrets` | 显示 secret；避免在共享终端、日志和 CI 使用 |
| `-t` | `--terse` | 机器可读的简洁表格 |
| — | `--offline` | 不连接 daemon，通过 stdin/stdout 离线 add/modify keyfile |
| `-v` | `--version` | 显示版本 |
| `-w SEC` | `--wait SEC` | 等待操作完成的超时；0 表示不等待 |

脚本应固定 locale、字段和颜色：

```bash
LC_ALL=C nmcli --colors no --terse --fields DEVICE,TYPE,STATE,CONNECTION device status
LC_ALL=C nmcli -g GENERAL.STATE,GENERAL.CONNECTION device show eth0
```

不要解析默认 pretty 输出；字段和翻译会随版本/locale 变化。

## 3. 顶层 object

| object | 常用缩写 | 作用 |
|---|---|---|
| `general` | `g` | NetworkManager 整体状态、hostname、权限、日志、reload |
| `networking` | `n` | 全局网络开关与 connectivity |
| `radio` | `r` | Wi-Fi/WWAN radio 开关 |
| `connection` | `c`/`con` | profile 与 active connection 管理 |
| `device` | `d`/`dev` | 设备状态与临时运行态管理 |
| `monitor` | — | 监控 NetworkManager 全局事件 |
| `agent` | `a` | secret/polkit agent |

缩写只在不歧义时可用。博客示例以完整命令为主，生产脚本也推荐完整名称。

## 4. `nmcli general`

```text
nmcli general { status | hostname | permissions | logging | reload }
```

| command | 作用 |
|---|---|
| `status` | 整体状态，省略子命令时默认 |
| `hostname [NAME]` | 查询或设置持久 hostname；设置为 `[W]` |
| `permissions` | 查询调用者对网络开关、profile 修改等操作的权限 |
| `logging [level LEVEL] [domains DOMAINS]` | 查询或修改日志级别/域 |
| `reload [conf|dns-rc|dns-full...]` | 重新加载 NetworkManager 配置或 DNS 组件 |

```bash
nmcli general status
nmcli general permissions
nmcli general logging
```

`general reload conf` 不会重新读取 connection profile；手工修改 profile 文件后使用 `nmcli connection reload/load`。`dns-full` 会短暂中断名称解析。

临时 debug 前保存原日志配置，并避免长时间记录认证、SSID、DHCP 或内部网络细节：

```bash
nmcli general logging
sudo nmcli general logging level DEBUG domains CORE,DEVICE,IP4,IP6,DHCP4,DNS
journalctl -u NetworkManager -f
```

## 5. `networking`、`radio` 与 connectivity

```text
nmcli networking { on | off | connectivity [check] }
nmcli radio { all | wifi | wwan } [on|off]
```

```bash
nmcli networking connectivity
nmcli networking connectivity check
nmcli radio all
```

connectivity 可能为：

| 状态 | 含义 |
|---|---|
| `none` | 未连接网络 |
| `portal` | 被 captive portal 截获 |
| `limited` | 有本地网络但不能通过配置的探测访问互联网 |
| `full` | connectivity check 成功 |
| `unknown` | 未获得状态 |

`full` 只表示配置的探测端点成功，不代表任意业务可访问；`limited` 也可能是探测 URL 被策略阻止。

`nmcli networking off` 会停用所有 NetworkManager 管理的接口，远程执行属于高危 `[D]`。

## 6. profile 与 active connection

```bash
# 所有 profile
nmcli connection show

# 当前激活项
nmcli connection show --active

# 显式字段
nmcli -f NAME,UUID,TYPE,DEVICE,AUTOCONNECT connection show

# profile 配置与活动数据
nmcli connection show uuid 11111111-2222-3333-4444-555555555555
```

profile 名可重复或与 device 同名。自动化优先使用 UUID：

```bash
nmcli connection up uuid 11111111-2222-3333-4444-555555555555
```

`connection show` 支持 `id/uuid/path/apath` 消除歧义，`--active` 限制活动连接；`--order` 可按 active、name、type、path 排序。

## 7. connection 子命令全集

| 子命令 | 作用 | 级别 |
|---|---|---|
| `show` | 列出或显示 profile/active data | `[R]` |
| `up` | 激活 profile | `[W]`/`[D]` |
| `down` | 停用 active connection；profile 会被暂时阻止自动重连 | `[D]` |
| `modify` | 修改 profile，可 `--temporary` | `[W]` |
| `add` | 创建 profile，`save no` 时不持久 | `[W]` |
| `edit` | 交互式创建/编辑 | `[W]` |
| `clone` | 克隆 profile，生成新 UUID | `[W]` |
| `delete` | 删除 profile | `[D]` |
| `monitor` | 监控 profile 状态变化 | `[R]` |
| `reload` | 从磁盘重新读取全部 profile |
| `load FILE...` | 读取指定 profile 文件 |
| `import` / `export` | 通过插件导入/导出 VPN 等外部配置 |
| `migrate` | 迁移 settings plugin，例如 keyfile；无 ID 时可能作用全部 profile |

### `up`

```text
connection up [id|uuid|path] ID [ifname IFACE] [ap BSSID] [passwd-file FILE]
```

`passwd-file` 每行是 `setting.property:secret`。文件应只有 root 可读，不要把密码直接写入 shell history。

### `down` 与 `device down` 的差异

`connection down PROFILE` 停用指定 active connection，但设备仍可考虑其他 profile；该 profile 会被阻止自动重连直到重启或显式操作。`device down IFACE` 会让设备不再自动激活 profile，语义更强。

## 8. `connection modify` 的赋值、追加与删除

```text
nmcli connection modify [--temporary] ID setting.property VALUE ...
nmcli connection modify ID +setting.list-property VALUE
nmcli connection modify ID -setting.list-property VALUE|INDEX
nmcli connection modify ID setting.property ""
```

| 语法 | 作用 |
|---|---|
| `property VALUE` | 替换属性 |
| `+property VALUE` | 向列表/flags 追加 |
| `-property VALUE` | 从列表删除匹配项 |
| `-property INDEX` | 按从 0 开始的索引删除，适用属性依版本而定 |
| `property ""` | 重置为默认/未设置，空列表与 unset 某些属性语义不同 |

```bash
nmcli connection modify static-eth0 +ipv4.dns 192.0.2.54
nmcli connection modify static-eth0 -ipv4.dns 192.0.2.53
nmcli connection modify static-eth0 connection.autoconnect no
```

属性可缩写，但自动化中使用完整 `setting.property`，避免新版本增加同名前缀后变为歧义。

## 9. 创建 DHCP 和静态 IPv4 profile

### DHCP

```bash
# [W] 创建但不自动激活
sudo nmcli connection add type ethernet ifname eth0 \
  con-name dhcp-eth0 connection.autoconnect no ipv4.method auto ipv6.method auto
```

### 静态 IPv4

```bash
# [W] 使用 TEST-NET 地址示意
sudo nmcli connection add type ethernet ifname eth0 \
  con-name static-eth0 connection.autoconnect no \
  ipv4.method manual ipv4.addresses 192.0.2.10/24 \
  ipv4.gateway 192.0.2.1 \
  ipv4.dns "192.0.2.53 192.0.2.54" \
  ipv4.dns-search "example.com" \
  ipv6.method disabled
```

激活前检查：

```bash
nmcli -f profile connection show static-eth0
ip route get 192.0.2.1
```

远程主机使用 checkpoint 激活，见后文。示例地址不可直接用于真实网络。

## 10. IPv4/IPv6 method

常见 IPv4 method：

| 值 | 行为 |
|---|---|
| `auto` | DHCP/PPP 等自动配置 |
| `manual` | 静态地址，至少需要 `ipv4.addresses` |
| `disabled` | 禁用 IPv4 |
| `link-local` | RFC 3927 IPv4 link-local |
| `shared` | 连接共享，可能启动 DHCP/DNS 和 NAT；影响大 |

常见 IPv6 method：

```text
auto, dhcp, manual, link-local, shared, disabled, ignore（版本相关）
```

IPv6 默认行为、RA、DHCPv6 和 address generation mode 取决于 method 及属性组合。不要只改 `ipv6.addresses` 而忽略 `ipv6.method`。

## 11. 路由、metric 和策略路由

```bash
# 添加静态路由：destination next-hop metric
sudo nmcli connection modify static-eth0 \
  +ipv4.routes "198.51.100.0/24 192.0.2.1 50"

# 不从该 profile 学习默认路由
sudo nmcli connection modify static-eth0 ipv4.never-default yes

# 设置自动路由 metric
sudo nmcli connection modify static-eth0 ipv4.route-metric 100
```

复杂 route 支持属性：

```text
PREFIX NEXT-HOP METRIC attribute=value...
```

例如 table、type、onlink、mtu、src、cwnd 等是否支持取决于 NetworkManager/内核版本。

### policy routing

```bash
sudo nmcli connection modify static-eth0 ipv4.route-table 100
sudo nmcli connection modify static-eth0 \
  +ipv4.routing-rules "priority 100 from 192.0.2.10/32 table 100"
```

验证：

```bash
ip rule show
ip route show table 100
ip route get 198.51.100.10 from 192.0.2.10
```

rule 与 route 必须成对设计。避免使用与 NetworkManager、CNI 或云平台冲突的 priority/table。

## 12. DNS 与 Split DNS

```bash
sudo nmcli connection modify static-eth0 ipv4.ignore-auto-dns yes
sudo nmcli connection modify static-eth0 ipv4.dns "192.0.2.53 192.0.2.54"
sudo nmcli connection modify static-eth0 ipv4.dns-search "~corp.example.com"
sudo nmcli connection modify static-eth0 ipv4.dns-priority 50
```

| 属性 | 作用 |
|---|---|
| `ipv4/ipv6.dns` | DNS server 列表 |
| `dns-search` | 搜索域；`~domain` 常表示 route-only domain，需 resolved 插件支持 |
| `dns-options` | `ndots/timeout/rotate/trust-ad` 等 resolver 选项 |
| `ignore-auto-dns` | 忽略 DHCP/RA 下发 DNS |
| `dns-priority` | 多 profile DNS 合并优先级，负值有排他语义，需核对文档 |
| `routed-dns` | 为 DNS server 添加指向该连接的 route，版本支持时使用 |

检查 NetworkManager DNS plugin 与真实运行态：

```bash
nmcli -f IP4.DNS,IP4.DOMAIN,IP6.DNS,IP6.DOMAIN device show eth0
resolvectl status
ls -l /etc/resolv.conf
```

## 13. profile 修改怎样进入运行态

```text
connection modify -> 修改 profile
connection up     -> 重新激活，可能中断连接
device reapply    -> 尝试把可在线变更属性应用到 active device
device modify     -> 只改 active device，通常不写回 profile
```

```bash
# [W] 修改持久 profile
sudo nmcli connection modify static-eth0 +ipv4.dns 192.0.2.54

# [W] 尝试在线 reapply；部分属性不支持
sudo nmcli device reapply eth0

# [W] 临时改变 active device，下次重新激活消失
sudo nmcli device modify eth0 +ipv4.addresses 192.0.2.11/24
```

执行后同时检查 profile、active data 和内核：

```bash
nmcli -f profile connection show static-eth0
nmcli -f active connection show static-eth0
nmcli device show eth0
ip address show dev eth0
ip route show table all
```

## 14. device 子命令全集

| 子命令 | 作用 | 级别 |
|---|---|---|
| `status` | 设备摘要 | `[R]` |
| `show [IFACE]` | 设备详细运行态 | `[R]` |
| `set IFACE autoconnect... managed...` | 设置设备是否受管/自动连接，可 permanent | `[W]`/`[D]` |
| `up/connect IFACE` | 选择合适 profile 激活；没有时可能新建默认 profile | `[W]`/`[D]` |
| `reapply IFACE` | 重应用 active profile 可在线变化部分 | `[W]` |
| `modify IFACE ...` | 临时修改 active settings | `[W]` |
| `down/disconnect IFACE` | 断开并阻止自动激活 | `[D]` |
| `delete IFACE` | 删除 bond/bridge/vlan 等软件设备 | `[D]` |
| `monitor [IFACE...]` | 监控设备变化 | `[R]` |
| `wifi ...` | 扫描、连接、热点、查看密码 |
| `lldp [list]` | 查询 NetworkManager 学到的 LLDP 邻居 |
| `checkpoint ...` | 带自动回滚执行网络命令 |

`device up eth0` 可能自动创建 profile；需要确定配置时优先 `connection up uuid ... ifname eth0`。

## 15. Bond、Bridge 与 VLAN

### 802.3ad Bond

```bash
sudo nmcli connection add type bond ifname bond0 con-name bond0 \
  bond.options "mode=802.3ad,miimon=100,lacp_rate=fast" \
  ipv4.method disabled ipv6.method disabled

sudo nmcli connection add type ethernet ifname eth1 \
  con-name bond0-eth1 controller bond0
sudo nmcli connection add type ethernet ifname eth2 \
  con-name bond0-eth2 controller bond0
```

交换机端 LAG/LACP 必须匹配。激活后检查：

```bash
cat /proc/net/bonding/bond0
ip -d link show bond0
```

### Bridge

```bash
sudo nmcli connection add type bridge ifname br0 con-name br0 \
  ipv4.method manual ipv4.addresses 192.0.2.10/24
sudo nmcli connection add type ethernet ifname eth1 \
  con-name br0-eth1 controller br0
```

把物理口加入 bridge 后，三层地址通常配置在 `br0` 而不是 port。

### VLAN

```bash
sudo nmcli connection add type vlan ifname eth0.100 con-name vlan100 \
  dev eth0 id 100 ipv4.method manual ipv4.addresses 192.0.2.10/24
```

验证交换机端口 trunk/native VLAN、MTU、父接口和路由。生产环境创建这些对象会改变数据路径，应先在实验 namespace/VM 验证。

## 16. Wi-Fi 与 secret 安全

```bash
nmcli radio wifi
nmcli device wifi list --rescan auto
nmcli device wifi rescan ifname wlan0
```

连接语法：

```text
device wifi connect SSID [password PASSWORD] [ifname IFACE]
  [bssid BSSID] [name PROFILE] [private yes|no] [hidden yes|no]
```

不要在命令行直接写生产密码，因为 shell history 和进程审计可能记录。优先预建 profile、使用受限 passwd-file 或 secret agent。

其他命令：

| 命令 | 作用 |
|---|---|
| `device wifi hotspot ...` | 创建并激活热点，影响无线与共享/NAT |
| `device wifi show-password` | 显示当前 Wi-Fi secret，属于敏感操作 |
| `radio wifi on/off` | 无线开关 |

## 17. LLDP

profile 启用 LLDP 接收：

```bash
sudo nmcli connection modify static-eth0 connection.lldp rx
sudo nmcli device reapply eth0
nmcli device lldp list ifname eth0
```

支持值和发送/接收语义随版本变化。NetworkManager 的 LLDP 查询适合快速发现交换机/端口；需要完整 LLDP-MED、统计和持续事件时使用 `lldpd/lldpcli`。

## 18. checkpoint：远程变更自动回滚

```bash
sudo nmcli device checkpoint --timeout 60 eth0 -- \
  nmcli connection up uuid 11111111-2222-3333-4444-555555555555 ifname eth0
```

命令完成后 nmcli 会要求确认；未确认则在 timeout 后恢复 checkpoint。注意：

- checkpoint 只覆盖指定设备或默认全部设备的 NetworkManager 状态；
- 不能回滚交换机、云路由、防火墙、外部脚本等系统；
- timeout 应足够完成独立验证，又不能长时间保持错误配置；
- 带外控制台仍然必需；
- 先在非生产验证本机版本的 checkpoint 行为。

## 19. keyfile、reload 与权限

常见 keyfile 目录：

```text
/etc/NetworkManager/system-connections/ -> 持久管理员配置
/run/NetworkManager/system-connections/ -> 运行时配置
/usr/lib/NetworkManager/system-connections/ -> 供应商配置
```

文件可能保存明文 secret，NetworkManager 会忽略权限过宽的 keyfile。手工编辑后：

```bash
sudo nmcli connection load /etc/NetworkManager/system-connections/static-eth0.nmconnection
# 或重新读取全部
sudo nmcli connection reload
```

优先用 nmcli 修改，减少格式、权限和运行态不同步问题。

## 20. offline 模式

`--offline` 不连接 NetworkManager daemon，而是从 stdin 读取/向 stdout 输出 keyfile 数据。适合镜像构建、初始化和 CI 生成配置：

```bash
nmcli --offline connection add type ethernet ifname eth0 \
  con-name dhcp-eth0 ipv4.method auto
```

离线输出仍需经过 secret 管理、文件权限、版本兼容和实际激活验证，不能只做文本审查。

## 21. monitor 与日志排障

```bash
nmcli monitor
nmcli device monitor eth0
nmcli connection monitor static-eth0
journalctl -u NetworkManager --since '-10 min' --no-pager
```

典型激活阶段：device prepare、config、IP config、IP check、secondaries、activated。失败时结合 reason、DHCP lease、carrier、802.1X、route conflict 和 DNS plugin 日志判断。

## 22. 退出码

| 退出码 | 含义 |
|---|---|
| `0` | 成功 |
| `1` | 未知/未指定错误 |
| `2` | 用户输入或命令调用错误 |
| `3` | `--wait` 超时 |
| `4` | connection 激活失败 |
| `5` | connection 停用失败 |
| `6` | device disconnect 失败 |
| `7` | connection 删除失败 |
| `8` | NetworkManager 未运行 |
| `10` | connection、device 或 AP 不存在 |
| `65` | `--complete-args` 表示下一个参数应是文件名 |

脚本不能只匹配错误文本；固定 `LC_ALL=C` 并处理退出码。

## 23. 生产排障清单

```bash
date -Is
nmcli --version
systemctl is-active NetworkManager
systemctl is-active systemd-networkd

LC_ALL=C nmcli general status
LC_ALL=C nmcli device status
LC_ALL=C nmcli -f NAME,UUID,TYPE,DEVICE,AUTOCONNECT connection show
LC_ALL=C nmcli connection show --active
LC_ALL=C nmcli device show eth0

ip -br link
ip -br address
ip rule show
ip route show table all
resolvectl status
ethtool eth0
journalctl -u NetworkManager --since '-10 min' --no-pager
```

先确认 profile、active data 和内核实际状态是否一致，再决定 `reapply`、重新激活或修改配置。

## 24. 常见误区

| 误区 | 正确认识 |
|---|---|
| connection 名就是接口名 | profile name、UUID 与 device 是三个不同标识 |
| modify 后立刻改变内核 | 它通常先改 profile，还需 reapply 或重新激活 |
| device modify 会永久保存 | 它修改 active state，重新激活后通常消失 |
| connection down 后一定保持断开 | 设备可能选择其他 autoconnect profile |
| device up 只会激活现有 profile | 没有兼容项时可能创建默认 profile |
| `connectivity full` 等于业务正常 | 只验证配置的探测目标 |
| 手工改 keyfile 会自动被发现 | 需要 connection load/reload |
| `--show-secrets` 只是多显示普通字段 | 它可能输出 Wi-Fi/VPN/802.1X secret |
| 远程切 IP 后 SSH 断开只能人工恢复 | checkpoint 可降低风险，但仍要带外通道 |
| NetworkManager 与 networkd 可同时管同一接口 | 配置所有权冲突会导致状态反复覆盖 |

## 25. 官方资料

- [NetworkManager 1.58 官方参考手册](https://networkmanager.dev/docs/api/latest/)
- [`nmcli(1)` 官方手册](https://networkmanager.dev/docs/api/latest/nmcli.html)
- [nmcli settings 属性参考](https://networkmanager.dev/docs/api/latest/nm-settings-nmcli.html)
- [NetworkManager keyfile 格式](https://networkmanager.dev/docs/api/latest/nm-settings-keyfile.html)

