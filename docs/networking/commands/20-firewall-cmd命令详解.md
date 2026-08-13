---
title: firewall-cmd 命令详解：zone、policy、服务与安全变更
sidebar_position: 20
description: 系统讲解 firewall-cmd 的 runtime/permanent 双配置、zone、interface/source 绑定、service、port、rich rule、policy、ipset、NAT、panic、direct 弃用和生产变更流程。
tags: [Linux, firewall-cmd, firewalld, nftables, 防火墙, NAT, Zone, Policy]
---

# `firewall-cmd` 命令详解：zone、policy、服务与安全变更

`firewall-cmd` 是 firewalld 的命令行客户端。firewalld 用 zone、service、policy、ipset 和 rich rule 把底层 Netfilter/nftables 规则抽象成长期可管理的对象，并通过 D-Bus 动态应用变更。

最重要的两条原则：

1. runtime 与 permanent 是两套配置；
2. firewalld 管理的规则应通过 `firewall-cmd` 修改，不要再用 `nft`/`iptables` 混写。

## 1. 先确认状态、版本和后端

```bash
firewall-cmd --version
firewall-cmd --state
systemctl status firewalld --no-pager
firewall-cmd --get-active-zones
firewall-cmd --list-all
```

后端和配置：

```bash
grep -E '^(FirewallBackend|FlushAllOnReload|CleanupOnExit|LogDenied)=' \
  /etc/firewalld/firewalld.conf
sudo nft -n -a list ruleset
```

firewalld 当前主流后端是 nftables，但发行版、版本和配置可能不同。底层规则用于观察，不应直接编辑 firewalld 生成的对象。

## 2. 安全边界

| 操作 | 级别 | 风险 |
|---|---|---|
| `--state`、`--get-*`、`--list-*`、`--query-*` | `[R]` | 输出包含接口、地址、服务与策略 |
| runtime `--add-*` / `--remove-*` | `[W]`/`[D]` | 立即影响流量，但重载/重启后消失 |
| `--permanent` 修改 | `[W]`/`[D]` | 不立即生效，却会在下次 reload/启动影响流量 |
| `--reload` | `[W]`/`[D]` | permanent 覆盖 runtime-only 变更 |
| `--complete-reload` | `[D]` | 可能卸载/重载模块并丢连接状态，官方仅建议严重问题时使用 |
| `--panic-on` | `[D]` | 丢弃网络流量，远程执行可能立即失联 |
| `--reset-to-defaults` | `[D]` | 重置配置，不是普通回滚手段 |

远程变更必须具备带外控制台、回滚计时器、明确管理源地址和独立客户端验证。

## 3. runtime 与 permanent

```text
runtime configuration   -> 当前内核正在执行，firewalld reload/restart 后可能丢失
permanent configuration -> 磁盘配置，下次 reload/restart 才进入 runtime
```

### 正确的“先试后存”流程

```bash
# 1. [W] 只改 runtime，立即验证
sudo firewall-cmd --zone=public --add-service=https

# 2. 从另一台主机验证服务、规则和日志
firewall-cmd --zone=public --query-service=https

# 3. 验证无误后，把当前完整 runtime 写入 permanent
sudo firewall-cmd --runtime-to-permanent

# 4. 检查永久配置
sudo firewall-cmd --permanent --check-config
sudo firewall-cmd --permanent --zone=public --list-all
```

也可以分别执行 runtime 和 permanent 两次 `--add-*`，但要确保参数完全相同。

### 常见陷阱

```bash
# 只改 permanent，不会立刻放行
firewall-cmd --permanent --add-service=https

# reload 会让 permanent 成为新的 runtime，未保存的 runtime-only 变更丢失
firewall-cmd --reload
```

`--runtime-to-permanent` 会用当前 runtime 覆盖 permanent，不只是保存“最后一条规则”。执行前要检查所有 zone、policy、ipset 和临时调试项。

## 4. 通用与状态命令

| 参数 | 作用 |
|---|---|
| `-h` / `--help` | 显示帮助 |
| `-V` / `--version` | 显示 firewalld 版本，不能和其他选项组合 |
| `-q` / `--quiet` | 不输出状态消息 |
| `--state` | 检查 daemon 状态并输出 running/not running 等 |
| `--reload` | 以 permanent 重建 runtime，尽量保留连接状态 |
| `--complete-reload` | 完全重载，可能丢失连接跟踪状态 |
| `--runtime-to-permanent` | 用 runtime 覆盖 permanent |
| `--check-config` | 检查 permanent XML 语法和语义 |
| `--reset-to-defaults` | 重置为默认配置，高危 |

