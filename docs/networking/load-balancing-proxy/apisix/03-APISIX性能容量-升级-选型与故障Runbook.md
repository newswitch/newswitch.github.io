---
title: "APISIX 性能容量、升级、选型与故障 Runbook"
sidebar_label: "03. 性能、升级与故障 Runbook"
sidebar_position: 3
description: "以 APISIX 3.20.0 串起容量、插件阶段与配置生效证据，按路由不匹配、配置未下发和上游超时三条路径排查并验证恢复。"
tags: [APISIX, Performance, Capacity, Troubleshooting]
---

# APISIX 性能容量、升级、选型与故障 Runbook

APISIX 返回了错误，不等于错误一定由路由器产生；Admin API 返回成功，也不等于每个处理请求的 worker 都已经使用新配置。排障需要把控制面存储、数据面内存状态、插件和真实上游尝试对应起来。

本文固定 APISIX `3.20.0` 的源码与文档，不将它等同于任意 APISIX/OpenResty 组合。下面的主路径采用 etcd 驱动的部署形态；Standalone 文件/API 形态应先按实际配置来源调整检查点。所有输出均为教学样例，不是生产事故日志。

## 1. 容量指标

网关容量至少包含新建连接率、并发连接、HTTP RPS、请求/响应字节、TLS 握手、插件 CPU、上游连接池和日志吞吐。平均 RPS 相同，短连接 TLS、小包高 QPS 与大文件传输的瓶颈完全不同。

压测矩阵逐步加入：纯转发、TLS、认证、限流、外部 OIDC、Access Log、Trace、大 Header/Body、上游慢响应和节点故障。记录 P50/P95/P99、CPU 单核饱和、Event Loop Lag、连接错误与 Upstream 延迟。

### 1.1 RPS、在途请求和带宽分别计算

稳态下可用 Little 定律估计平均在途数：`L = λ × W`。每秒 1000 个请求、平均耗时 0.08 秒，对应约 80 个平均在途请求；不能把 P99 直接当成这个公式里的平均 W。

每秒 2000 个响应、每个响应体 64 KiB，仅响应有效载荷就约 125 MiB/秒。还未计入请求、头部、TLS 和重试；上游到网关、网关到客户端也是两段不同链路，不能只看某一个端口的平均 RPS。

worker 连接槽还包含客户端与上游连接等，HTTP/2 单连接也可能承载多个流。HTTP 在途数、TCP 连接数和文件描述符不是同一个计数，不能用 `worker_connections` 原样当成业务并发上限。

### 1.2 以同一 SLO 测单节点，再计算故障余量

假设四节点在相同请求分布和 P99/错误率约束下，各自可持续处理 500 RPS。按该假设，损失一节点后容量为 1500 RPS；业务 1200 RPS 已占 80%，剩余约 20% 预算，还需 N+1 故障状态实测。不是把四台峰值相加为 2000，就能承诺一台故障时仍有同样能力。

慢上游会增加在途，慢客户端、TLS 握手和插件外部调用也会改变资源占用。分清连接池等待、事件循环阻塞、CPU、共享字典、Lua 内存、定时器和日志出口；总体 CPU 不高也可能有单 worker 饱和或外部等待。

压测应保留请求大小、连接复用、协议、TLS、插件集合、上游延迟、限额和版本。官网基准用于了解测试方法，不能代替自己负载下的可持续容量。

## 2. Runbook

| 现象 | 第一检查层 | 关键证据 |
| --- | --- | --- |
| 404 | 先判定路由前还是上游返回 | Host、URI、Method、Route、上游尝试与响应体 |
| 401/403 | Consumer/认证授权插件 | 凭据、插件配置、时钟、Scope |
| 429 | 限流 | Key、计数存储、阈值、重试客户端 |
| 502 | 上游连接/协议 | Node、DNS、TLS、Reset、健康状态 |
| 504 | 超时链 | Connect/Read/Send、上游处理时间 |
| 配置不生效 | 配置来源→Admin/etcd→Watch→本地路由 | 对象 modifiedIndex、本地值、节点与请求行为 |
| 延迟高 | 分段时间 | 网关排队、插件、上游、日志出口 |

