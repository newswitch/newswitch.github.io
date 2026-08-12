---
title: resolvectl 命令详解：systemd-resolved、缓存与 Split DNS
sidebar_position: 14
description: 系统讲解 resolvectl 的 status、query、service、缓存统计、per-link DNS、路由域、DNSSEC、DoT、监控与 Split DNS 故障排查。
tags: [Linux, resolvectl, systemd-resolved, DNS, Split DNS, DNSSEC, DoT]
---

# `resolvectl` 命令详解：systemd-resolved、缓存与 Split DNS

`resolvectl` 是 `systemd-resolved` 的查询和控制客户端。它看到的不是单一 `/etc/resolv.conf` 文件，而是全局配置、每链路 DNS、搜索域/路由域、默认路由、缓存、LLMNR、mDNS、DNSSEC 和 DNS over TLS 共同形成的解析决策。

它最适合回答：

- 一个名称为什么被发给某块网卡上的某台 DNS；
- VPN、物理网卡、容器网桥同时存在时，哪个域名走哪条解析链；
- 应用通过系统解析链看到什么，而直接 `dig @server` 又看到什么；
- 缓存、服务器能力探测、DNSSEC 或 DoT 是否影响了结果；
- Split DNS 的路由域与默认路由是否配置正确。

## 1. 先确认系统是否使用 `systemd-resolved`

```bash
resolvectl --version
systemctl status systemd-resolved --no-pager
resolvectl status
ls -l /etc/resolv.conf
```

常见 `/etc/resolv.conf` 形态：

| 指向或内容 | 含义 |
|---|---|
| `/run/systemd/resolve/stub-resolv.conf` | 应用通常查询本机 stub `127.0.0.53`，再由 resolved 路由 |
| `/run/systemd/resolve/resolv.conf` | 文件中列出已知上游，部分高级 per-link 语义无法完整表达 |
| 普通静态文件 | 应用可能绕过 `systemd-resolved`；需结合 NSS 和应用行为判断 |

`resolvectl` 存在不等于所有应用都使用 resolved。应用可能直接读取 `/etc/resolv.conf`、自带 DNS 客户端、使用 JVM 缓存，或向固定服务器发送查询。

## 2. 语法、权限与安全

```text
resolvectl [全局选项] COMMAND [COMMAND参数...]
```

| 操作 | 安全级别 | 说明 |
|---|---|---|
| `status/query/statistics` | `[R]` | 查询运行状态或发起正常解析 |
| `monitor/show-cache/show-server-state` | `[R]` | 可能输出内部名称和地址，留意日志敏感性 |
| `flush-caches/reset-*` | `[W]` | 改变运行时状态，会影响后续查询时延和行为 |
| per-link 设置与 `revert` | `[W]` | 修改运行时链路配置，可能被 NetworkManager/systemd-networkd/VPN 客户端覆盖 |

先保存现状：

```bash
resolvectl status
resolvectl statistics
ip -br link
ip -br address
ip route show table all
```

## 3. 全局查询选项

不同 systemd 版本支持的选项有差异，先执行 `resolvectl --help`。常用选项如下：

| 参数 | 作用 |
|---|---|
| `-4` | 只查询/返回 IPv4 相关结果 |
| `-6` | 只查询/返回 IPv6 相关结果 |
| `-i IFACE` / `--interface=IFACE` | 限定在指定链路上查询，可用接口名或 ifindex |
| `-p PROTOCOL` / `--protocol=PROTOCOL` | 选择 DNS、LLMNR、mDNS 等协议，取值以本机帮助为准 |
| `-t TYPE` / `--type=TYPE` | 指定 DNS RR 类型，例如 `A`、`AAAA`、`MX` |
| `-c CLASS` / `--class=CLASS` | 指定 DNS 类别，通常为 `IN` |
| `--service-address=BOOL` | 服务查询时是否继续解析目标主机地址 |
| `--service-txt=BOOL` | 服务查询时是否返回 TXT 数据 |
| `--cname=BOOL` | 是否跟随 CNAME/DNAME，具体支持取决于 systemd 版本 |
| `--validate=BOOL` | 是否要求协议/数据验证，语义随查询类型和版本而异 |
| `--synthesize=BOOL` | 是否允许 resolved 合成本机或特殊名称结果 |
| `--cache=BOOL` | 是否允许使用本地缓存 |
| `--zone=BOOL` | mDNS/LLMNR 查询是否允许单播区域行为，版本相关 |
| `--legend=BOOL` | 是否显示解释性标题/元数据 |
| `--raw[=payload|packet]` | 原始载荷或报文输出，适合程序处理；支持情况取决于版本 |
| `--json=MODE` | JSON 输出；较新版本支持，模式以本机帮助为准 |
| `--no-pager` | 不分页 |
| `--no-legend` | 不显示表头/图例 |