日志拒绝：

| 参数 | 作用 |
|---|---|
| `--get-log-denied` | 查看 LogDenied |
| `--set-log-denied=VALUE` | 设置 `all/unicast/broadcast/multicast/off`；同时改变 runtime/permanent 并 reload |

LogDenied 会增加拒绝日志，可能造成日志洪泛并暴露扫描/内部地址。应配合日志容量和限速策略。

## 5. zone 模型

zone 根据 ingress interface 或 source 选择对流量应用哪套规则。常见预定义 zone 的名称不等于绝对安全等级，实际内容必须查询。

```bash
firewall-cmd --get-default-zone
firewall-cmd --get-active-zones
firewall-cmd --get-zones
firewall-cmd --list-all-zones
firewall-cmd --zone=public --list-all
```

### zone 发现与默认设置

| 参数 | 作用 |
|---|---|
| `--get-default-zone` | 查看默认 zone |
| `--set-default-zone=ZONE` | `[W]` 设置默认 zone，立即且永久生效 |
| `--get-active-zones` | 列出绑定了接口/源的活动 zone |
| `--get-zones` | 列出所有 zone |
| `--get-services` | 列出可用 service 定义 |
| `--get-icmptypes` | 列出 ICMP type 定义 |
| `--get-zone-of-interface=IFACE` | 查询接口所属 zone |
| `--get-zone-of-source=SOURCE` | 查询 source 所属 zone，版本支持时使用 |
| `--info-zone=ZONE` | 显示 zone 详细信息 |
| `--list-all` | 显示目标 zone 全部设置，省略 `--zone` 使用默认 zone |
| `--list-all-zones` | 显示所有 zone 全部设置 |

### 自定义 zone（permanent）

| 参数 | 作用 |
|---|---|
| `--permanent --new-zone=ZONE` | 创建自定义 zone |
| `--permanent --new-zone-from-file=FILE [--name=ZONE]` | 从 XML 创建 |
| `--permanent --delete-zone=ZONE` | 删除自定义 zone |
| `--permanent --load-zone-defaults=ZONE` | 恢复内置 zone 默认值 |
| `--permanent --path-zone=ZONE` | 输出 zone XML 路径 |

## 6. interface 与 source 绑定

### interface

| 参数族 | 作用 |
|---|---|
| `--zone=Z --list-interfaces` | 列出绑定接口 |
| `--zone=Z --add-interface=IFACE` | `[W]` 绑定接口 |
| `--zone=Z --change-interface=IFACE` | `[W]/[D]` 改变接口 zone |
| `--zone=Z --query-interface=IFACE` | 查询是否绑定，true 返回 0 |
| `--remove-interface=IFACE` | `[W]/[D]` 解除接口绑定 |

NetworkManager 管理的接口应优先在 connection profile 中设置 zone，否则重连、重启或 DHCP 事件可能覆盖手工绑定：

```bash
nmcli -f NAME,DEVICE,TYPE,connection.zone connection show
```

### source

source 可为 IPv4/IPv6 地址或网段、MAC，或 `ipset:NAME`：

| 参数族 | 作用 |
|---|---|
| `--zone=Z --list-sources` | 列出 source |
| `--zone=Z --add-source=SOURCE` | `[W]` 添加 source 绑定 |
| `--zone=Z --change-source=SOURCE` | `[W]/[D]` 改变 source zone |
| `--zone=Z --query-source=SOURCE` | 查询绑定 |
| `--remove-source=SOURCE` | `[W]/[D]` 删除绑定 |

若 interface 与 source 同时匹配，firewalld 的 zone dispatch 与优先级受版本/实现规则影响。复杂场景应查看生成的 nftables 规则和官方 zone 文档。

## 7. service、port、protocol 与 source-port

### service

```bash
firewall-cmd --zone=public --list-services
firewall-cmd --zone=public --query-service=https
```

| 参数族 | 作用 |
|---|---|
| `--list-services` | 列出允许的 service |
| `--add-service=SERVICE [--timeout=TIME]` | runtime 添加，可设自动移除时间 |
| `--remove-service=SERVICE` | 删除允许服务 |
| `--query-service=SERVICE` | 查询是否允许 |

