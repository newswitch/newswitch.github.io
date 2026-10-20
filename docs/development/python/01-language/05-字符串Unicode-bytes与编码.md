---
title: "字符串、Unicode、bytes 与编码"
sidebar_label: "05. 字符串、Unicode、bytes 与编码"
sidebar_position: 5
description: "区分 Python 文本、码点、字节和可见字符，理解 UTF-8 编解码、规范化、切片、格式化与编码故障。"
tags: [Python, Unicode, UTF-8, bytes, 字符串]
---

# 字符串、Unicode、bytes 与编码

`str` 表达文本，`bytes` 表达字节序列。编码把文本变成字节，解码把字节解释成文本。文件、网络和终端最终交换字节，但程序里的文本不应该一直当成字节处理。

## 1. 码点、可见字符与字节

| 层次 | 例子 | Python 如何观察 |
| --- | --- | --- |
| Unicode 码点 | 字符 `中` 对应 U+4E2D | `ord("中")` |
| 文本序列 | `"中文"` | `str`；`len` 统计码点数量 |
| 编码后的字节 | UTF-8 中每个汉字通常占三个字节 | `text.encode("utf-8")` |
| 用户看到的字符 | 组合音标或组合 Emoji | 可能由多个码点组成 |

`len(str)` 不是字节长度，也不是严格的屏幕列宽或字形数量。`str` 是不可变序列，其索引结果仍是长度为 1 的字符串，没有单独的 `char` 类型。

## 2. 完整实验

```python title="text_demo.py"
import unicodedata

def main():
    text = "中文"
    payload = text.encode("utf-8")
    print("lengths:", len(text), len(payload))
    print("hex:", payload.hex())
    print("roundtrip:", payload.decode("utf-8"))
    print("byte index:", payload[0])
    try:
        payload[:2].decode("utf-8")
    except UnicodeDecodeError:
        print("partial: UnicodeDecodeError")

    composed = "\u00e9"
    combined = "e\u0301"
    print("code points:", len(composed), len(combined))
    print("equal:", composed == combined)
    print("normalized:", composed == unicodedata.normalize("NFC", combined))
    print("lines:", "a\r\nb\n".splitlines())
    print("url:", "https://example.test".removeprefix("https://"))

if __name__ == "__main__":
    main()
```

```text title="text_demo.out"
lengths: 2 6
hex: e4b8ade69687
roundtrip: 中文
byte index: 228
partial: UnicodeDecodeError
code points: 1 2
equal: False
normalized: True
lines: ['a', 'b']
url: example.test
```

这里的 `228` 是第一个字节的无符号整数值，不是第一个汉字的码点。`bytes` 索引返回整数，切片才返回 `bytes`。截取 UTF-8 的前两个字节，可能把一个字符切断，不能独立解码。

网络分块同样可能切在字符中间。不要对每一块独立 `decode` 后再拼接；应使用正确的增量解码器或由文本流处理边界。

## 3. 为什么看起来相同却不相等

带音标的 `é` 可以是一个预组合码点，也可以是 `e` 加组合音标。普通 `==` 比较码点序列，不自动进行 Unicode 规范化。

NFC 等规范化可以用于明确需要等价文本比较的字段，但不能擅自用于所有数据。密码、签名原文、外部协议标识符都可能要求精确保留输入；“看起来一样”也不代表安全等价。

大小写无关比较可以考虑 `casefold`，但仍要结合标识符规则。国际化域名、用户账号、防混淆检查不是简单调用 `lower` 就完整解决的问题。

## 4. 在边界明确编码

```python
from pathlib import Path

path = Path("message.txt")
path.write_text("你好\n", encoding="utf-8")
text = path.read_text(encoding="utf-8")
print(text.rstrip("\n"))
```

这是文件读写示例，会在当前工作目录创建或覆盖 `message.txt`；运行前确认目标，不要替换成重要文件。源码默认编码与所读取数据文件的编码不是同一个配置。

`str(payload)` 不等于解码，例如 `str(b"abc")` 得到带 `b` 前缀的表示文本。真正的文本转换需要 `payload.decode("utf-8")`。

| 故障 | 含义 | 处理方向 |
| --- | --- | --- |
| UnicodeDecodeError | 字节无法按指定编码解释 | 查生产方编码、是否截断或混入二进制 |
| UnicodeEncodeError | 文本不能表示为目标编码 | 查终端/文件/协议允许的编码 |
| 没报错却是乱码 | 错误编码也能形成合法字符 | 对照原始字节与生产方规则，不能只看异常 |

`errors="ignore"` 可能静默丢数据，`"replace"` 会替换内容。它们适合明确允许损失的展示，不适合签名、主键、配置或精确数据传输。默认先保留失败证据，不用忽略错误掩盖问题。

## 5. 常用处理与隐藏边界

切片是左闭右开：`text[start:stop:step]`，原字符串不变。字符串操作如 `replace`、`strip`、`upper` 也返回结果，不能期待修改原对象。

`strip("ab")` 删除的是两端连续出现的字符集合 `a` 和 `b`，不是删除固定前缀 `"ab"`。删除固定前后缀使用 `removeprefix`、`removesuffix`。没有参数的 `split()` 按空白分割并折叠连续空白；`split(",")` 按指定分隔符，空字段会保留。

拼接大量片段优先收集后 `"".join(parts)`，避免把循环中反复拼接的实现优化当成性能保证。`join` 要求元素是字符串；二进制使用 `b"".join(parts)`。

```python
name = "api"
seconds = 1.23456
print(f"{name}: {seconds:.2f}s")  # api: 1.23s
```

f-string 负责格式化，不提供 SQL 参数化、HTML 转义或 Shell 注入防护。把不可信数据插入另一个语言或协议时，使用相应的参数绑定/转义机制。

## 6. 练习与答案

### 6.1 中文字符串长度为二，为什么发到网络是六字节？

答案：`len(str)` 数码点，`len(bytes)` 数字节。本例两个汉字各用三个 UTF-8 字节，编码后共六字节；不是所有 Unicode 字符都占三个字节。

### 6.2 一个 UTF-8 文件能每一百字节切开分别解码吗？

答案：不能保证。边界可能位于一个多字节字符内部。应按文本读取、使用增量解码器，或在协议里定义完整消息边界。

### 6.3 str(b"abc") 与 b"abc".decode("utf-8") 一样吗？

答案：不同。前者得到 `"b'abc'"`，用于表示字节对象；后者得到 `"abc"`，是按 UTF-8 解释后的文本。

## 7. 参考资料

- [Unicode HOWTO](https://docs.python.org/3.14/howto/unicode.html)
- [文本与二进制序列](https://docs.python.org/3.14/library/stdtypes.html)
- [unicodedata](https://docs.python.org/3.14/library/unicodedata.html)
- [codecs：增量解码](https://docs.python.org/3.14/library/codecs.html)
