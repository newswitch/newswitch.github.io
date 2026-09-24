---
title: "SPDK 应用开发、异步状态机与源码阅读"
sidebar_label: "10. 应用开发与源码阅读"
sidebar_position: 10
description: "从 spdk_app、Subsystem、Thread、Poller、bdev Callback 和 JSON-RPC 理解最小应用及源码调用链。"
tags: [SPDK, C, 异步编程, bdev, 源码分析]
---

# SPDK 应用开发、异步状态机与源码阅读

SPDK 应用的难点不在调用某个 Read API，而在于所有权、线程亲和、异步 Completion、资源不足重试和退出状态机。同步思维直接移植到 Reactor 中，通常会造成阻塞或死锁。

## 1. 最小应用生命周期

```text
spdk_app_opts_init
→ 填充 Name / Reactor Mask / RPC Address / Config
→ spdk_app_start(opts, start_fn, ctx)
→ Framework 初始化各 Subsystem
→ 在 SPDK Thread 调用 start_fn
→ 注册 Poller / 打开 bdev / 提交异步 I/O
→ Completion 推进状态机
→ spdk_app_stop(rc)
→ Subsystem 逆序 fini
→ spdk_app_fini
```

示意：

```c
static void start_fn(void *ctx)
{
    /* 当前已位于 SPDK thread：打开 bdev，取得 I/O channel，启动异步状态机。 */
}

int main(int argc, char **argv)
{
    struct spdk_app_opts opts;
    spdk_app_opts_init(&opts, sizeof(opts));
    opts.name = "io_path_demo";

    int rc = spdk_app_start(&opts, start_fn, NULL);
    spdk_app_fini();
    return rc;
}
```

实际代码需要参数解析、资源清理和错误传播，不能在 `start_fn` 返回后假设应用退出；Event Loop 会继续运行，直到调用 `spdk_app_stop()`。

## 2. 用状态机写异步逻辑

错误方式：

```text
提交 read
→ while (!done) 忙等
→ 提交 write
```

这会阻塞负责产生 `done` 的同一个 Reactor。

正确方式：

```text
STATE_READ
→ submit read(callback=read_done)

read_done
→ 校验状态
→ STATE_TRANSFORM
→ submit write(callback=write_done)

write_done
→ 更新统计
→ 下一请求或退出
```

每个 Callback 只推进有限工作，把长计算交给其他执行资源。

## 3. bdev 编程顺序

```text
spdk_bdev_open_ext(name, write, event_cb, ...)
→ spdk_bdev_desc_get_bdev
→ spdk_bdev_get_io_channel(desc)
→ spdk_bdev_read/write(desc, ch, buffer, offset, length, cb, arg)
→ Completion Callback
→ spdk_put_io_channel
→ spdk_bdev_close
```

注意：

- Offset/Length 通常需要满足 Block Size 和 Buffer Alignment；
- Descriptor 和 Channel 生命周期必须覆盖所有在途 I/O；
- Event Callback 处理 Remove/Resize 等事件；
- Completion 中调用 `spdk_bdev_free_io()` 释放 I/O Object；
- 返回 `-ENOMEM` 时使用 `spdk_bdev_queue_io_wait()`。

## 4. Buffer 所有权

Buffer 在 I/O Completion 前必须保持有效，不能提前释放或被另一个请求覆盖。

```text
Application owns buffer
→ submit I/O：设备/模块异步使用
→ completion：所有权回到 Application
→ reuse/free
```

使用 `spdk_bdev_read()` 等接口时还要满足 DMA、对齐和模块要求；可使用 SPDK DMA 分配器或 I/O Buffer Framework 管理。

## 5. Thread Affinity

Descriptor 可以描述共享设备，但 I/O Channel 属于获取它的 SPDK Thread。若控制线程需要让 Worker 执行 I/O：

```text
Control Thread
→ spdk_thread_send_msg(worker, submit_fn, request)
→ Worker 使用自己的 Channel 提交
→ Completion 在 Worker 推进
→ 必要时 send_msg 回 Control Thread
```

不要跨线程直接调用另一个 Thread 的 Channel，也不要在 Callback 中用锁等待原线程。

## 6. 自定义 bdev 模块要实现什么

一个模块通常需要：