service 是一组端口、协议、模块、helper 和 destination 的可复用定义，比裸端口更容易审计。

### destination port

| 参数族 | 作用 |
|---|---|
| `--list-ports` | 列出开放端口 |
| `--add-port=PORT[-PORT]/PROTO [--timeout=TIME]` | 添加 TCP/UDP/SCTP/DCCP 等端口 |
| `--remove-port=PORT[-PORT]/PROTO` | 删除端口 |
| `--query-port=PORT[-PORT]/PROTO` | 查询端口 |

### protocol

| 参数族 | 作用 |
|---|---|
| `--list-protocols` | 列出允许的 IP protocol |
| `--add-protocol=PROTO [--timeout=TIME]` | 允许协议名或协议号 |
| `--remove-protocol=PROTO` | 删除协议 |
| `--query-protocol=PROTO` | 查询协议 |

`--add-protocol=gre` 允许的是 IP protocol GRE，不等于开放某个 TCP/UDP port。

### source port

| 参数族 | 作用 |
|---|---|
| `--list-source-ports` | 列出允许的源端口 |
| `--add-source-port=PORT[-PORT]/PROTO [--timeout=TIME]` | 添加源端口规则 |
| `--remove-source-port=...` | 删除 |
| `--query-source-port=...` | 查询 |

多数服务访问控制应匹配目的端口，源端口通常是客户端临时端口。不要把 source-port 和 destination port 混淆。

## 8. timeout：临时 runtime 变更

许多 runtime `--add-*` 支持：

```bash
sudo firewall-cmd --zone=public --add-port=8443/tcp --timeout=10m
```

timeout 常用单位包括秒、分钟、小时，具体语法以本机帮助为准。带 timeout 的设置不能作为 permanent 配置。它适合临时维护窗口，但仍要验证定时移除是否发生，并避免把 timeout 当作唯一回滚保护。

## 9. masquerade、forward-port 与 forward

### masquerade

| 参数族 | 作用 |
|---|---|
| `--query-masquerade` | 查询是否启用 |
| `--add-masquerade [--timeout=TIME]` | `[W]` 启用源 NAT masquerade |
| `--remove-masquerade` | `[W]/[D]` 关闭 |

### forward-port

```text
port=PORT[-PORT]:proto=PROTO[:toport=PORT[-PORT]][:toaddr=ADDRESS]
```

| 参数族 | 作用 |
|---|---|
| `--list-forward-ports` | 列出端口转发 |
| `--add-forward-port=SPEC [--timeout=TIME]` | 添加 DNAT/redirect |
| `--remove-forward-port=SPEC` | 删除 |
| `--query-forward-port=SPEC` | 查询 |

示意：

```bash
firewall-cmd --zone=public \
  --add-forward-port=port=8443:proto=tcp:toaddr=10.20.0.10:toport=443
```

转发还需要内核 forwarding、FORWARD policy、路由、回程和可能的 masquerade。仅看到 forward-port 不代表后端可达。

### intra-zone forwarding

| 参数族 | 作用 |
|---|---|
| `--add-forward [--timeout=TIME]` | 允许同 zone ingress 到同 zone egress 的 forwarding |
| `--remove-forward` | 删除 |
| `--query-forward` | 查询 |

跨 zone 流量更适合使用 policy 明确描述 ingress/egress zone。

## 10. ICMP block 与 inversion

| 参数族 | 作用 |
|---|---|
| `--list-icmp-blocks` | 列出阻止的 ICMP type |
| `--add-icmp-block=TYPE [--timeout=TIME]` | 添加 ICMP 阻止 |
| `--remove-icmp-block=TYPE` | 删除 |
| `--query-icmp-block=TYPE` | 查询 |
| `--add-icmp-block-inversion` | 反转 ICMP block 逻辑，只允许列出的 type |
| `--remove-icmp-block-inversion` | 关闭反转 |
| `--query-icmp-block-inversion` | 查询反转状态 |

不要阻止 IPv6 Neighbor Discovery、Packet Too Big 和必要错误反馈。ICMP policy 应基于协议需求，而不是“全部禁用”。

## 11. rich rule

rich language 用单条结构化规则表达 family、source/destination、service/port/protocol、log、audit、limit 与 action。

```bash
firewall-cmd --zone=public --list-rich-rules

firewall-cmd --zone=public \
  --add-rich-rule='rule family="ipv4" source address="192.0.2.0/24" service name="ssh" accept'
```

