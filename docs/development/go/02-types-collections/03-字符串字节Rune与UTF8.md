---
title: "Go 字符串、byte、rune 与 UTF-8 边界"
sidebar_label: "03. Go 字符串、byte、rune 与 UTF-8 边界"
sidebar_position: 3
description: "字符串长度、用户看到的字符数和屏幕宽度不是同一个概念。处理中文、文件名、HTTP 正文与截断时，需要先确定按哪一种单位操作。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go 字符串、byte、rune 与 UTF-8 边界

字符串长度、用户看到的字符数和屏幕宽度不是同一个概念。处理中文、文件名、HTTP 正文与截断时，需要先确定按哪一种单位操作。

## 1. 三种不同单位

string 是只读字节序列，内容不一定是合法 UTF-8；`len(s)` 返回字节数，索引返回 byte。rune 是 int32 的别名，通常用于表达 Unicode code point。range 字符串按 UTF-8 解码，索引仍是字节偏移。

多个 code point 可能组成一个可见字形，例如组合音标和部分 Emoji。`utf8.RuneCountInString` 不是通用的“用户可见字符数”或终端列宽计算器。

## 2. 中文长度实验

```bash
cd examples/go/core-lab
go run ./cmd/lab -case strings
```

```text
bytes=5 runes=3
third-rune=中
```

完整实现和断言见 [core-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/go/core-lab)。

`Go中` 中 G、o 各占一个 UTF-8 字节，中占三个，所以总计五字节。`[]rune(s)[2]` 取得第三个 code point，但转换需要额外存储；顺序扫描更适合 range。

## 3. 转换、构建与非法输入

`[]byte(s)` 通常用于可变处理，转回 string 后按不可变值使用，不应依赖 unsafe 偷偷共享可写内存。大量拼接优先考虑 strings.Builder；字节协议用 bytes.Buffer、io.Writer。

遇到外部字节先决定是否要求 UTF-8：`utf8.Valid` 可验证。截断应按协议单位，JSON 文本不要从任意字节中间截开；二进制数据则不应强行当文本解码。

## 4. 规范化与业务标识

视觉相同的文本可能有不同编码序列，大小写转换也不等于业务唯一性。用户名、域名、路径等分别需要明确的规范化规则；不要对密码静默 trim 或改大小写。

日志按字节限制长度时可在 UTF-8 边界截断，但仍需脱敏。SQL 与 URL 编码有各自语义，不应靠 strings.Replace 同时解决所有注入或转义问题。

## 5. 练习与答案

### 5.1 len(中文) 是字符数吗

不是，返回 UTF-8 编码字节数。

### 5.2 rune 是否等于一个屏幕字符

不一定，可见字形可能由多个 code point 组成。

### 5.3 string 能存任意二进制字节吗

能，但文本协议与显示工具未必接受，应按二进制语义处理。

## 6. 参考资料

- [strings](https://pkg.go.dev/strings)
- [unicode/utf8](https://pkg.go.dev/unicode/utf8)