自动化不要假设所有发行版都有 `--json`。应固定 systemd 版本，或先做能力探测。

## 4. `status`：先看解析拓扑

```bash
resolvectl status
resolvectl status eth0
resolvectl status wg0
```

重点字段：

| 字段 | 要回答的问题 |
|---|---|
| Current Scopes | 该链路参与 DNS、LLMNR、mDNS 中的哪些范围 |
| Protocols | LLMNR、mDNS、DNSOverTLS、DNSSEC 当前策略 |
| Current DNS Server | 当前实际选择的服务器 |
| DNS Servers | 链路可用服务器列表 |
| DNS Domain | 搜索域和路由域；前缀 `~` 表示 route-only domain |
| DefaultRoute | 该链路是否可承接没有更匹配路由域的 DNS 查询 |

不要只看 Global 区域。VPN 或网络管理器经常把 DNS 配置放在具体 link 下。

## 5. `query`：沿系统解析链查询

```bash
# 地址查询，通常同时请求 A/AAAA
resolvectl query www.example.com

# 明确记录类型
resolvectl query -t A www.example.com
resolvectl query -t AAAA www.example.com
resolvectl query -t MX example.com

# 反向解析
resolvectl query 192.0.2.10

# 限定到 VPN 链路
resolvectl query -i wg0 internal.example.com

# 分别验证地址族
resolvectl query -4 www.example.com
resolvectl query -6 www.example.com
```

输出通常包含结果、使用的协议/接口/服务器、数据是否经过认证以及查询耗时。具体版式随 systemd 版本变化。

### 和 `dig`、`getent` 的区别

| 工具 | 经过的解析路径 | 适合回答的问题 |
|---|---|---|
| `getent ahosts NAME` | glibc NSS；最接近普通 Linux 应用的名称服务入口 | 应用通过 NSS 能看到什么 |
| `resolvectl query NAME` | systemd-resolved 的路由、缓存和验证逻辑 | resolved 为什么选择该 link/server |
| `dig @SERVER NAME TYPE` | 直接向指定 DNS 服务器发报文 | 某台 DNS 服务实际返回什么 |

排障时三者应组合使用，而不是互相替代。

## 6. 服务发现与特殊记录命令

| 命令 | 作用 |
|---|---|
| `service [[NAME] TYPE] DOMAIN` | 解析 DNS-SD 服务，可返回 SRV/TXT 及目标地址 |
| `openpgp EMAIL@DOMAIN` | 查询与 OpenPGP 相关的 DNS 记录，支持取决于版本 |
| `tlsa [FAMILY] DOMAIN[:PORT]` | 查询 TLSA/DANE 记录，支持取决于版本 |

示例：

```bash
resolvectl service _https._tcp example.com
resolvectl tlsa tcp example.com:443
```

服务发现会涉及 SRV 优先级、权重、端口、TXT 元数据和目标地址，不应只取第一条结果。

## 7. 缓存、统计与服务器能力

