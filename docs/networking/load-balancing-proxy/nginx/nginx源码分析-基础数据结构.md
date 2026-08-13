---
title: Nginx 源码阅读导论：Core 模块与基础数据结构
date: 2025-11-10 15:00:00
categories: NGINX
tags: [Nginx, 源码解析, C语言, 事件驱动, 技术学习]
---

# Nginx 源码阅读导论：Core 模块与基础数据结构

Nginx 源码不适合从 `main()` 第一行一路读到结尾。它由配置生命周期、Master/Worker 进程模型、
事件循环、模块系统、连接/请求对象和一组生命周期明确的数据结构共同组成。

本文先建立源码地图和阅读方法，再解释 Core 模块最常见的数据结构如何协作。内存池函数的逐行
实现见[深入篇：基础数据结构（一）](./nginx源码解析-基础数据结构（一）.md)，两篇文章不重复展开
同一段代码。

## 1. 学习目标

完成本文后，应能够：

- 从目录定位 Core、Event、HTTP、Stream 和操作系统适配代码；
- 解释 Master、Worker、Cycle、Connection、Request 的生命周期；
- 根据访问模式选择 Array、List、Queue、Rbtree 或 Hash；
- 解释 Pool、Buffer、Chain 为什么是 Nginx 高并发设计的基础；
- 使用 `rg`、Debug Log、GDB 沿一条请求追踪源码；
- 判断一个指针应该绑定 Request、Connection 还是 Cycle 生命周期。

## 2. 先看整体架构

![Nginx架构图](/images/nginx源码解析/Nginx架构图.png)

```text
Master Process
├── 读取配置、创建 Cycle
├── 打开监听端口和日志
├── Fork Worker
├── 平滑重载：新旧 Cycle/Worker 短暂并存
└── 管理 Cache Loader / Cache Manager

Worker Process
├── Event Loop（epoll/kqueue 等）
├── Connection
├── HTTP/Stream Request
├── Module Handler / Filter Chain
└── Timer、Posted Event、Upstream
```

关键不是“异步”三个字，而是：一个 Worker 用事件循环管理大量非阻塞连接，请求处理被拆成多个
回调阶段，暂时不能继续时把控制权交还事件循环。

## 3. 源码目录地图

![Nginx模块图](/images/nginx源码解析/Nginx模块图.png)

| 目录 | 主要内容 | 建议入口 |
|---|---|---|
| `src/core` | 字符串、Pool、容器、配置、Cycle、日志 | `ngx_cycle.c`、`ngx_palloc.c` |
| `src/event` | Event Core、Timer、Connection、事件模型 | `ngx_event.c`、`ngx_event_timer.c` |
| `src/event/modules` | epoll、kqueue、select 等实现 | Linux 重点看 `ngx_epoll_module.c` |
| `src/http` | HTTP 请求状态机、阶段、过滤链、Upstream | `ngx_http_request.c` |
| `src/http/modules` | Proxy、Rewrite、Gzip、Access 等模块 | 按配置指令反查模块 |
| `src/stream` | TCP/UDP 四层代理 | `ngx_stream.c` |
| `src/os/unix` | Socket、进程、信号、系统调用封装 | `ngx_process_cycle.c` |
| `auto` | Configure 与构建探测 | 遇到平台宏时再读 |

不要先读所有文件。先选择一条问题链，例如“配置如何生成 Location”或“请求怎样进入 Proxy
Upstream”，再沿结构体字段、函数调用和模块回调向两侧扩展。

## 4. 五个核心生命周期

### 4.1 Cycle

`ngx_cycle_t` 表示一次完整配置周期，持有监听对象、日志、模块配置、共享内存、打开文件等。
平滑重载时会创建新 Cycle，旧 Worker 继续使用旧 Cycle 处理存量连接。

### 4.2 Worker

Worker 初始化事件模块，进入事件循环。它通常不为每条连接创建线程，而是从事件队列取出就绪事件
并调用 Handler。

### 4.3 Connection

