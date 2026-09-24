---
title: "OpenResty 与 LuaJIT 性能分析：从 Nginx Worker 到 Lua 火焰图"
sidebar_label: "04. OpenResty、LuaJIT 与火焰图"
sidebar_position: 4
description: "沿 Nginx phase、ngx_lua、LuaJIT、FFI 和系统调用拆解 APISIX/OpenResty CPU 性能问题，掌握火焰图的采集、阅读、归因和验证。"
tags: [OpenResty, LuaJIT, APISIX, Nginx, Flame Graph, 性能分析]
---

# OpenResty 与 LuaJIT 性能分析：从 Nginx Worker 到 Lua 火焰图

APISIX 或 OpenResty 进程 CPU 很高时，`top` 只能指出哪个 Worker 忙，不能说明时间消耗在 Nginx 核心、Lua 插件、LuaJIT 生成代码、FFI 调用、正则表达式还是系统调用。火焰图的价值，是把采样得到的调用栈按出现频率聚合，让“CPU 时间沿哪条调用链消耗”可见。

> **版本边界（2026-09）**：当前 APISIX 3.18 架构仍建立在 Nginx、ngx_lua 与 LuaJIT 之上，但二进制符号、JIT profiler、内核追踪能力和容器权限会随发行版变化。本文只把火焰图读法和分层排查作为稳定原理；采样工具与参数必须在目标 OpenResty/APISIX 镜像上验证，不能照搬旧版 SystemTap 脚本。

## 1. 一次请求跨过哪些执行层

```text
客户端
  → Nginx event loop
    → rewrite/access/balancer/content/header_filter/log 等 phase
      → ngx_lua 模块
        → Lua 字节码解释执行
          或 LuaJIT Trace 机器码
        → Lua/C API 或 FFI 调用
          → PCRE、OpenSSL、JSON、系统库
            → 内核系统调用
```

因此“Lua 插件慢”可能有不同含义：

- Lua 代码自身循环或对象分配过多；
- 热路径没有成功 JIT，一直解释执行；
- JIT Trace 频繁退出；
- Lua 调用的 C/FFI 函数很重；
- Worker 实际在等待 DNS、上游、锁或磁盘；
- 日志、TLS、正则或压缩消耗 CPU，与 Lua 业务逻辑无关。

必须先区分 on-CPU 与 off-CPU，再解释火焰图。

## 2. 火焰图到底表示什么

每个矩形代表一个栈帧：

- 横向宽度：该帧出现在样本中的数量，占用越宽表示 CPU 样本越多；
- 纵向高度：调用栈深度，上层调用下层；
- 横向位置：通常只是聚合排序，不代表时间先后；
- 颜色：默认往往只是视觉区分，除非生成工具明确赋予含义。

“最宽的函数”不一定就是缺陷：

- 它可能是所有请求必经的公共入口；
- 它可能只是调用了真正昂贵的子函数；
- 优化叶子节点后，上层框自然也会变窄；
- 采样偏差、符号缺失或栈展开失败会制造假象。

正确问题是：哪条完整路径消耗了多少样本，它是否与请求量和延迟变化一致，能否通过实验改变。

## 3. 先证明 CPU 是瓶颈

采样前保存同一时间窗口的业务和系统证据：

```bash
date -Is
pidof nginx
ps -eo pid,ppid,psr,pcpu,pmem,stat,comm,args --sort=-pcpu | head -30
pidstat -p ALL -u -w 1 10
mpstat -P ALL 1 10
```

同时记录：

- 请求量、P50/P95/P99 和错误率；
- 每个 Nginx Worker 的 CPU，而不是只看进程组总值；
- 节点是否存在 CPU throttling、steal、软中断或 NUMA 不均；
- APISIX Route、插件和发布版本；
- upstream latency 与 gateway latency 的差值。

如果 CPU 空闲而请求慢，on-CPU 火焰图可能没有答案，应转向连接池、上游、DNS、锁和 off-CPU 分析。

## 4. 通用 perf 采样

选择最繁忙的 Worker PID，在可控时间窗口采样：

```bash
WORKER_PID=12345

sudo perf record \
  -F 99 \
  -g \
  --call-graph dwarf \
  -p "${WORKER_PID}" \
  -- sleep 30

sudo perf report --stdio --children
```

参数含义：

| 参数 | 作用 |
| --- | --- |
| `-F 99` | 每秒约 99 次采样，避免与固定周期过度同步 |
| `-g` | 记录调用栈 |
| `--call-graph dwarf` | 使用 DWARF 展开用户态调用栈 |
| `-p` | 只观察目标 Worker，减少无关样本 |
| `-- sleep 30` | 控制采样窗口，防止长期运行 |