| 命令 | 安全级别 | 作用 |
|---|---|---|
| `statistics` | `[R]` | 查看事务、缓存命中、DNSSEC 等统计 |
| `reset-statistics` | `[W]` | 清零统计计数，不等于修复 DNS |
| `flush-caches` | `[W]` | 清空本地 DNS 缓存；后续请求会重新查询上游 |
| `reset-server-features` | `[W]` | 清除 learned server capability，例如 EDNS/DNSSEC/UDP 行为的探测状态 |
| `show-cache` | `[R]` | 查看本地缓存内容；需要较新 systemd，并可能暴露内部名称 |
| `show-server-state` | `[R]` | 查看已学习的服务器状态和能力 |

```bash
resolvectl statistics
sudo resolvectl flush-caches
sudo resolvectl reset-server-features
```

不要把清缓存当作第一步。清缓存会改变现场，还可能让问题暂时消失。正确顺序是先保存 `status`、`statistics`、查询输出、日志和抓包，再在明确假设下操作。

## 8. per-link DNS 配置命令

以下命令修改 `systemd-resolved` 的运行时 per-link 状态，通常需要权限：

| 命令 | 作用 |
|---|---|
| `dns LINK [SERVER...]` | 设置链路 DNS 服务器；服务器可带地址族、接口或端口等扩展，语法随版本变化 |
| `domain LINK [DOMAIN...]` | 设置搜索域或路由域 |
| `default-route LINK BOOL` | 设置该链路是否成为 DNS 默认路由 |
| `llmnr LINK MODE` | 设置 LLMNR，常见 `yes/no/resolve` |
| `mdns LINK MODE` | 设置 MulticastDNS，常见 `yes/no/resolve` |
| `dnssec LINK MODE` | 设置 DNSSEC 策略，取值以版本为准 |
| `dnsovertls LINK MODE` | 设置 DNS over TLS 策略，常见 `yes/no/opportunistic` |
| `nta LINK [DOMAIN...]` | 设置 DNSSEC Negative Trust Anchor |
| `revert LINK` | 撤销该链路通过 resolvectl 设置的运行时配置 |

示例仅适合实验环境：

```bash
# [W] 给 wg0 配置企业 DNS 与路由域
sudo resolvectl dns wg0 10.20.0.53
sudo resolvectl domain wg0 '~corp.example.com'
sudo resolvectl default-route wg0 no

# 验证
resolvectl status wg0
resolvectl query internal.corp.example.com

# 回滚本次运行时设置
sudo resolvectl revert wg0
```

NetworkManager、systemd-networkd、VPN 客户端或云初始化工具可能很快重新下发配置。持久修改应在真正的配置所有者中完成，而不是只写 `resolvectl` 命令。

## 9. Split DNS 的核心：路由域

`systemd-resolved` 会按名称与各链路路由域的“最长后缀匹配”选择查询范围。

```text
wg0:  ~corp.example.com -> 10.20.0.53
eth0: ~.                -> 192.0.2.53

db.corp.example.com -> wg0 的 10.20.0.53
www.example.net     -> eth0 的 192.0.2.53
```

三类域要区分：

| 写法 | 含义 |
|---|---|
| `example.com` | 搜索域，同时通常参与该后缀的 DNS 路由 |
| `~example.com` | 只用于 DNS 路由，不参与短名称搜索 |
| `~.` | 匹配所有域的 route-only 根域，相当于 DNS 捕获所有未被更长后缀匹配的查询 |

`DefaultRoute=yes` 决定没有合适路由域时链路是否参与默认查询；它和内核 IP 默认路由不是同一概念。

## 10. DNSSEC、DoT、LLMNR 与 mDNS

### DNSSEC

```bash
resolvectl status
resolvectl query www.example.com
```

关注全局与 per-link 的 DNSSEC 策略，以及查询结果是否显示 authenticated。DNSSEC 失败要检查时间同步、信任锚、父区 DS、子区 DNSKEY/RRSIG 和中间设备是否破坏大报文。

### DNS over TLS

```bash
sudo resolvectl dnsovertls eth0 opportunistic
```

`opportunistic` 可在加密不可用时回退，不等于“强制加密”；`yes` 的严格行为、服务器名称验证和地址语法取决于 systemd 版本与配置。不要只凭端口 853 连通判断 DoT 安全。