`ngx_connection_t` 把文件描述符、读写事件、Socket 地址、日志和连接级内存池组织在一起。连接关闭
时，连接级资源才应释放。

### 4.4 HTTP Request

`ngx_http_request_t` 保存方法、URI、请求头、响应头、阶段处理器、Upstream、Body、引用计数等。
一个 Keepalive Connection 可以顺序承载多个 Request，子请求还会形成额外 Request 对象。

### 4.5 Configuration

模块通过 `create_*_conf` 创建配置对象，通过指令 Setter 写入值，再在 `merge_*_conf` 中继承父级
配置。运行期不应反复解析文本配置。

```text
解析 nginx.conf
→ 创建 Main/Server/Location Conf
→ 合并默认值和继承关系
→ 新 Cycle 生效
→ Worker 运行期直接读取结构化配置
```

## 5. Pool：用生命周期管理内存

Nginx 的多数小对象从 `ngx_pool_t` 分配。Pool 内部维护连续内存块；当前块放不下时增加新块，
大对象则走系统分配器并登记到 `large` 链表。

常用接口：

```c
ngx_create_pool(size, log);
ngx_palloc(pool, size);       /* 对齐 */
ngx_pnalloc(pool, size);      /* 不强制对齐 */
ngx_pcalloc(pool, size);      /* 分配并清零 */
ngx_pool_cleanup_add(pool, size);
ngx_destroy_pool(pool);
```

### 5.1 为什么快

- 小对象通常只移动 `last` 指针；
- 同一生命周期的对象统一销毁；
- 减少频繁 `malloc/free` 和错误释放；
- Cleanup Handler 可以关闭 FD 或释放外部资源。

### 5.2 Pool 不是什么

- 不是通用垃圾回收器；
- 不能自动识别悬挂指针；
- `ngx_pfree()` 通常只能释放单独登记的 Large Allocation；
- Pool 生命周期选错仍会造成泄漏或 Use-After-Free。

最重要的设计问题：对象要活到什么时候？

```text
只服务一个请求       → Request Pool
跨多个请求但不跨连接 → Connection Pool
跟随一轮配置         → Cycle/Config Pool
跨 Worker 共享       → Shared Memory + Slab + Lock
```

## 6. 基础容器怎样选择

### 6.1 `ngx_array_t`：连续动态数组

适合已知元素大小、经常遍历、追加数量可估算的场景。

```c
ngx_array_t *a = ngx_array_create(pool, 8, sizeof(ngx_str_t));
ngx_str_t *s = ngx_array_push(a);
```

空间不足时可能重新分配并复制元素，因此不能假设扩容前取得的元素指针永久有效。

### 6.2 `ngx_list_t`：由多个小数组组成的 List

它不是普通逐节点链表，而是多个 `ngx_list_part_t` 块串联。常用于请求头/响应头：追加方便，又避免
整个数组不断搬迁。

特点：适合追加和遍历，不支持通用的中间删除；HTTP Header 可通过把 `hash` 设为 0 标记无效。

### 6.3 `ngx_queue_t`：侵入式双向链表

Queue Node 嵌入业务结构体，不额外保存 `void *data`：

```c
typedef struct {
    ngx_str_t    value;
    ngx_queue_t  link;
} my_item_t;
```

通过 `ngx_queue_data(q, my_item_t, link)` 从链表节点恢复业务对象。优点是插入删除 O(1)、分配少；
风险是同一个 Link 字段不能同时加入两条 Queue，删除后也要维护好生命周期。

### 6.4 `ngx_rbtree_t`：有序动态集合

红黑树适合频繁插入、删除，同时需要按 Key 找最小值或有序查找的场景。Nginx Event Timer 就使用
红黑树，最小 Key 对应最近要过期的 Timer。

多个对象可能有相同 Key，业务通常需要在自定义 `insert_value`/lookup 中比较次级字段。

### 6.5 `ngx_hash_t`：配置期构建、运行期高频查询