| 参数族 | 作用 |
|---|---|
| `--list-rich-rules` | 列出 rich rule |
| `--add-rich-rule='RULE' [--timeout=TIME]` | 添加 |
| `--remove-rich-rule='RULE'` | 按同样文本删除 |
| `--query-rich-rule='RULE'` | 查询 |

复杂 rich rule 应放进版本控制，使用明确 family，并限制日志速率。删除需要与 canonical rule 匹配，执行前先 list 保存实际文本。

## 12. target、short 与 description

permanent zone 元数据和 target：

| 参数 | 作用 |
|---|---|
| `--permanent --zone=Z --get-target` | 获取 target |
| `--permanent --zone=Z --set-target=TARGET` | 设置 `default/ACCEPT/DROP/REJECT` 等，影响大 |
| `--permanent --zone=Z --get-short` | 获取短名称 |
| `--permanent --zone=Z --set-short=TEXT` | 设置短名称 |
| `--permanent --zone=Z --get-description` | 获取描述 |
| `--permanent --zone=Z --set-description=TEXT` | 设置描述 |

zone target 改变未被更具体规则处理的流量，属于高风险变更。

## 13. policy：管理 zone 之间的流量

policy 用 ingress zone、egress zone 和 priority 描述跨 zone 过滤/NAT，比已弃用 direct 更适合新设计。

```bash
firewall-cmd --get-policies
firewall-cmd --info-policy=corp-to-dmz
```

### policy 对象管理

| 参数 | 作用 |
|---|---|
| `--get-policies` | 列出 policy |
| `--get-active-policies` | 列出活动 policy，版本支持时使用 |
| `--info-policy=POLICY` | 查看详情 |
| `--permanent --new-policy=POLICY` | 新建 |
| `--permanent --new-policy-from-file=FILE [--name=NAME]` | 从 XML 创建 |
| `--permanent --delete-policy=POLICY` | 删除 |
| `--permanent --load-policy-defaults=POLICY` | 恢复默认 |
| `--permanent --path-policy=POLICY` | 显示 XML 路径 |

### ingress/egress zone

| 参数族 | 作用 |
|---|---|
| `--policy=P --list-ingress-zones` | 列出 ingress zone |
| `--policy=P --add-ingress-zone=Z` | 添加 |
| `--policy=P --remove-ingress-zone=Z` | 删除 |
| `--policy=P --query-ingress-zone=Z` | 查询 |
| `--policy=P --list-egress-zones` | 列出 egress zone |
| `--policy=P --add-egress-zone=Z` | 添加 |
| `--policy=P --remove-egress-zone=Z` | 删除 |
| `--policy=P --query-egress-zone=Z` | 查询 |

policy 内也支持 service、port、protocol、source-port、masquerade、forward-port、ICMP block 和 rich rule 等与 zone 类似的参数族。创建 policy 时应先在 permanent 定义对象和方向，再 reload 到 runtime 测试。

### priority 与 target

| 参数 | 作用 |
|---|---|
| `--policy=P --get-priority` | 查看 priority |
| `--policy=P --set-priority=N` | 设置优先级，数值顺序语义以官方文档为准 |
| `--policy=P --get-target` | 查看 target |
| `--policy=P --set-target=TARGET` | 设置 policy target |

多条 policy 重叠时，priority、方向和 target 决定结果。上线前必须查看底层规则顺序和流量计数。

## 14. ipset 对象

firewalld ipset 是可复用的地址/MAC 集合，不等同于 nft 原生任意类型 set。

```bash
firewall-cmd --get-ipsets
firewall-cmd --info-ipset=admin-networks
```

### 对象管理

| 参数 | 作用 |
|---|---|
| `--get-ipsets` | 列出 ipset |
| `--info-ipset=NAME` | 查看详情 |
| `--permanent --new-ipset=NAME --type=TYPE [--option=K=V]` | 新建 |
| `--permanent --new-ipset-from-file=FILE [--name=NAME]` | 从 XML 创建 |
| `--permanent --delete-ipset=NAME` | 删除 |
| `--permanent --load-ipset-defaults=NAME` | 恢复默认 |
| `--permanent --path-ipset=NAME` | 输出 XML 路径 |

### entry