### LLMNR 与 mDNS

LLMNR/mDNS 是本地链路协议，不等同于企业 DNS。它们可能使短名称“偶尔能解析”，掩盖搜索域或 DNS 配置错误。服务器场景应按安全基线决定是否启用。

## 11. 监控、日志与运行态检查

| 命令 | 作用 |
|---|---|
| `monitor` | 持续显示本机解析事务和状态变化，版本支持时使用 |
| `log-level [LEVEL]` | 查询或设置 resolved 日志级别；修改是 `[W]`，避免长期开 debug |

```bash
resolvectl monitor
journalctl -u systemd-resolved --since '-10 min' --no-pager
```

如需临时提高日志级别，先记录原值并准备恢复；详细 DNS 日志可能包含内部域名、服务名和访问模式。

## 12. 场景化排障

### 场景一：连 VPN 后内部域名仍走公网 DNS

```bash
resolvectl status
resolvectl status wg0
resolvectl query internal.corp.example.com
dig -r @10.20.0.53 internal.corp.example.com A
```

判断顺序：

1. `wg0` 是否存在内部 DNS；
2. 是否配置 `~corp.example.com`；
3. 查询输出是否实际选择 `wg0`；
4. 直接问内部 DNS 是否有正确记录；
5. VPN 客户端是否在重连时覆盖设置。

### 场景二：应用失败但 `dig @server` 正常

```bash
getent ahosts api.example.com
resolvectl query api.example.com
dig -r @192.0.2.53 api.example.com A
grep '^hosts:' /etc/nsswitch.conf
ls -l /etc/resolv.conf
```

如果只有 `dig` 正常，问题可能在 NSS 顺序、resolved 路由/缓存、搜索域、应用缓存或应用自带解析器。

### 场景三：偶发 `SERVFAIL`

```bash
resolvectl statistics
resolvectl query api.example.com
dig -r @192.0.2.53 api.example.com A +dnssec
dig -r @192.0.2.53 api.example.com A +dnssec +cdflag
journalctl -u systemd-resolved --since '-10 min' --no-pager
```

若 `+cdflag` 有数据而正常验证为 SERVFAIL，应继续检查 DNSSEC 链，而不是长期关闭验证。

## 13. 常见误区

| 误区 | 正确认识 |
|---|---|
| `/etc/resolv.conf` 只有一台 127.0.0.53，所以只有一个上游 | 它可能是本地 stub，真实上游分布在多个 link |
| `dig @server` 正常就证明系统解析正常 | `dig` 绕过 resolved 的路由、缓存和部分验证逻辑 |
| `flush-caches` 是通用修复 | 它会破坏现场，只能验证特定缓存假设 |
| `~corp.example.com` 会补全短名称 | `~` 是 route-only，不是搜索域 |
| DNS DefaultRoute 等于 IP 默认路由 | 两者是不同决策平面 |
| `opportunistic` DoT 保证全程加密 | 它可能允许回退，必须核对策略和运行状态 |
| resolvectl 设置会永久保存 | 多数是运行时状态，持久配置应交给网络管理组件 |

## 14. 一套最小证据清单

```bash
date -Is
resolvectl --version
systemctl is-active systemd-resolved
resolvectl status
resolvectl statistics
ls -l /etc/resolv.conf
grep '^hosts:' /etc/nsswitch.conf
getent ahosts www.example.com
resolvectl query www.example.com
dig -r @192.0.2.53 www.example.com A +time=2 +tries=1
journalctl -u systemd-resolved --since '-10 min' --no-pager
```

## 15. 官方资料

- [systemd `resolvectl` 官方手册](https://www.freedesktop.org/software/systemd/man/latest/resolvectl.html)
- [systemd-resolved 官方手册](https://www.freedesktop.org/software/systemd/man/latest/systemd-resolved.service.html)
- [systemd.network DNS 路由域说明](https://www.freedesktop.org/software/systemd/man/latest/systemd.network.html)