Hash 常用于 Header、Variable、Server Name 等查找。它通常在配置期收集 Key，计算 Bucket 后一次
构建，运行时只读查找。

```text
配置期多做计算
→ Bucket 尽量贴合 Cache Line
→ 运行期少分支、少内存访问
```

`*_hash_max_size` 和 `*_hash_bucket_size` 不是越大越好，应根据 Key 数量、长度和 CPU Cache Line
调整。

## 7. Buffer 与 Chain：I/O 数据的统一表达

`ngx_buf_t` 可以描述内存数据、文件区间或特殊控制标记；`ngx_chain_t` 把多个 Buffer 串成输出链。

```text
ngx_buf_t
├── start/end：可用内存边界
├── pos/last：当前有效内存数据
├── file_pos/file_last：文件区间
└── flush/last_buf/in_file/temporary 等标志

ngx_chain_t
├── buf
└── next
```

过滤模块接收 Chain，可能修改、追加、延迟或传给下一个 Filter。理解以下区别非常关键：

- Buffer 结构体与它引用的数据不是同一块对象；
- `pos == last` 表示内存数据已消费，不代表结构体可以随意释放；
- Shadow Buffer 可能共享底层数据；
- `last_buf`、`flush` 等标志会影响响应结束与刷新语义。

## 8. Event、Connection 和 Request 怎样串起来

简化的请求入口：

```text
ngx_worker_process_cycle
→ ngx_process_events_and_timers
→ epoll_wait
→ Accept Event
→ ngx_get_connection
→ ngx_http_init_connection
→ Read Event
→ 解析请求行/请求头
→ HTTP Phase Engine
→ Content Handler / Upstream
→ Output Filter Chain
→ Write Event
```

实际函数会随协议、模块和版本产生分支，不要把这张图当固定调用栈。它用于建立调查方向：

```text
事件为什么就绪
→ Connection 的 read/write Handler 是谁
→ Request 当前处于哪个 Phase
→ 哪个模块接管 Content
→ 哪个 Filter 改写了 Chain
```

## 9. 从配置指令反查模块

假设要理解 `proxy_pass`：

```bash
rg -n 'proxy_pass' src/http/modules
rg -n 'ngx_command_t.*commands|ngx_http_proxy_commands' src/http/modules/ngx_http_proxy_module.c
rg -n 'ngx_http_proxy_handler' src/http/modules/ngx_http_proxy_module.c
```

阅读顺序：

1. `ngx_command_t`：指令允许出现的位置与 Setter；
2. `create_loc_conf`：配置对象初始状态；
3. `merge_loc_conf`：继承和默认值；
4. 指令 Setter：把文本参数写到哪里；
5. Handler：运行期怎样读取配置；
6. Upstream/Filter：请求和响应怎样继续流动。

这种方法比从模块文件第一行顺序阅读更高效。

## 10. 建立可调试的源码环境

### 10.1 获取并固定版本

```bash
git clone https://github.com/nginx/nginx.git
cd nginx
git tag --list | tail
git checkout <固定版本标签>
```

学习和复现必须记录 Commit/Tag，不要用不断变化的默认分支得出固定结论。

### 10.2 Debug 构建

```bash
./auto/configure \
  --prefix=/tmp/nginx-lab \
  --with-debug \
  --with-http_ssl_module
make -j"$(nproc)"
make install
```

实验配置建议：

```nginx
daemon off;
master_process off;
error_log stderr debug;

events {
    worker_connections 128;
}

http {
    server {
        listen 8080;
        location / {
            return 200 "hello\n";
        }
    }
}
```

单进程模式便于学习和 GDB，不代表生产部署方式。

### 10.3 静态搜索与动态验证

```bash
rg -n 'ngx_create_pool|ngx_destroy_pool' src
rg -n 'ngx_http_process_request_line' src/http
rg -n 'ngx_event_timer_rbtree' src/event

gdb --args /tmp/nginx-lab/sbin/nginx -c /tmp/nginx-lab/conf/nginx.conf
```

推荐断点：

