---
title: "pathlib、文件、临时目录与原子替换"
sidebar_label: "01. pathlib、文件、临时目录与原子替换"
sidebar_position: 1
description: "区分路径、编码、缓冲、原子可见与崩溃持久化，安全管理临时文件与替换操作。"
tags: [Python, 标准库, IO]
---

# pathlib、文件、临时目录与原子替换

文件操作涉及路径解析、权限、文本编码、内核缓存与底层存储。`write` 返回成功，只说明该层调用完成，不能直接推导断电后数据一定存在。

## 1. 路径对象与真实文件

`Path` 表达本机路径，`PurePath` 只做路径计算。`Path("config.toml")` 通常相对于当前工作目录，而不是源文件目录。`resolve` 可以解析路径与符号链接，但“检查后再打开”仍可能存在竞态，不能当成完整的安全边界。

拼接不可信文件名时，应拒绝绝对路径、越界部分与不允许的后缀，并核对实际目标。高风险目录还要结合权限、文件描述符级 API 和符号链接策略；不要把字符串前缀比较当成目录归属证明。

## 2. 同目录临时文件再替换

```python title="io_files.py"
from pathlib import Path
from tempfile import TemporaryDirectory
import os

def main():
    with TemporaryDirectory() as folder:
        target = Path(folder) / "state.txt"
        temporary = target.with_suffix(".tmp")
        with temporary.open("w", encoding="utf-8", newline="\n") as stream:
            stream.write("ready\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
        print(target.read_text(encoding="utf-8").strip())
        print(temporary.exists(), target.exists())

if __name__ == "__main__":
    main()
```

```text title="io_files.out"
ready
False True
```

示例只在自己创建的临时目录操作。临时文件与目标放在同一文件系统，避免跨文件系统替换失败；真实应用还要保证临时名不冲突、失败时清理，并考虑原文件权限与所有者是否需要保留。

## 3. 四层完成状态

| 动作 | 主要推进到哪里 | 不能直接证明什么 |
| --- | --- | --- |
| `write` | Python/OS 的相应缓冲路径 | 磁盘已持久化 |
| `flush` | 将 Python 缓冲交给下层 | 断电不丢 |
| `fsync` | 请求同步相应文件状态 | 所有硬件与文件系统都具有同样保证 |
| `replace` | 改变目录中的可见名称 | 目录元数据已完成崩溃持久化 |

在支持相关语义的 POSIX 文件系统，替换后的目录项持久化通常还需同步父目录。Windows、网络文件系统和不同存储栈有各自限制，不能把“原子替换”直接宣传为通用事务。

## 4. 读写边界

文本明确 `encoding`，二进制使用 `rb/wb`；大文件按块或逐行处理，限制单行与总字节数。`read_text`、`read_bytes` 会读入整体内容，不适合无上限输入。

关闭文件用 with。需要保留旧版本或多文件一致性时，应使用明确的日志/版本方案或数据库事务，不要靠连续替换三个文件假装一次原子提交。

## 5. 练习与答案

### 5.1 flush 完成后断电一定不丢吗？

答案：不能保证。flush 主要处理 Python 缓冲；还涉及 OS、文件系统与设备持久化。需要按目标存储的保证设计同步和恢复。

### 5.2 原子替换能解决两个进程同时更新吗？

答案：不能自动解决丢失更新。每次替换可以完整可见，但后写者可能覆盖前者。还需要锁、版本比较或事务。

### 5.3 临时文件为什么优先放目标同目录？

答案：可以满足同文件系统替换的常见前提，并便于权限与清理管理；仍要用安全唯一名字并处理失败。

## 6. 参考资料

- [pathlib](https://docs.python.org/3.14/library/pathlib.html)
- [os.replace 与 fsync](https://docs.python.org/3.14/library/os.html)
- [tempfile](https://docs.python.org/3.14/library/tempfile.html)