### 2.1 先固定入口、日志与一份测试对象

以下仅针对已部署、隔离的测试实例：业务入口 `127.0.0.1:9080`，Admin API 为回环 9180，Control API 已启用并限制在回环 9090。容器内回环地址代表当前容器，不是宿主机；应在对应网络命名空间查询。

Admin 凭证保存在受控的 `/etc/apisix/admin-read.headers`，内容为适当只读角色的请求头，文件仅授权账号可读。不要把真实 Key 放进命令行、工单或日志；下面只发送 GET，不发布或删除配置。日志路径以实际安装为准。

在实验准备阶段可合并以下日志配置，保留 Nginx 原生变量的分段时间。修改日志格式仍是配置变更，应先验证并受控加载，不能故障现场盲目覆盖整个 config.yaml：

```yaml
nginx_config:
  http:
    enable_access_log: true
    access_log_format_escape: json
    access_log_format: '{"rid":"$request_id","host":"$host","uri":"$request_uri","status":"$status","upstream":"$upstream_addr","us":"$upstream_status","rt":"$request_time","uct":"$upstream_connect_time","uht":"$upstream_header_time","urt":"$upstream_response_time"}'
```

这里没有把 APISIX Lua 上下文变量冒充为 Nginx 原生变量。需要 route_id、service_id 等时，使用支持这些字段的 APISIX 日志插件/Trace，并与请求标识关联；不能直接向原生 log_format 填入不存在的变量。

假设已存在且没有其他兜底路由覆盖的测试 Route，Admin GET 的脱敏字段摘录如下：

```bash
curl --fail-with-body --silent --show-error --header @/etc/apisix/admin-read.headers http://127.0.0.1:9180/apisix/admin/routes/demo-orders
```

```json
{
  "key": "/apisix/routes/demo-orders",
  "modifiedIndex": 42,
  "value": {
    "id": "demo-orders",
    "name": "orders-lab",
    "status": 1,
    "priority": 10,
    "uri": "/v1/orders/*",
    "hosts": ["api.lab.test"],
    "methods": ["GET"],
    "plugins": {"prometheus": {}},
    "upstream": {
      "type": "roundrobin",
      "nodes": {"127.0.0.1:18081": 1},
      "timeout": {"connect": 1, "send": 1, "read": 2},
      "retries": 0
    }
  }
}
```