- 枚举/创建/删除 bdev；
- 提供 Module Context；
- 为每个 Thread 创建 I/O Channel Context；
- 实现 `submit_request`；
- 报告支持的 I/O Type、Alignment 和 Block Geometry；
- 正确完成、失败和释放 `spdk_bdev_io`；
- 支持 Reset/Remove/Examine 等生命周期；
- 注册 JSON-RPC 与 Config Dump（若需要）。

最重要的是错误传播和退出顺序，而不是只让 Read/Write Happy Path 工作。

## 7. 源码目录

| 目录 | 关注点 |
|------|--------|
| `lib/event/` | Application、Reactor 与 Subsystem 初始化 |
| `lib/thread/` | spdk_thread、Poller、Message、I/O Device/Channel |
| `lib/bdev/` | bdev Core、I/O Object、QoS、Wait Queue |
| `module/bdev/` | NVMe、AIO、Malloc、RAID、Crypto 等模块 |
| `lib/nvme/` | NVMe Controller、QPair、Request 与 Transport |
| `lib/nvmf/` | Target、Subsystem、Poll Group、Request |
| `lib/blob/` | Blobstore 与 Lvol 底层 |
| `lib/vhost/` | vhost-user 与 Virtqueue 处理 |
| `app/` | nvmf_tgt、vhost、iscsi_tgt 等应用入口 |
| `examples/` | bdev、NVMe、Thread 和 Event 示例 |
| `scripts/rpc.py` / `python/spdk/rpc` | RPC CLI 与 Python 调用 |

## 8. 从 RPC 追到数据面

以创建 NVMe bdev 为例：

```text
rpc.py
→ JSON-RPC method bdev_nvme_attach_controller
→ module/bdev/nvme 的 RPC Handler
→ 创建/Probe NVMe Controller
→ lib/nvme 初始化 Admin Queue 与 Namespace
→ 注册一个或多个 bdev
→ bdev_get_bdevs 可见
→ 上层通过 I/O Channel 获得 NVMe QPair
```

源码阅读不要从整个仓库顺序开始。先选择一个 RPC 或 API，画出对象和线程，再沿注册表、函数指针和 Callback 追踪。

## 9. Debug 与 Trace

- Debug Build 提供更多 Assert 和日志，但性能不同；
- `--logflag` 按模块开启日志，避免全量刷屏；
- SPDK Trace 记录事件和对象关系，需控制 Buffer 与性能开销；
- Address/Undefined Sanitizer 适合测试环境；
- GDB 断点要理解 Reactor 被暂停会影响所有同 Core I/O；
- Core Dump 必须配合相同二进制、符号和 Submodule 版本。

## 10. 代码评审检查表

- [ ] Callback 是否始终在预期 Thread；
- [ ] I/O 完成前 Buffer/Context 是否有效；
- [ ] 每条错误路径是否完成 Callback 或释放请求；
- [ ] `-ENOMEM` 是否进入 Wait Queue 而非忙重试；
- [ ] Remove/Reset/Shutdown 是否处理在途 I/O；
- [ ] Channel 是否在所属 Thread 释放；
- [ ] Poller 是否会阻塞、无限 Busy 或泄漏；
- [ ] RPC 是否区分启动期/运行期并可输出配置；
- [ ] 统计是否避免跨核共享写；
- [ ] 升级是否检查 API、ABI 和废弃项。

## 11. 课后练习与答案

**问题 1：为什么不能提交 I/O 后在同一个 Reactor 上 Busy Wait？**

Completion 也需要该 Reactor 轮询才能发生；Busy Wait 会阻塞完成处理，形成自我死锁或超时。

**问题 2：bdev 返回 `-ENOMEM` 是否应立即失败请求？**

通常不应。它可能是暂时缺少 I/O Object/Buffer，应注册 I/O Wait 并在资源可用后重试。

**问题 3：为什么从 RPC 入口读源码比从仓库第一行开始更有效？**

RPC 提供明确的对象创建目标，可以沿 Handler、模块、线程和底层 Driver 建立完整调用链。

## 12. 参考资料

- [SPDK Event Framework](https://spdk.io/doc/event.html)
- [SPDK bdev Programming Guide](https://spdk.io/doc/bdev_pg.html)
- [SPDK Source](https://github.com/spdk/spdk)
- [SPDK Coding Style](https://spdk.io/doc/coding_style.html)