| 参数族 | 作用 |
|---|---|
| `--ipset=N --get-entries` | 列出元素 |
| `--ipset=N --add-entry=ENTRY` | 添加元素 |
| `--ipset=N --remove-entry=ENTRY` | 删除元素 |
| `--ipset=N --query-entry=ENTRY` | 查询元素 |
| `--ipset=N --add-entries-from-file=FILE` | 批量添加 |
| `--ipset=N --remove-entries-from-file=FILE` | 批量删除 |

带 timeout 的 ipset 与 permanent 配置有额外限制。大集合操作要评估 reload 时间、内存和配置生成方式。

## 15. 自定义 service、helper 与 icmptype

这些定义主要在 permanent 层管理。

### service 对象

```bash
firewall-cmd --info-service=https
firewall-cmd --permanent --service=https --get-ports
```

常见管理参数：

| 参数族 | 作用 |
|---|---|
| `--new-service` / `--delete-service` / `--load-service-defaults` | 创建、删除、恢复 service |
| `--new-service-from-file` / `--path-service` | 从 XML 创建、查看路径 |
| `--service=S --get/add/remove/query-port` | 管理 destination port |
| `--service=S --get/add/remove/query-protocol` | 管理 IP protocol |
| `--service=S --get/add/remove/query-source-port` | 管理 source port |
| `--service=S --get/add/remove/query-module` | 管理 helper kernel module，旧式能力 |
| `--service=S --get/set-destination` | 按 family 设置 destination |
| `--service=S --get/add/remove/query-helper` | 管理 helper 引用 |
| `--service=S --get/set-short` | 短名称 |
| `--service=S --get/set-description` | 描述 |

### helper 对象

helper 与 conntrack ALG 相关：

| 参数族 | 作用 |
|---|---|
| `--get-helpers` / `--info-helper=H` | 列出/查看 |
| `--new-helper` / `--delete-helper` | 创建/删除 |
| `--helper=H --get/set-module` | 内核 helper module |
| `--helper=H --get/set-family` | 地址族 |
| `--helper=H --get/add/remove/query-port` | helper 端口 |

不要无目的启用 FTP/SIP 等 helper。它们会解析应用协议并创建 expectation，需要独立安全评估。

### icmptype 对象

| 参数族 | 作用 |
|---|---|
| `--get-icmptypes` / `--info-icmptype=TYPE` | 列出/查看 |
| `--new-icmptype` / `--delete-icmptype` | 创建/删除 |
| `--icmptype=T --get/add/remove/query-destination` | 管理 IPv4/IPv6 destination family |

## 16. panic 模式

| 参数 | 作用 |
|---|---|
| `--panic-on` | `[D]` 进入 panic，丢弃网络流量 |
| `--panic-off` | 退出 panic |
| `--query-panic` | 查询状态，启用返回 0 |

panic 用于极端隔离场景，不能当作普通“临时阻断”。远程执行可能切断管理连接，必须先有带外控制台和恢复流程。

## 17. direct 接口已弃用

`--direct` 提供旧式 iptables 风格链、规则和 passthrough。firewalld 官方已将 direct 标为 deprecated，未来会移除，推荐使用 policy。

仍可能看到的参数族：

```text
--direct --get/add/remove-chain
--direct --get/add/remove/query-rule
--direct --get/remove-rules
--direct --passthrough
--direct --get/add/remove/query-passthrough
```

direct 行为还受 `FirewallBackend` 和 `FlushAllOnReload` 影响，passthrough 可能无法被 firewalld 完整追踪。新配置不要继续依赖它，旧配置应制定迁移计划。

## 18. NetworkManager、容器与 Kubernetes

### NetworkManager

接口 zone 可能由 connection profile 下发：

```bash
nmcli -f NAME,DEVICE,connection.zone connection show
firewall-cmd --get-active-zones
```

### 容器平台

Docker、Podman、Kubernetes 和 CNI 可能创建接口、zone、policy 或底层规则。排障时检查：

- 容器接口归属哪个 zone；
- FORWARD 与 policy 是否覆盖容器网段；
- firewalld reload 是否触发容器规则重建；
- CNI 是否支持 firewalld；
- Service/NAT conntrack 是否仍指向旧 endpoint；
- direct 与 nftables backend 是否产生优先级差异。

不要通过手工清空规则判断“是不是防火墙问题”。

## 19. 返回码与脚本

常见规则：

- 成功为 0；
- 命令行用法错误常为 2；
- `--query-*`：存在/true 返回 0，不存在/false 返回 1，其他才是错误；
- sequence option 中，只要至少一项成功，某些 already-enabled/not-enabled 会按成功处理；
- 多种错误可能汇总为 `UNKNOWN_ERROR=254`。

