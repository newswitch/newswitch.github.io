---
title: "HTTP Phase、Module、Subrequest、Filter 与变量源码"
sidebar_label: "08. HTTP Phase、Module、Subrequest、Filter 与变量源码"
sidebar_position: 8
description: "以 Nginx 1.28.0 源码跟踪配置合并、Phase Engine、内部跳转、子请求和过滤链，用请求轨迹解释返回值、变量时机与异步生命周期。"
tags: [Nginx, 源码, HTTP Phase, Filter]
---

# HTTP Phase、Module、Subrequest、Filter 与变量源码

配置文件不是请求到来后从上往下执行的脚本。Nginx 先解析指令、创建并合并模块配置，再把模块处理函数装入请求阶段；运行时由阶段引擎、事件回调和过滤链协作完成请求。

本文固定开源 Nginx `release-1.28.0`，不把主线新指令、商业模块或 OpenResty 补丁视为该 tag 的事实。实际程序要先核对 `nginx -V` 的版本、构建参数与模块；下面的输出和调用轨迹是教学示例。

从请求处理看，可以先建立这张阶段地图：

```text
post-read → server-rewrite → find-config
→ rewrite → post-rewrite → preaccess → access
→ post-access → precontent → content
请求收尾时：log
```

## 1. 配置与阶段引擎

### 1.1 配置创建、合并与请求选择

`ngx_http_block()` 为各 HTTP 模块创建 main/srv/loc 配置，解析 server/location 等上下文，再调用模块提供的合并函数。模块通过 `ctx_index` 找到自己的配置槽位；配置内容与继承规则由具体模块定义，不是所有指令天然使用同一种继承方式。

请求不再把这些配置重新解析一遍，而是在 server/location 选择后关联对应配置。内部跳转还可能更新 `r->loc_conf`，因此“最初命中的 location”不一定是最终执行内容和记录日志的 location。

### 1.2 阶段、checker 与模块 handler

| 部分 | 源码位置/函数 | 职责 |
| --- | --- | --- |
| 配置组织 | `src/http/ngx_http.c` 的 `ngx_http_block` | 创建、解析和合并模块配置，执行模块初始化钩子 |
| 阶段枚举 | `src/http/ngx_http_core_module.h` 的 `ngx_http_phases` | 声明 POST_READ 到 LOG 等阶段 |
| 执行数组构建 | `ngx_http_init_phase_handlers` | 把注册函数与对应 checker 组织进 Phase Engine |
| 执行驱动 | `ngx_http_core_run_phases` | 根据 `r->phase_handler` 调用当前 checker，允许推进、跳转和让出 |
| 阶段语义 | `ngx_http_core_generic_phase`、`ngx_http_core_rewrite_phase`、`ngx_http_core_access_phase`、`ngx_http_core_content_phase` | 解释该阶段的 handler 返回值与后续动作 |
| 日志收尾 | `src/http/ngx_http_request.c` 的 `ngx_http_log_request` | 在请求收尾路径调用 LOG handler |

FIND_CONFIG、POST_REWRITE、POST_ACCESS 有核心调度职责，不是简单的“每个阶段都有任意数量同款模块函数”。LOG 在枚举里，但 `ngx_http_init_phase_handlers` 构建普通执行数组时遍历到 LOG 之前；它通过收尾路径调用，不是响应完成后再从普通引擎顺走一步。