```gdb
break ngx_init_cycle
break ngx_http_create_request
break ngx_http_finalize_request
break ngx_destroy_pool
run
```

每次断点回答三个问题：当前对象是谁创建的、Pool 是哪个、下一个 Handler 存在哪里。

## 11. 三个渐进实验

### 实验一：观察 Request Pool

1. 在 `ngx_http_create_request` 和 `ngx_destroy_pool` 设断点；
2. 发起一个短连接请求；
3. 记录 Request、Connection 和 Pool 地址；
4. 改成 HTTP Keepalive 连续请求；
5. 比较 Connection 是否复用、Request Pool 是否重新创建。

### 实验二：观察 Timer Rbtree

1. 找到 `ngx_add_timer` 宏和 `ngx_event_add_timer`；
2. 设置很短和很长的 Proxy Timeout；
3. 记录 Timer Key；
4. 观察最近 Timer 怎样影响 `epoll_wait` Timeout；
5. 验证取消事件时 Timer Node 是否删除。

### 实验三：追踪一条 Proxy 请求

```text
读取请求
→ Phase Engine
→ ngx_http_proxy_handler
→ 创建 Upstream
→ 连接后端
→ 读取响应
→ Header/Body Filter
→ Client Write Event
```

同时保存 Debug Log、GDB Backtrace 和关键结构字段，不要只画一张没有证据的调用图。

## 12. 常见误区与排查

### 12.1 “Pool 会自动释放所有资源”

Pool 只自动释放它管理的内存。文件描述符、锁、第三方库对象需要 Cleanup Handler 或显式释放。

### 12.2 “Nginx 完全没有阻塞”

Worker 设计目标是避免阻塞事件循环，但 DNS、磁盘、第三方模块、同步库或错误代码仍可能阻塞。
排查 Worker 卡顿时使用 `strace -p`、`perf top`、Off-CPU 分析和线程/系统调用栈。

### 12.3 “结构体字段看懂就等于理解生命周期”

真正危险的是对象之间的引用。重点检查：谁拥有对象、谁延长引用计数、异步回调返回时对象是否仍然存在。

### 12.4 平滑重载后内存暂时翻倍

新旧 Worker/Cycle 会短暂并存，长连接可能让旧 Worker 很久不退出。检查进程启动时间、连接、
`worker_shutdown_timeout` 和旧配置引用，不要直接把所有额外 RSS 判为泄漏。

## 13. 从零到精通的阅读路线

```text
第一阶段：目录 + 进程模型 + Cycle
→ 第二阶段：Pool + Array/List/Queue/Rbtree/Hash
→ 第三阶段：Event + Connection + Timer
→ 第四阶段：HTTP Request + Phase + Filter
→ 第五阶段：Upstream + Proxy + Buffer/Chain
→ 第六阶段：平滑重载、共享内存、自定义模块与性能分析
```

每个阶段至少交付：源码位置、结构体关系图、一次动态实验、一个故障案例和自己的结论。

## 14. 掌握标准

- [ ] 能从配置指令定位到 `ngx_command_t`、配置对象和运行期 Handler；
- [ ] 能解释 Request/Connection/Cycle Pool 的生命周期差异；
- [ ] 能根据访问模式选择 Array、List、Queue、Rbtree、Hash；
- [ ] 能解释 Buffer/Chain 在输出过滤链中的作用；
- [ ] 能从 Event 找到 Connection，再找到当前 Request Handler；
- [ ] 能用 Debug Log、`rg` 和 GDB 验证调用链；
- [ ] 能分析平滑重载、Worker 阻塞和生命周期错误。

## 参考资料

- [Nginx 官方 Development Guide](https://nginx.org/en/docs/dev/development_guide.html)
- [Nginx 官方 Hash 配置说明](https://nginx.org/en/docs/hash.html)
- [Nginx 官方源码镜像](https://github.com/nginx/nginx)
- [深入篇：内存池与基础数据结构实现](./nginx源码解析-基础数据结构（一）.md)