部分常见 firewalld 错误码：

| 名称 | 代码 |
|---|---|
| `ALREADY_ENABLED` | 11 |
| `NOT_ENABLED` | 12 |
| `COMMAND_FAILED` | 13 |
| `PANIC_MODE` | 15 |
| `ZONE_ALREADY_SET` | 16 |
| `UNKNOWN_INTERFACE` | 17 |
| `ACCESS_DENIED` | 29 |
| `RUNNING_BUT_FAILED` | 251 |
| `NOT_RUNNING` | 252 |
| `NOT_AUTHORIZED` | 253 |
| `UNKNOWN_ERROR` | 254 |

脚本中必须区分 query false（1）与真正错误，不要把所有非 0 都打印成故障。

## 20. 一套生产安全变更流程

```bash
# 1. 保存当前运行态和永久配置证据
date -Is
firewall-cmd --version
firewall-cmd --state
firewall-cmd --get-active-zones
firewall-cmd --list-all-zones
firewall-cmd --get-policies
sudo nft -n -a list ruleset

# 2. [W] runtime 临时放行并设置超时
sudo firewall-cmd --zone=public --add-port=8443/tcp --timeout=10m

# 3. 独立客户端验证路由、端口、TLS 和业务
firewall-cmd --zone=public --query-port=8443/tcp

# 4. 确认无误后持久化，或明确执行同样 permanent 修改
sudo firewall-cmd --runtime-to-permanent
sudo firewall-cmd --permanent --check-config

# 5. 检查 runtime/permanent 一致性和底层计数
firewall-cmd --zone=public --list-all
firewall-cmd --permanent --zone=public --list-all
sudo nft -n -a list ruleset
```

如果使用 `--runtime-to-permanent`，在保存前先删除所有临时调试放行。

## 21. 防火墙故障排查顺序

```bash
# 管理平面
firewall-cmd --state
firewall-cmd --get-active-zones
firewall-cmd --list-all-zones
firewall-cmd --get-policies

# 接口和源实际绑定
ip -br address
firewall-cmd --get-zone-of-interface=eth0

# 目标对象
firewall-cmd --zone=public --query-service=https
firewall-cmd --zone=public --query-port=443/tcp
firewall-cmd --zone=public --list-rich-rules

# 底层规则、连接状态和应用
sudo nft -n -a -y list ruleset
sudo conntrack -L -p tcp --dport 443 -o extended
ss -lntp 'sport = :443'
sudo tcpdump -i any -nn -c 100 'tcp port 443'
```

端口允许但仍失败时，继续检查服务是否监听正确地址、路由/邻居、云安全组、上游 ACL、NAT 和应用协议。

## 22. 常见误区

| 误区 | 正确认识 |
|---|---|
| `--permanent --add-port` 会立刻放行 | permanent 需要 reload/restart 才进入 runtime |
| runtime 改好后 reload 可以保存 | reload 会用 permanent 覆盖 runtime-only 变更 |
| `--runtime-to-permanent` 只保存最后一条 | 它用整个 runtime 覆盖 permanent |
| 默认 zone 就是所有接口的 zone | source/interface 绑定可能把流量分配到其他 zone |
| 开放端口说明服务可用 | 还要检查监听、TLS、协议和后端 |
| masquerade 自动完成路由转发 | 仍需 forwarding、FORWARD policy、路由和回程 |
| 直接改 nftables 更灵活且 firewalld 会识别 | firewalld 可能覆盖或不追踪手工规则 |
| `--complete-reload` 是更彻底的普通 reload | 它可能丢连接状态，只用于严重故障 |
| direct 是推荐的高级接口 | direct 已弃用，新设计使用 policy/rich rule |
| query 返回 1 就是命令执行异常 | 对 query 来说通常表示 false/not configured |

## 23. 官方资料

- [`firewall-cmd(1)` 官方手册](https://firewalld.org/documentation/man-pages/firewall-cmd)
- [firewalld zone 官方手册](https://firewalld.org/documentation/man-pages/firewalld.zones)
- [firewalld policy 官方手册](https://firewalld.org/documentation/man-pages/firewalld.policies)
- [firewalld rich language 官方手册](https://firewalld.org/documentation/man-pages/firewalld.richlanguage)

