---
title: sleep 命令详解：延迟、信号中断、轮询与指数退避
sidebar_position: 19
description: 完整讲解 GNU coreutils sleep 参数、多段时长、浮点与 locale、信号、单调时钟边界，以及轮询、重试、退避和抖动的正确设计。
tags: [Linux, sleep, retry, backoff, coreutils]
---

# `sleep` 命令详解：延迟、信号中断、轮询与指数退避

`sleep` 让当前进程延迟指定时长。它是计时原语，不是就绪检测、锁、超时、调度器或重试策略；固定 sleep 往往让快速路径变慢、慢速路径仍失败。

## 1. 语法与 GNU 9.11 完整参数

```text
sleep NUMBER[SUFFIX]...
sleep OPTION
```

| 参数/操作数 | 作用 |
|---|---|
| `NUMBER` | 整数或浮点时长 |
| `s` | 秒，省略 suffix 时默认 |
| `m` | 分钟 |
| `h` | 小时 |
| `d` | 天 |
| 多个时长 | GNU 扩展：相加后等待，如 `sleep 1m 30s` |
| `--help` | 显示帮助 |
| `--version` | 显示版本 |

浮点解析受实现与 locale 影响；跨系统脚本使用简单整数秒最稳，复杂 deadline 使用语言时间 API。

## 2. 信号与计时

```bash
sleep 300 & pid=$!
kill -TERM "$pid"
wait "$pid"; printf 'rc=%d\n' "$?"
```

外部 sleep 被未捕获信号终止，Shell 常观察到 `128+signal`。底层实现通常以相对/单调计时避免墙钟跳变，但命令规范不应被当成高精度实时定时器；调度延迟会让实际等待不少于请求且可能更长。

## 3. 轮询条件而非猜时间

错误：

```bash
start_service
sleep 10
send_request
```

更可靠：带总 deadline、可观测条件和间隔：

```bash
deadline=$((SECONDS + 60))
until health_check; do
  (( SECONDS >= deadline )) && { printf '%s\n' 'not ready' >&2; exit 1; }
  sleep 1
done
```

仍需让 `health_check` 有自己的短 timeout，并区分不可重试错误。

## 4. 指数退避与 jitter

大规模客户端固定同频 sleep 会形成惊群。重试应具备：最大次数/总 deadline；只重试幂等且瞬时错误；指数退避上限；随机 jitter；尊重服务端 Retry-After；指标与取消信号。

```text
delay = random(0, min(cap, base * 2^attempt))
```

Shell 不适合复杂随机/高精度并发退避；生产客户端在语言库中实现并测试。

## 5. 退出状态、实验与掌握标准

合法时长完成返回 `0`；格式/范围/选项错误返回非零；信号终止按 Shell 规则体现。极大时长、2038/平台限制和浮点舍入依实现。

实验：整数/浮点/多参数/单位、非法/负数/极大值、信号中断、墙钟修改；实现一个带 deadline 和 jitter 的有限轮询，与固定 sleep 比较。

掌握标准：能列出全部参数与后缀；能解释 sleep 只提供延迟；能设计有条件、总期限、可取消、可观测且防惊群的重试。

## 官方参考

- [GNU coreutils 9.11：sleep(1)](https://man7.org/linux/man-pages/man1/sleep.1.html)
- [Linux time(7)](https://man7.org/linux/man-pages/man7/time.7.html)

上一篇：[`timeout` 命令详解](./18-timeout命令详解.md)

下一模块：[CPU、内存、负载与 procfs 命令导读](../05-cpu-memory-load-proc/00-CPU内存负载与procfs命令导读.md)