此例直接内联 Upstream，便于对照。实际若引用 Service、Upstream、Plugin Config、Consumer，还需沿引用查对象，不能只看 Route 一层就认定最终配置。3.20.0 的 Admin API 返回包装与字段见[固定版本 Admin API](https://github.com/apache/apisix/blob/3.20.0/docs/en/latest/admin-api.md)。

### 2.2 路由不匹配与上游 404 分开排查

先保留真实请求的目标节点、Host、方法、路径和协议。HTTPS 还涉及 SNI、证书与入口监听，不能只把 URL 换成 IP 就认为请求等价。

```bash
curl --silent --show-error --include -H 'Host: wrong.lab.test' 'http://127.0.0.1:9080/v1/orders/1001?diag=host-001'
curl --silent --show-error --include -H 'Host: api.lab.test' 'http://127.0.0.1:9080/v1/orders/1001?diag=host-002'
tail -n 2000 /usr/local/apisix/logs/access.log | rg 'diag=host-00'
```

diag 仅为无敏感信息的测试标识，不放认证材料。按本例的路由集合，第一条可得到 404 和以下响应正文；正确 Host 的请求还需上游健康才能返回预期业务状态：

```json
{"error_msg":"404 Route Not Found"}
```

第一条请求的一条教学日志为：

```json
{"rid":"r-host-001","host":"wrong.lab.test","uri":"/v1/orders/1001?diag=host-001","status":"404","upstream":"-","us":"-","rt":"0.001","uct":"-","uht":"-","urt":"-"}
```

rid 为脱敏占位值，实际由实例生成。响应正文、无上游尝试与实际匹配条件共同支持“还未进入目标上游”的判断；不能只凭正文相似或 404 一个状态码断言。

再在该数据面节点查看本地对象，而不是只查 Admin：

```bash
curl --fail-with-body --silent --show-error http://127.0.0.1:9090/v1/route/demo-orders
```

检查 Host/hosts、uri/uris、methods、vars、路由 priority 与 status，及是否有更高优先级/其他路由命中。Route 的 priority 是匹配优先级，不是插件执行优先级。

| 证据 | 下一步 |
| --- | --- |
| 本地有正确 Route，但请求条件不同 | 修正调用方/入口转发条件，保留同一方法/协议验证 |
| Admin 有对象，本地查不到或值旧 | 转入配置下发链，不先扩大通配范围掩盖问题 |
| 已匹配目标 Route，存在上游 404 | 检查实际转发 URI、Host、改写插件与应用日志 |
| 只有经负载均衡访问偶发失败 | 逐节点/Pod 对照，不用一台成功代表全部正常 |

恢复验证应包含预期请求成功、错误 Host/方法仍按原策略拒绝，以及所有入口节点结果一致，而不是把路由改成 `/*` 后看到 200 就结束。

### 2.3 Admin 新、本地旧时查配置下发链

在 etcd 驱动形态，常见路径是 Admin 校验/写入→etcd→watch/同步→worker 本地配置和路由结构。请求不需要每次重新读 etcd；但冷启动、控制连接、引用对象或内存中的配置更新仍可能失败。Standalone 则应查其本地文件/API 来源，不能强套 etcd 链。

沿用上例，假设发布目标把 URI 改成 `/v2/orders/*`。两次只读查询得到的脱敏摘录可以是：

```json
{
  "admin": {"modifiedIndex": 43, "value": {"id": "demo-orders", "uri": "/v2/orders/*"}},
  "data_plane_control": {"orig_modifiedIndex": 42, "modifiedIndex": 42, "value": {"id": "demo-orders", "uri": "/v1/orders/*"}}
}
```

这说明该次本地查询仍是旧值，不证明 Admin 写入失败，也不证明整个集群都旧。Control API 返回的是被查询实例/处理视角，需逐节点观察；引用合并或内部表示还可能改变版本形式，不把对象索引、集群 revision、Kubernetes resourceVersion 和所有本地版本号直接画等号。

继续检查当前部署角色、配置提供者、etcd 地址与前缀、认证/TLS、网络、watch 错误、节点启动时间和资源引用，并查询已有错误日志：

```bash
tail -n 2000 /usr/local/apisix/logs/error.log | rg -i 'etcd|watch|revision|timeout|certificate|permission'
curl --fail-with-body --silent --show-error http://127.0.0.1:9090/v1/route/demo-orders
```

如果 CP/etcd 记录正确而只有一台节点旧，优先验证这台的连通与本地同步；若所有节点都旧，检查共同配置来源、控制链与发布目标；若对象本身已被改回，则检查 Controller/GitOps 与人工 Admin API 是否争用同一对象。

etcd 异常时先检查 Quorum、磁盘、网络、Leader 与备份，不能删除数据目录或全量重建来“刷新缓存”。短时故障中已加载路由可能继续服务，不表示新配置和冷启动也正常。

恢复后重复 Admin/Control 查询、逐节点真实请求和引用对象核对；只看 watch 连接重建或版本数字增加还不够。相关职责见[部署模式](https://github.com/apache/apisix/blob/3.20.0/docs/en/latest/deployment-modes.md)、[Control API](https://github.com/apache/apisix/blob/3.20.0/docs/en/latest/control-api.md)及[config_etcd.lua](https://github.com/apache/apisix/blob/3.20.0/apisix/core/config_etcd.lua)。

### 2.4 已进入上游的 502 与 504 按阶段定位

假设目标 Route 已在本地更新为 v2，使用上例单节点 Upstream，且 retries=0。下面从网关所在网络命名空间对照代理与直连；直连需保留业务 Host/路径：

```bash
curl --silent --show-error --include --connect-timeout 1 --max-time 5 -H 'Host: api.lab.test' 'http://127.0.0.1:9080/v2/orders/1001?diag=slow-001'
tail -n 2000 /usr/local/apisix/logs/access.log | rg 'diag=slow-001'
tail -n 2000 /usr/local/apisix/logs/error.log | rg 'upstream timed out|connect\(\) failed|no live upstreams|SSL'
curl --silent --show-error --include --connect-timeout 1 --max-time 5 -H 'Host: api.lab.test' 'http://127.0.0.1:18081/v2/orders/1001?diag=direct-001'
```

一次代理请求在等上游响应头时超时，教学日志可以是：

```json
{"rid":"r-slow-001","host":"api.lab.test","uri":"/v2/orders/1001?diag=slow-001","status":"504","upstream":"127.0.0.1:18081","us":"504","rt":"2.006","uct":"0.001","uht":"-","urt":"2.002"}
```

若错误日志还出现 `upstream timed out` 与 `while reading response header from upstream`，则支持“选到了该节点并建立连接，但未在读取等待内取得完整响应头”的判断。它仍不能单独区分应用排队、数据库慢、服务线程阻塞或网络回包问题，需对照同请求/时间窗口的上游证据。

| 字段/设置 | 单位或语义 | 不应误解为 |
| --- | --- | --- |
| Upstream `timeout.connect` | 秒，建立上游连接等阶段的等待 | 业务总处理时间 |
| `timeout.send` | 秒，向上游写数据时的等待边界 | 给下游客户端发送整个响应的期限 |
| `timeout.read` | 秒，读取上游数据的等待边界，常涉及相邻读取间隔 | 整个长连接/流式响应只能持续这么久 |
| `$upstream_connect_time` | 秒，建立上游连接耗时，HTTPS 还涉及握手 | 已包含所有响应时间 |
| `$upstream_header_time` | 秒，取得上游响应头的耗时；没有可用结果时可能为 `-` | 必定始终有一个数值 |
| `$upstream_response_time` | 秒，上游尝试耗时；重试时可能是多个值 | 整个客户端请求耗时 |
| `$request_time` | 秒，客户端请求处理的总时间口径 | 纯 Lua CPU 时间 |

同一次尝试中 connect/header/response 时间不是三个互不重叠的片段，不能直接相加。此例 2.006 与 2.002 秒相差约 4 毫秒，也不证明插件只消耗了 4 毫秒 CPU。多次尝试还可能以逗号等形式记录，先对齐节点与每次尝试，再比较。

read=2 不表示持续输出的 SSE 必须两秒内结束；反过来，首个响应头或后续数据长时间没有到达也可能触发读取超时。客户端 max-time、外层 LB、应用超时和整体预算是另外的边界，详见[Nginx 上游变量](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#variables)和[代理超时](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_read_timeout)。

连接拒绝、DNS/TLS、无健康节点、协议不匹配等错误需按错误阶段继续排查，不能看 502 就把 read 超时调大。HTTPS 直连测试应保留 Host、SNI 和证书校验语义，不用关闭验证来掩盖问题。恢复后还要确认副作用是否重复、错误率与尾延迟回归；增加重试会放大流量，写请求尤其要有业务幂等契约。

### 2.5 插件阶段与优先级分开核对

APISIX 的插件 rewrite/access 等阶段不是原生 Nginx 枚举的一比一名称映射。3.20.0 的 `http_access_phase()` 中会完成路由与插件处理，并调用相应插件 rewrite/access 路径；Consumer 认证后还可能合并配置，不能只按名称猜实际函数位置。

同阶段通常按 priority 数值从大到小执行，支持的 `_meta.priority` 可调整该阶段内排序；它不能让 access 中的插件跨到 rewrite 前。Global Rule 与 Route/Consumer 插件也不应混成一份简单列表。核对实际插件版本、加载列表、Schema、禁用/过滤条件、阶段和最终合并配置，再判断“配置里有插件，为何没有效果”。

| 现象 | 重点核对 |
| --- | --- |
| 401/403、无上游尝试 | 认证/授权插件、Consumer、时间/Scope，不先责怪应用 |
| 429 | 插件实际 key、阈值、计数存储、共享范围与客户端重试 |
| 外部 OIDC 等等待导致变慢 | 外部依赖时延、连接/缓存与失败模式，不仅看网关 CPU |
| 响应转换异常 | header/body filter、分块/编码/长度与插件版本 |

不要把插件配置 JSON 的键顺序当执行顺序，也不要在 filter/log 阶段随意调用只能在其他阶段使用的阻塞或 cosocket API。源码对应[init.lua](https://github.com/apache/apisix/blob/3.20.0/apisix/init.lua)、[plugin.lua](https://github.com/apache/apisix/blob/3.20.0/apisix/plugin.lua)与[插件开发文档](https://github.com/apache/apisix/blob/3.20.0/docs/en/latest/plugin-develop.md)。

### 2.6 指标只做分流，根因仍回到同请求证据

启用 Prometheus 插件和仅限内网/回环的 exporter 后，可以查询：

```bash
curl --fail-with-body --silent --show-error http://127.0.0.1:9091/apisix/prometheus/metrics | rg 'apisix_http_status|apisix_http_latency|apisix_upstream_status'
```

只给某条 Route 启用的采集范围，不一定包含未匹配请求；要观察路由前失败应按全局采集需求配置，不能把没有指标当成没有故障。查询示例：

```promql
sum by (route) (rate(apisix_http_status[5m]))

histogram_quantile(0.99,
  sum by (le, route) (rate(apisix_http_latency_bucket{type="request"}[5m]))
)
```

3.20.0 的 http_latency 单位为毫秒；原生 Nginx 上述时间变量为秒，展示时先统一单位。request/upstream/apisix 三种类型含义不同，apisix 是请求时间与上游时间的差值口径，不是纯插件 CPU；也不能拿 `P99(request)-P99(upstream)` 代替逐请求差值的 P99。

控制 route/consumer 等标签基数，不把完整 URI 参数、用户 ID 或 request ID 直接做指标标签。单请求通过日志/Trace 关联，群体趋势用指标，二者不要互相替代。详见[3.20.0 Prometheus 文档](https://github.com/apache/apisix/blob/3.20.0/docs/en/latest/plugins/prometheus.md)。

## 3. 升级

固定 APISIX、etcd、Ingress Controller、Lua 插件和 Helm Chart 版本。阅读不兼容变更；备份 etcd；在预生产导入生产配置；先金丝雀一个数据面节点，验证路由、插件、TLS 和指标，再滚动。回滚要考虑新配置是否被旧版本识别。

同时记录底层 OpenResty/Nginx 与自定义插件构建信息，不能拿开源 Nginx 某个 tag 的行为无条件替代 APISIX 发行包。配置备份还需明确部署模式：etcd 快照、Standalone 文件、证书/密钥引用和插件产物不是同一份东西。

升级验证至少覆盖路由匹配、鉴权拒绝、限流、URI/Host 改写、TLS、长连接/流式响应、日志与指标，以及 Control API 本地对象和逐节点真实流量。回滚二进制前检查旧版本能否识别新 Schema、插件和配置，不把“容器启动成功”当成完整兼容证明。

先确认单节点与 N+1 容量，连接排空和滚动期间要留余量。恢复配置与恢复业务结果也不同，不能因为已备份就跳过还原和数据面行为验证。

## 4. 选型问题

评估现有 Nginx/Lua 经验、所需认证与流量插件、动态配置方式、Kubernetes/Gateway API、扩展语言、性能和运维能力。少量稳定代理规则可比较 Nginx/HAProxy；需要动态路由、身份和插件治理时再比较 APISIX 等网关的收益与代价，不由产品名替代负载验证。

能否排清“请求命中了什么、本地用了哪版配置、插件为何执行/跳过、上游在哪一步失败”，比只比较一个峰值 RPS 更重要。原生 Nginx 的执行基础可结合[HTTP 阶段与过滤链](../nginx/01-core/08-Nginx-HTTP-Phase-Module-Subrequest与Filter源码.md)阅读，但两者阶段名称不能直接互换。

## 5. 验收题

### 5.1 APISIX 返回 404，就一定是没有 Route 吗？

答案：不是。可能未匹配，也可能已经转发后由应用返回。应结合请求条件、本地路由、上游尝试、响应体与日志，不能只看状态码或扩大通配范围。

### 5.2 Admin GET 已是新 URI，为什么真实请求仍走旧配置？

答案：Admin/etcd 与数据面内存是不同状态，可能查错部署来源、节点 watch/同步异常、引用对象未更新或有其他控制器回写。查目标节点 Control API、实际值与日志，并逐节点验证，不把一次管理 API 成功当作全局生效。

### 5.3 Control API 返回正确对象，能证明所有 worker 都已更新吗？

答案：不能。它是被查询实例/处理视角的观察，还需结合节点、worker 与真实流量采样。也不能无条件把 modifiedIndex、orig_modifiedIndex、etcd revision 和 Kubernetes resourceVersion 当成同一编号。

### 5.4 upstream connect 约一毫秒，为什么仍能 504？

答案：连接建立不等于应用及时返回响应头或正文。若读取响应头超时，继续查上游排队、依赖、服务处理和网络回包；不要把 connect/header/response 三个可能重叠的时间直接相加。

### 5.5 read timeout 为两秒，SSE 就只能持续两秒吗？

答案：不是。它控制相应上游读取等待，不是整段流的总期限；持续有数据的流可以更久。还需独立核对首头、后续空闲、客户端、外层 LB 和业务总预算。

### 5.6 插件 priority 更高，就一定比其他阶段先执行吗？

答案：不一定。优先级主要比较同阶段的插件，不能跨阶段提前；Global Rule、Consumer 合并、禁用/过滤和实际加载版本也影响结果。Route 匹配 priority 又是另一种优先级。

### 5.7 request_time 减 upstream 时间，就是 Lua CPU 吗？

答案：不是。还可能包含下游收发、Nginx 与其他等待，且多尝试和计时口径需对齐。群体分位数不能简单相减，APISIX latency 的差值也不能当纯插件执行时间。

### 5.8 四台各承载五百 RPS，坏一台还剩多少预算？

答案：按相同 SLO 与负载实测条件，剩三台约 1500 RPS；业务 1200 占 80%，剩约 20%。实际还要验证负载均衡、热点、连接和重试，不直接沿用四台的峰值总和。

### 5.9 etcd 暂时不可达，删目录或重启全节点能加速恢复吗？

答案：不能作为默认处理。应保留数据与 Quorum，先查磁盘、网络、认证、Leader 和同步；已加载路由仍可能服务，全节点重启反而会把局部更新问题扩大为冷启动依赖故障。

### 5.10 升级回滚为什么不能只保留旧镜像？

答案：新配置 Schema、插件产物、证书引用和控制面状态可能不被旧版本识别，长连接与容量也会影响滚动恢复。需要匹配的配置/产物备份和隔离验证，不能只看进程启动。

## 6. 参考资料

- [APISIX 3.20.0](https://github.com/apache/apisix/releases/tag/3.20.0)
- [Admin API](https://github.com/apache/apisix/blob/3.20.0/docs/en/latest/admin-api.md)
- [Control API](https://github.com/apache/apisix/blob/3.20.0/docs/en/latest/control-api.md)
- [Deployment modes](https://github.com/apache/apisix/blob/3.20.0/docs/en/latest/deployment-modes.md)
- [Prometheus](https://github.com/apache/apisix/blob/3.20.0/docs/en/latest/plugins/prometheus.md)
- [Plugin development](https://github.com/apache/apisix/blob/3.20.0/docs/en/latest/plugin-develop.md)
- [APISIX init.lua](https://github.com/apache/apisix/blob/3.20.0/apisix/init.lua)
- [APISIX plugin.lua](https://github.com/apache/apisix/blob/3.20.0/apisix/plugin.lua)
- [APISIX config_etcd.lua](https://github.com/apache/apisix/blob/3.20.0/apisix/core/config_etcd.lua)
- [APISIX FAQ](https://apisix.apache.org/docs/apisix/FAQ/)
- [APISIX Benchmark](https://apisix.apache.org/docs/apisix/benchmark/)