如果环境使用 frame pointer，可测试 `--call-graph fp` 的开销和完整度。不同二进制编译选项、内核、架构和容器权限会影响结果，不能把一种展开方式机械复制到所有环境。

生成经典 SVG 火焰图时可使用 Brendan Gregg 的 FlameGraph 工具链：

```bash
sudo perf script > perf.script
stackcollapse-perf.pl perf.script > perf.folded
flamegraph.pl perf.folded > openresty-oncpu.svg
```

上述文件可能包含函数名、路径和业务模块信息，应按生产证据管理要求保存和脱敏。

## 5. 为什么普通 perf 看不全 Lua

LuaJIT 有三类执行形态：

```text
Lua source
  → bytecode
    ├─ Interpreter：解释器逐条执行字节码
    └─ JIT compiler：把热点 trace 编译为机器码
```

普通原生采样器擅长识别 ELF 符号，但 JIT 机器码运行时才生成，不一定天然带有可被 perf 正确解析的符号。结果可能出现：

- 大量地址或 `[unknown]`；
- 只看到 LuaJIT VM 入口，看不到 Lua 函数；
- C 调用清楚，Lua 源码栈断裂；
- JIT Trace 被合并成难以解释的大块。

因此 OpenResty/LuaJIT 分析需要能理解 Lua VM、JIT Trace 和 Nginx Worker 的专用采样方式。可选路径包括 OpenResty 官方动态追踪工具、SystemTap/eBPF 方案或 OpenResty XRay。选型前确认内核支持、LuaJIT/OpenResty 版本、符号和生产开销。

## 6. 常见栈帧怎样解释

| 栈帧类别 | 代表什么 | 下一步 |
| --- | --- | --- |
| `ngx_worker_process_cycle`、事件循环 | Nginx Worker 主循环 | 向上看实际事件处理路径 |
| `ngx_http_*` | Nginx HTTP phase、filter、upstream | 区分解析、代理、过滤和日志 |
| `ngx_http_lua_*` | ngx_lua 进入 Lua 或恢复协程 | 继续解析 Lua 栈 |
| LuaJIT VM/bytecode frame | 解释执行 Lua 字节码 | 检查为何热路径未 JIT |
| JIT trace | 已编译的 Lua 热路径 | 定位 trace 内源码和退出点 |
| `lj_*` | LuaJIT VM、GC、编译器或运行时 | 判断分配、GC、编译和执行成本 |
| `pcre*` / `pcre2*` | 正则编译或匹配 | 检查表达式、缓存和输入长度 |
| `cjson*` | JSON 编解码 | 检查大对象、重复编码和数据结构 |
| `SSL_*` / `EVP_*` | TLS/加密 | 核对握手复用、算法和证书链 |
| `ngx_shmtx_*` | Nginx 共享内存锁 | 检查共享字典热点键和写竞争 |
| `sys_*`、libc 系统调用 | 内核边界 | 继续用 syscall、I/O、网络证据验证 |

看到 C 函数很宽不表示 Lua 没问题：可能正是某个 Lua 插件高频调用了昂贵的 C/FFI 函数。需要保留从请求 phase、Lua 函数到 C 函数的父子链。

## 7. LuaJIT 特有的性能问题

### 7.1 热路径没有 JIT

可能原因包括：

- 代码只执行少量次数，尚未达到热点阈值；
- 使用 LuaJIT 不支持或难以优化的操作；
- 数据类型不断变化，trace 不稳定；
- 调试配置或运行参数关闭了 JIT；
- Trace 过大、嵌套或达到相关限制。

优化目标不是“让所有代码都 JIT”。冷路径和管理路径解释执行完全合理；应关注高 QPS 请求中的稳定热点。

### 7.2 Trace Exit

JIT Trace 对一组运行时假设进行优化，例如某变量一直是数字。当真实输入违反假设时会退出到解释器。频繁退出可能造成：

```text
进入 JIT trace
→ 守卫条件失败
→ 回到解释器
→ 再次进入或编译其他 trace
→ CPU 上升且延迟抖动
```

需要把退出点与输入类型、分支和发布变化对应起来，不能仅根据“开启了 JIT”推断运行路径已经优化。

### 7.3 分配与 GC

高频创建临时 table、拼接字符串、重复解析 JSON 会增加分配和 GC 压力。常见优化方向：

- 避免在请求热循环内创建无意义临时对象；
- 使用 table 缓冲后一次连接字符串；
- 缓存稳定的解析结果，但限制缓存大小和生命周期；
- 避免把大对象长期留在全局或共享结构中；
- 先用 profile 证明分配路径，再修改代码。

## 8. Nginx phase 与 APISIX 插件归因

APISIX 插件运行在不同 phase，故障含义也不同：

