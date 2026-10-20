---
title: "logging、上下文与诊断证据"
sidebar_label: "05. logging、上下文与诊断证据"
sidebar_position: 5
description: "理解 Logger、Handler、Formatter 和传播，建立可关联、可脱敏、可控成本的日志。"
tags: [Python, 标准库, IO]
---

# logging、上下文与诊断证据

日志是程序运行时留下的证据，不是所有对象的完整转储。有效日志需要回答：什么操作、哪个请求、处于哪一步、用了多久、如何失败，而不是只打印“出错了”。

## 1. 日志处理链

应用向 Logger 提交记录，记录经过级别与过滤条件，交给 Handler，再由 Formatter 形成输出。父级传播可能让同一条记录经过多个 Handler，因此“日志重复”经常是配置问题，而不是函数执行了两次。

库通常只取得 `logging.getLogger(__name__)`，由应用入口统一配置输出；不要每次调用函数都添加 Handler。

## 2. 可重复的示例

```python title="io_logging.py"
import io
import logging

def main():
    output = io.StringIO()
    handler = logging.StreamHandler(output)
    handler.setFormatter(logging.Formatter(
        "%(levelname)s %(name)s request=%(request_id)s %(message)s"))
    logger = logging.getLogger("lesson.worker")
    logger.handlers.clear()
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False
    try:
        logger.info("job=%s state=%s", "import", "ready",
                    extra={"request_id": "r-1"})
        print(output.getvalue().strip())
    finally:
        logger.removeHandler(handler)
        handler.close()

if __name__ == "__main__":
    main()
```

```text title="io_logging.out"
INFO lesson.worker request=r-1 job=import state=ready
```

`%s` 参数形式允许日志系统在需要格式化时处理消息；但传参前执行昂贵函数仍有成本。`extra` 字段需要保证格式器每次都能取得，缺字段可能造成格式化错误。

## 3. 上下文与异常

请求 ID 可以通过 LoggerAdapter、Filter 或 contextvars 注入；跨线程、进程与消息边界要显式考虑传播。不要用单一全局变量保存“当前请求”，并发请求会互相覆盖。

`logger.exception` 在异常处理上下文中附带堆栈；应在有责任决定处理方式的边界记录，避免每一层重复打印同一条异常。区分预期的业务拒绝与内部故障，避免用相同 ERROR 级别淹没真正问题。

## 4. 结构化与成本

JSON 日志便于查询，但字段应该稳定、尺寸有上限、敏感值有明确脱敏。URL 查询参数、Authorization、请求体和模型输入可能包含秘密，不应默认完整输出。

慢磁盘或远程日志端可能阻塞业务线程。QueueHandler/QueueListener 能移动部分工作，但队列仍需容量与满时策略；无界日志队列只是把 I/O 堵塞变成内存问题。

轮转、采集、保留与访问权限属于完整链路。容器里常输出到 stdout/stderr 再统一采集，不能同时多套轮转互相覆盖。

## 5. 练习与答案

### 5.1 同一条日志出现两次，就说明请求处理两次吗？

答案：不一定。检查是否重复安装 Handler，以及记录是否传播到父 Logger。先关联请求 ID 与调用证据。

### 5.2 日志改成队列后，就没有资源风险了吗？

答案：仍有。队列容量、丢弃/阻塞策略、退出排空和消费者速度都需要设计。

### 5.3 异常里带数据库 URL，能直接 exception 吗？

答案：要检查异常是否包含凭证，必要时转换或脱敏。堆栈有诊断价值，但不能因此泄露 Secret。

## 6. 参考资料

- [logging](https://docs.python.org/3.14/library/logging.html)
- [日志配置与实践](https://docs.python.org/3.14/howto/logging-cookbook.html)
