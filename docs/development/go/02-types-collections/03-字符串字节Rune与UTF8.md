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

## 5. 逐字节读取与 UTF-8 解码走的是不同路径

以“中A”为例，UTF-8 字节长度为 4；range 得到两个码点，起始字节偏移分别是 0、3。s[1] 取得中的第二个编码字节，不是“第二个字符”。先用 []rune 转换再按下标读取，则转换与分配成本随整个字符串增长。

外部数据可能不是合法 UTF-8。DecodeRuneInString 对非法字节可返回 RuneError、宽度 1，而一个合法的替换字符 U+FFFD 宽度是 3；只看 RuneError 而不看宽度，会把两类情况混为一谈。

文本处理先规定非法编码是拒绝、替换还是按二进制保留。签名和摘要通常作用于确定的字节，不能先随意替换编码后再声称内容完全相同。

## 6. 截断单位必须与业务承诺一致

配套 PrefixRunes 先检查最多 4096 字节与合法 UTF-8，再按 range 的字节偏移截取前 n 个码点。截取“中AB”的前两个码点得到“中A”，不会把中的三字节拆开。

但对 e 加组合音标 U+0301，前一个码点只有 e，会拆开一个用户感知的字形。字符计数、终端列宽和 UTF-8 安全边界是三种不同问题；需要字素簇分割时，应选择支持相应 Unicode 规则的实现，而不把 []rune 当成最终答案。

日志截断还需要脱敏，数据库字段限制还需要按其字符集和字段长度解释；协议里的“最大长度”应明确单位，避免客户端按字符而服务端按字节计算。

## 7. 转换语义、内存保留与构建成本

string 不可变，[]byte 可变；语义上转换后不能通过修改字节切片反向改写已有字符串。编译器可能对不逃逸或只读场景优化分配，但不能把这些优化扩大成允许随意共享可写内存的 API。

字符串子串也可能保留较大的原存储，长期只存一小部分时可评估 strings.Clone；Builder 适合连续构建文本，但使用后的 Builder 不应任意复制。大量循环中的 s += piece 需要测量累计复制量，不能只看单次拼接简单。

避免用 unsafe 转换把“少一次分配”换成跨层可变别名。接口约定、并发只读与对象生命周期通常比某个微基准更重要。

## 8. 运行字节、码点与截断实验

```bash
cd examples/go/core-lab
go run ./cmd/foundation-lab -mode types
go test ./internal/foundation -run 'TestTypes|TestPrefixRunes' -v -count=1
go test ./internal/foundation -run '^$' -fuzz FuzzPrefixRunes -fuzztime=2s -parallel=2
```

types 输出 byte_offsets=[0,3]、invalid_width=1、replacement_width=3、prefix="中A"。测试也明确组合音标不等于一个码点；Fuzz 检查结果是原字节前缀、保持合法 UTF-8，且码点数量符合上限，不把两秒探索称作穷尽验证。

## 9. 练习与答案

### 9.1 len(中文) 是字符数吗

不是，返回 UTF-8 编码字节数。

### 9.2 rune 是否等于一个屏幕字符

不一定，可见字形可能由多个 code point 组成。

### 9.3 string 能存任意二进制字节吗

能，但文本协议与显示工具未必接受，应按二进制语义处理。

## 10. 参考资料

- [strings](https://pkg.go.dev/strings)
- [unicode/utf8](https://pkg.go.dev/unicode/utf8)
- [配套类型实验](https://github.com/newswitch/newswitch.github.io/tree/main/examples/go/core-lab/internal/foundation)
- [固定版本 UTF-8 实现](https://github.com/golang/go/blob/go1.27.3/src/unicode/utf8/utf8.go)