同阶段 handler 也不能只按配置行位置排序。这个 tag 构建普通阶段数组时，按注册数组的逆序装入；而单个模块自己的指令又可能有明确的文本顺序。例如 rewrite 模块的多条 rewrite/return/set 按其规则顺序执行。应分清“阶段顺序”“模块注册顺序”和“模块内部指令顺序”，见[固定版本阶段构建](https://github.com/nginx/nginx/blob/release-1.28.0/src/http/ngx_http.c)与[rewrite 指令规则](https://nginx.org/en/docs/http/ngx_http_rewrite_module.html)。

### 1.3 NGX_OK 不总是整条请求成功结束

以 `ngx_http_core_generic_phase()` 为例，下面是源码中一个短分支：

```c
if (rc == NGX_OK) {
    r->phase_handler = ph->next;
    return NGX_AGAIN;
}
```

这里 rc 是模块 handler 的返回值；checker 返回的 NGX_AGAIN 又是告诉外层引擎继续推进。两层返回值不能当成同一件事。

| 模块 handler 返回值 | generic checker 的动作 | 不能误解为 |
| --- | --- | --- |
| `NGX_OK` | 跳到该阶段结束后的 next | 整个 HTTP 请求已经返回 200 |
| `NGX_DECLINED` | 尝试下一 handler | HTTP 拒绝响应或 403 |
| `NGX_AGAIN` / `NGX_DONE` | 停止本轮推进，由模块已安排的路径继续或完成 | 自动创建了线程，或引擎会立即忙循环重试 |
| `NGX_ERROR` / HTTP 状态等 | 进入相应 finalize 路径 | 所有错误都应无条件继续下一 handler |

这张表只解释 generic checker，不能原样套给所有阶段。ACCESS 还需处理 `satisfy all/any` 等语义；CONTENT 可使用 location 已设置的 content handler，其 finalize 与异步行为也不同。源码对应[ngx_http_core_module.c](https://github.com/nginx/nginx/blob/release-1.28.0/src/http/ngx_http_core_module.c)。

## 2. Filter Chain {/* #filter-chain */}

响应 header/body 通过 filter chain，模块保存 next filter 并调用下一个。压缩、chunked、range、substitution 等会改变 Header/Body。第三方 filter 不正确调用链会丢数据或崩溃。

### 2.1 过滤链不是 content 之后的一组普通 Phase

内容生产者先设置响应头，再经 `ngx_http_send_header()` 进入 header filter；正文通过 `ngx_http_output_filter()` 等路径进入 body filter。Header/body 是两条相关但独立的链，发送可能因为客户端背压分多次继续。

假设原链为 Tail，A 安装时保存旧 top 并替换 top，之后 B 也这样安装，则调用关系为：

```text
初始：Tail
安装 A：A → Tail
安装 B：B → A → Tail
```

这是说明“保存旧入口，再接到头部”的机制，不是宣称某个真实构建必定只有 A/B 两个模块。实际还受模块构建/装载顺序与模块自身连接方式影响，不能通过交换两条业务配置就假定 gzip 与自定义 body filter 顺序倒转。

### 2.2 一个响应可能多次进入 body filter

body filter 处理的是缓冲链和流式片段，不保证一次回调就拿到完整响应。必须处理空数据的 flush/sync 等控制缓冲、部分发送和结束标志；主请求与子请求的结束语义也不相同。

若改变响应字节，要一起检查 Content-Length、Content-Encoding、分段边界和缓存语义。例如把正文变长却保留原长度，会破坏客户端解析。不能把一次 C 字符串拼接当成通用流式过滤器；缓冲、内存池与生命周期见[基础数据结构实现](./14-nginx源码解析-基础数据结构（一）.md)。

通常要按契约传给 next filter；只有确实接管、延后或替换了相应输出并正确维护状态时，才可以不在当前调用立即传递。不能把“必须调用 next”机械理解成任何分支都调用一次即可。

## 3. Subrequest {/* #subrequest */}

Auth、SSI、mirror 等可创建子请求，共享/继承部分主请求状态但有独立处理。子请求增加内部并发和 upstream，日志/Trace 要区分 main/subrequest。

子请求不是浏览器再次建立一条连接。它通过 `ngx_http_subrequest()` 等内部路径创建请求对象，关联 `r->main`/parent，复用部分连接与内存相关资源，但有自己的 URI、处理状态和完成回调。它需要访问远端服务时，才会产生相应上游连接或请求。

| 路径 | 是否创建新的子请求对象 | 主要用途 |
| --- | --- | --- |
| 普通 URI 内部跳转 | 通常重用当前请求并重新选择处理配置 | rewrite last、error_page 等路径 |
| Subrequest | 创建关联主请求的内部请求 | auth_request、SSI、mirror 等模块用途 |
| HTTP 301/302 等外部跳转 | 让客户端决定是否再次发请求 | 地址迁移等，不能视为内部零网络跳转 |

不是所有主请求阶段都对子请求原样执行；例如此 tag 的 core ACCESS checker 会跳过非主请求。应按具体模块看子请求从哪里进入、哪些配置适用，不能假设它天然执行一遍与主请求完全相同的认证链。

`auth_request` 用子请求的 2xx 放行，401/403 拒绝，其他状态属于认证子请求错误；不是只认 200，也不是把任意 3xx 当成成功。[认证子请求模块](https://nginx.org/en/docs/http/ngx_http_auth_request_module.html)还要求对应模块已构建。

若每个外部请求产生一次认证上游调用和一次业务上游调用，外部 1000 RPS 就可能对应约 2000 次上游调用/秒。fan-out、平均耗时、超时和并发数要一起算；mirror 不向客户端返回其正文，也不等于没有 CPU、内存或上游流量成本。

## 4. 变量 {/* #变量 */}

模块注册变量 getter，可能按需计算/缓存。Rewrite 中 set/map/capture 与 upstream 变量的可用阶段不同。

| 变量/用法 | 语义或计算时机 | 常见误判 |
| --- | --- | --- |
| `$request_uri` | 原始请求 URI，包含原始参数 | 当作 rewrite 后的路径 |
| `$uri` | 当前规范化 URI，内部处理可改变它 | 当作永不变化的原始请求串 |
| `$arg_x` / `$args` | 当前参数视角 | 假设所有跳转都保留完全相同参数 |
| `$upstream_*` | 依赖是否进入对应上游阶段和获得结果 | 在 rewrite 中提前 set 一次，就能自动保存未来结果 |
| map/复杂值 | 通常按使用时计算，缓存/volatile 与具体变量规则有关 | 所有变量都在请求开始时统一计算 |

例如在还未连接上游时，把 `$upstream_response_time` 赋给另一个变量，只能取得当时的结果，不能当成未来自动更新的引用。做日志应直接读取该阶段可用的变量；缓存与非缓存变量的选择要看注册标志和 getter，不应笼统宣称“一次计算后永远不变”。

正则捕获也需注意作用域和后续匹配覆盖；复杂配置优先用有名字、语义清晰的字段，避免把 `$1` 当成始终属于最初那次匹配的值。变量机制见[开发指南的变量章节](https://nginx.org/en/docs/dev/development_guide.html#http_variables)。

## 5. 调试 {/* #调试 */}

Debug 构建和 error_log debug 只在隔离环境；用 request ID、gdb、perf/eBPF 追 handler/系统调用。生产动态模块必须与二进制 ABI/签名匹配。

从已有证据开始：运行中二进制、配置来源、错误日志、请求 ID 与实际命中的 location。`nginx -t` 验证目标配置的语法与可加载性，不证明现有 worker 已加载它；reload 也需确认新 worker 成功启动，而非只看信号发出。

Debug 日志的阶段编号是构建后的 handler 数组索引，不是固定“第七阶段”等业务编号；模块集合改变就可能改变索引。gdb 断点和长时间 perf 等会影响进程，不能不加评估直接附着生产 worker。

| 要验证的假设 | 优先证据 |
| --- | --- |
| URI/location 发生过变化 | 原始 request_uri、当前 uri、rewrite/debug 轨迹 |
| 某个阶段提前结束 | 对应模块/状态码、是否出现上游尝试、finalize 路径 |
| 子请求造成放大 | 主/子请求区分、auth/mirror 上游计数、引用与完成时序 |
| filter 丢正文 | 原始长度/编码、各片段、结束标志、next 链调用 |
| 异步请求悬挂 | 等待事件/定时器、回调是否能重新进入、main count 与 request pool 生命周期 |

Debug 支持、日志继承和按客户端限制采集的方法见[Debugging log](https://nginx.org/en/docs/debugging_log.html)。日志可能包含敏感头或 URI，不能把完整认证材料直接带出故障环境。

## 6. 源码阅读方法 {/* #源码阅读方法 */}

### 6.1 用一个有内部跳转和子请求的轨迹串起源码

先确认测试二进制支持 `--with-http_auth_request_module`；要观察 debug 还需对应 debug 构建。以下是加入隔离实例 `http` 上下文的配置片段，不是替换生产主配置。预先准备 `/srv/phase-lab/v2/demo.txt`，内容为一行 `phase-lab`；确认端口、文件访问权限和日志目录适合该测试实例。

```nginx
log_format phase_lab escape=json
  '{"rid":"$request_id","original":"$request_uri",'
  '"uri":"$uri","status":$status,"rt":$request_time}';

server {
    listen 127.0.0.1:18080;
    server_name phase.local;
    access_log logs/phase-lab.log phase_lab;
    log_subrequest on;

    location /legacy/ {
        rewrite ^/legacy/(.*)$ /v2/$1 last;
    }

    location /v2/ {
        auth_request /_auth;
        root /srv/phase-lab;
        try_files $uri =404;
    }

    location = /_auth {
        internal;
        return 204;
    }
}
```

`/_auth` 的固定 204 仅是这个本地实验的确定性放行桩，不具备真实认证能力，不可移植为生产认证方案。

```bash
nginx -V 2>&1
nginx -t -c /srv/phase-lab/nginx.conf
curl --silent --show-error --include -H 'Host: phase.local' 'http://127.0.0.1:18080/legacy/demo.txt?x=1'
```

`-c` 需指向包含 events/http 等必要上下文的完整测试配置，路径不是前面片段已经自动生成的文件；配置验证通过后由测试环境受控加载。本例不依赖远端认证/业务服务。

在文件存在且认证桩可用的条件下，响应应为 200，正文是 `phase-lab` 加换行。主请求日志的教学值可为：

```json
{"rid":"8f3144d7303f4d179745f3ee4c191002","original":"/legacy/demo.txt?x=1","uri":"/v2/demo.txt","status":200,"rt":0.001}
```

rid 和时间由实际请求决定。启用 log_subrequest 后还可能出现子请求日志，不能按两行 access log 就断言客户端发了两次请求；日志记录的上下文还可能是最后处理请求的 location。

| 步骤 | 此例发生的事 | 查哪里 |
| --- | --- | --- |
| 初始选择 | 原始路径 /legacy/demo.txt，参数 x=1，命中 /legacy/ | FIND_CONFIG、location 配置 |
| URI rewrite | 变成 /v2/demo.txt，last 要求重新查找 location | rewrite 模块、POST_REWRITE checker |
| 重选配置 | 使用 /v2/ 的 loc_conf，不是继续在旧 location 做 content | `ngx_http_core_find_config_phase` |
| Access | auth_request 创建 /_auth 子请求，204 放行后继续 | auth_request 模块、子请求完成回调 |
| Precontent/Content | try_files 确认文件，static 模块读取对应文件 | try_files/static 模块 |
| 输出与收尾 | header/body filter 发送正文，随后记录日志 | output filter、finalize/log 路径 |

这里 rewrite 后没有新参数串，原 x=1 按 rewrite 规则保留；不能推广成所有内部跳转都不变。`last` 重新查 location，`break` 则在当前 rewrite 指令集停止后继续当前 location 的处理；选错会让 URI 已变但内容处理配置仍旧。rewrite/内部跳转有循环保护，不能把反复重选当成无限递归机制。

### 6.2 将配置轨迹落到函数，而不是只列目录

围绕同一个请求查看 `ngx_http_process_request` → `ngx_http_handler` → `ngx_http_core_run_phases`；再查看 find-config、rewrite checker、`ngx_http_subrequest` 与 `ngx_http_finalize_request`。过滤链入口不等于同一个 Phase handler，LOG 也不是普通数组尾部。

自定义模块若通过 NGX_AGAIN/NGX_DONE 让出处理，需明确谁负责后续驱动或完成；已经接管/完成的路径也要保证引用与收尾匹配。请求已 finalize 后访问 request pool、重复 finalize 或遗失引用，可能表现为崩溃、泄漏或永远不完成。用请求状态、回调与日志相互验证，不只凭某个返回码推断安全。

## 7. 验收题 {/* #验收题 */}

### 7.1 Phase 顺序为什么不同于配置顺序？

答案：配置解析生成模块配置与注册处理器，运行时由阶段引擎按阶段和 checker 推进。模块内部的 rewrite 指令可按文本顺序执行，但不能据此跨模块重排 access/content，也不能只交换配置行改变 filter 链。

### 7.2 Filter 为什么要维护 next 链？

答案：输出需要继续经过后续编码、发送等处理。模块通常传递到 next，或正确接管/延后并维护状态；漏传会丢输出，机械重复调用也可能重复发送。Header/body 链独立，分块和结束标志都必须正确。

### 7.3 Subrequest 如何放大请求？

答案：它创建内部请求与相应处理开销；若认证和业务各访问一次远端，外部 1000 RPS 可能产生约 2000 次上游调用/秒。内部请求不等于客户端新建连接，不返回镜像正文也不等于没有成本。

### 7.4 变量什么时候可能尚未有值？

答案：上游响应等结果在 rewrite 阶段尚未产生；提前赋值只得到当时状态，不能引用未来结果。原始 request_uri、当前 uri、按需变量和缓存变量也不是同一种生命周期。

### 7.5 generic checker 收到 NGX_OK，会直接返回 HTTP 200 吗？

答案：不会。它把阶段索引跳到 next，再让引擎继续；NGX_DECLINED 则尝试下一 handler。不同阶段有不同 checker，不能把 generic 表当成所有模块的统一 HTTP 返回协议。

### 7.6 LOG 是普通 Phase Engine 数组的最后一步吗？

答案：不是。它存在于阶段枚举，但普通数组构建到 LOG 之前，日志由请求收尾路径调用。因此 early finalize 的请求也可能记录日志，不能用没有进入 content 推断没有日志。

### 7.7 rewrite last 和 break 为什么会影响最终 location？

答案：last 在 URI 修改后重走 location 选择，可能换 loc_conf；break 停止当前 rewrite 指令集后继续当前 location。此例需要进入 /v2/ 的处理配置，因此使用 last，不能只看最终 URI 一样就认为两者等价。

### 7.8 返回 NGX_DONE 就能保证异步请求会完成吗？

答案：不能。必须已有合法的异步等待/回调和引用生命周期管理。没有人重新驱动或完成请求就可能悬挂；回调访问已释放 request pool 或重复 finalize 也会出错。

### 7.9 nginx -t 通过，能证明当前 worker 已加载配置吗？

答案：不能。它验证目标文件的配置与加载条件，不证明运行中 worker 的版本。需确认受控加载/新 worker 启动，并通过真实请求、日志和对应二进制证据验证行为。

## 8. 参考资料 {/* #参考资料 */}

- [Development guide](https://nginx.org/en/docs/dev/development_guide.html)
- [Nginx source](https://github.com/nginx/nginx)
- [1.28.0 阶段数组与配置构建](https://github.com/nginx/nginx/blob/release-1.28.0/src/http/ngx_http.c)
- [1.28.0 核心 checker 与内部请求处理](https://github.com/nginx/nginx/blob/release-1.28.0/src/http/ngx_http_core_module.c)
- [1.28.0 请求收尾与日志](https://github.com/nginx/nginx/blob/release-1.28.0/src/http/ngx_http_request.c)
- [Rewrite](https://nginx.org/en/docs/http/ngx_http_rewrite_module.html)
- [Auth request](https://nginx.org/en/docs/http/ngx_http_auth_request_module.html)
- [Log module](https://nginx.org/en/docs/http/ngx_http_log_module.html)
- [Debugging log](https://nginx.org/en/docs/debugging_log.html)