| Phase | 常见工作 | CPU 热点示例 |
| --- | --- | --- |
| rewrite | URI/参数改写、前置逻辑 | 正则、字符串处理 |
| access | 认证、鉴权、限流 | JWT、签名、共享字典锁 |
| balancer | 上游选择 | 服务发现、哈希、重试决策 |
| body/header filter | 响应修改 | 压缩、JSON、流式处理 |
| log | 日志和上报 | 序列化、同步 I/O、队列拥塞 |

归因步骤：

1. 按 Route、Service、Consumer 或插件组合切分指标；
2. 找到 CPU 上升与哪类请求同步；
3. 对高 CPU Worker 采样；
4. 在栈中定位 phase 和插件函数；
5. 使用受控流量关闭单个非关键插件或切换到基线版本；
6. 比较相同请求分布下 CPU、吞吐和延迟。

不能只在低流量时关闭插件后看到 CPU 下降，就把收益归因于插件优化；实验输入必须可比。

## 9. on-CPU 看不到等待时间

Worker 可能大部分时间不占 CPU，却因等待上游、DNS、磁盘、锁或连接池而产生高延迟。此时 on-CPU 图只展示少量运行片段。

需要联合：

```text
Nginx access log：request_time、upstream_*_time
连接指标：active、reading、writing、waiting
系统调用：connect、recvfrom、sendto、epoll_wait、futex
网络：重传、SYN、DNS、上游握手
off-CPU profile：阻塞栈与等待时长
```

判断示例：

| 证据 | 更可能的方向 |
| --- | --- |
| Worker CPU 高，火焰图宽在正则/JSON | 计算热点 |
| CPU 低，`upstream_response_time` 高 | 上游服务或网络 |
| CPU 低，upstream connect 高 | DNS、连接池、SYN/TLS |
| CPU 高，`ngx_shmtx` 宽 | 共享内存锁竞争 |
| CPU 高，软中断集中 | 网卡/RPS/RFS/IRQ，而非 Lua |

## 10. 生产采样安全

- 先在压测或单个 canary Worker 验证采样开销；
- 限定 PID、频率和持续时间；
- 不在未知开销下对全部 Worker 长时间采样；
- 记录采样工具、参数、内核、OpenResty/LuaJIT/APISIX 版本；
- 保留同期请求量和延迟，否则火焰图无法做前后比较；
- 检查 SVG 和栈文件是否包含业务函数、租户或路径信息；
- 修改前后使用同一流量模型重新采样，不只比较主观体验。

容器内权限不足时，可在节点上根据容器 PID namespace 找到宿主机 PID，再按组织安全规范采样。不要为了方便给网关容器长期授予 `privileged`。

## 11. 完整排障流程

```text
确认用户影响和时间窗口
→ 对齐 QPS、延迟、错误率与 Worker CPU
→ 判断 on-CPU 还是等待型问题
→ 找出最忙 Worker
→ 短时采样并保留版本/流量证据
→ 从 Nginx phase 追到 Lua/JIT/C/内核
→ 提出一个可证伪假设
→ 单变量修改或 canary
→ 同负载复测吞吐、延迟、CPU 和火焰图
→ 回归功能、错误率和内存
```

## 12. 练习与答案

**问题 1：火焰图横轴从左到右是否代表请求执行时间？**

通常不是。宽度表示样本占比，横向排列用于聚合相同栈，不能按左右读取时间顺序。

**问题 2：为什么看到 `[unknown]` 不能直接断定是内核故障？**

JIT 代码动态生成，普通 perf 可能没有符号；二进制缺少调试信息或栈展开失败也会产生 unknown。先验证符号化和采样方式。

**问题 3：CPU 火焰图中 `epoll_wait` 很宽，是否表示 epoll 消耗大量 CPU？**

要先确认采样口径。on-CPU 采样通常不会把正常睡眠等待当 CPU 消耗；若混入 wall-clock/off-CPU 数据，宽度语义不同。必须标明 profile 类型。

**问题 4：某 APISIX 插件函数最宽，是否可以立即删除插件？**

不能。它可能是公共入口，真正热点位于子函数；也要确认请求量、功能必要性和采样代表性。先构造同输入的单变量实验。

## 13. 参考资料

- [OpenResty Lua CPU Flame Graphs](https://blog.openresty.com/en/lua-cpu-flame-graph/)
- [OpenResty SystemTap Toolkit](https://github.com/openresty/openresty-systemtap-toolkit)
- [LuaJIT Running](https://luajit.org/running.html)
- [FlameGraph](https://github.com/brendangregg/FlameGraph)
- [Linux perf、PMU 与火焰图原理](../../../linux/system-internals/12-observability/04-perf-PMU采样与火焰图原理.md)
