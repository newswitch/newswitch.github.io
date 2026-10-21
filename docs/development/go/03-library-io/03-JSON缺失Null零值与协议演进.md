---
title: "Go JSON：缺失、null、零值、严格解码与协议演进"
sidebar_label: "03. Go JSON：缺失、null、零值、严格解码与协议演进"
sidebar_position: 3
description: "JSON 解码成功只说明语法和部分类型匹配，不代表业务输入合法。字段存在性、重复键、未知字段、数字精度和多段正文都可能影响接口契约。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go JSON：缺失、null、零值、严格解码与协议演进

JSON 解析器只能保留目标类型能够表达的信息。字段缺失、null、0，整数与浮点数，语法成功与整个请求合法，都不是同一个概念。本章以 Go 1.27.3 的 encoding/json 兼容 API 为基线，先建立协议语义，再通过确定输出检验边界。

## 1. 先决定字段有几种业务状态

创建接口中的 count 可以规定“必填且非负”；局部更新接口则可能需要区分：没出现表示不更新，null 表示清除，0 表示明确设为零。选择字段类型之前先写清这三种含义。

对新创建的 DTO，普通 int 会把缺失、null 与显式 0 都留成零值；*int 能区分显式 0 与 nil，但缺失和 null 通常同为 nil。若把 DTO 重复解码使用，缺失字段可能保留旧值，更不能按零值猜测存在性。

所以请求 DTO 应每次新建，解码后再验证；失败后不继续把可能已部分修改的对象交给业务层。数据库实体也不宜直接当写入 DTO，避免把内部状态、租户或版本字段暴露为可写输入。

## 2. 三态 Optional 应记录存在性，而不只保存指针

```go
type Optional[T any] struct {
    Set   bool
    Null  bool
    Value T
}
```

给它实现 UnmarshalJSON：字段出现时才会调用该方法，所以 Set=true；遇到 JSON null 时 Null=true；其他值解码到 Value。配套实现先解析到临时值，成功后才整体赋回，避免字段自身解码失败时留下半更新状态。

注意：Set 是相对“本次全新 DTO”而言的。复用旧 DTO 再解码一个缺少该字段的对象，不会自动把 Set 清回 false。这个类型也只演示入站语义，没有自动实现正确的输出省略策略，不能直接当作通用 PATCH 框架。

可按以下状态判断：

| JSON 输入 | Set | Null | 业务含义示例 |
| --- | --- | --- | --- |
| `{}` | false | false | 不修改 |
| `{"count":null}` | true | true | 清除或按协议拒绝 |
| `{"count":0}` | true | false | 明确设为 0 |

## 3. 严格解码是一组策略，不是一个开关

完整入站路径至少包括：读取大小与时间预算、媒体类型、JSON 解码、正文结束检查、字段验证，以及后续身份与对象授权。

DisallowUnknownFields 只处理解码到结构体时不匹配的字段名；它不等于拒绝重复键、强制大小写、验证范围或验证权限。解码到 map 时，也不会凭空产生一张允许字段列表。

配套 DecodeOne 先 Decode 目标，再 Decode 一个额外值，只有第二次得到 io.EOF 才成功。这样拒绝 `{} {}` 与合法对象后面的垃圾字符，允许尾部空白；但它仍不是 HTTP 完整处理器，不检查媒体类型，也没有内置正文上限或业务校验。Gin 中如何组合这些层见 [参数绑定](../../gin/02-request-response/01-参数绑定校验与大小限制.md)。

## 4. 固定兼容 API 的重复键与大小写行为

本章实际测试使用 `encoding/json`，不是直接使用 `encoding/json/v2`。对普通整数 Count 字段，`{"count":1,"count":2}` 最终得到 2；`{"COUNT":3}` 也能匹配标记为 count 的字段，即使开启 DisallowUnknownFields。

对更复杂的对象，后出现的重复键还可能与已有内容合并，不能把所有情况简单概括为“总是整个值被替换”。如果业务契约禁止重复键，应选择并测试具备相应策略的解码路径；未知字段开关没有提供这项保证。

Go 1.27.3 默认启用了 JSONv2 实现，但 v1 包通过兼容选项保留历史语义。`v2_options.go` 说明了这个兼容层。内部引擎更新不等于原 import path 自动获得 v2 的默认大小写、重复键和 nil 容器策略。迁移 import path 或构建选项时，应重新跑协议样例。

## 5. 数字为什么会悄悄失去整数精度

解码到 any 时，兼容 API 默认把数字表示为 float64。它不能精确表示所有 64 位整数；例如 9007199254740993 会被舍入为 9007199254740992。

Decoder.UseNumber 可以保留 json.Number 的原始数字文本，但之后调用 Int64 仍会进行范围校验，也仍可能失败。已知字段优先解码到明确的整数类型；跨 JavaScript 等客户端的大 ID 可以按协议使用字符串，不要先经过浮点数再转回整数。

金额需要明确精度、舍入与单位，可用受约束的最小货币单位整数或合适的十进制表示。UseNumber 不是自动的金额模型，也不会替业务决定上下界。

## 6. 输出中的零值、空集合与私有字段

兼容 API 会把 nil Slice 编为 null，非 nil 空 Slice 编为 []；这可能影响客户端能否直接遍历。应按协议稳定输出，不要让数据库查询是否返回 nil 偶然决定 JSON 形状。

兼容 API 的 omitempty 会省略 0、false、nil 等空值。若 0 表示明确的有效状态，省掉它可能改变业务含义；可使用指针或专用响应 DTO 表达需要保留的值。omitzero 与新 v2 的 omitempty 也不能混为一谈，应按所用 API 的文档验证。

私有字段使用 json:"-" 或不放进输出 DTO。默认 encoding/json 对字符串 Map 键排序不等于整个 JSON 是跨语言的规范化签名格式；数字、转义、自定义 Marshal 与客户端表示仍需约定。协议测试比较语义或明确的黄金样例，不把未承诺的编码细节当业务逻辑。

## 7. 运行三态、尾部与数字精度实验

```bash
cd examples/go/core-lab
go run ./cmd/value-lab -mode json
go test ./internal/valueflow -run 'TestJSON|TestDecodeOne|TestOptional' -v -count=1
```

完整输出中的关键字段如下，其余字段可在命令结果中核对：

```json
{
  "missing_set":false,"null_set":true,"null_flag":true,
  "zero_set":true,"zero_value":0,
  "second_rejected":true,"unknown_rejected":true,
  "duplicate_value":2,"case_insensitive":3,
  "float_rounded":true,"number_literal":"9007199254740993",
  "nil_slice":"null","empty_slice":"[]"
}
```

测试同时覆盖空正文、类型不符、未知字段、尾部对象、尾部垃圾与合法空白；Optional 测试验证失败不覆盖旧字段值。它们说明当前兼容 API 的实际行为，不声称所有替代编码器或 v2 默认配置都相同。

## 8. 协议演进时哪些变化需要重新验证

增加可选字段通常比删除或改变类型更容易兼容，但旧客户端是否拒绝未知字段仍需确认。把数字改成字符串、把 null 改成 []、增加枚举值、修改错误结构，都可能使现有客户端失效。

保留一组输入/输出契约样例，包括缺失、null、0、边界整数、空集合与错误响应。更换编码器应先检查语义一致，再测试分配和吞吐；不能只看某个 Marshal benchmark 更快就直接替换。

## 9. 练习与答案

### 9.1 Optional 有 Set 字段，就能安全复用同一个请求对象吗

不能。缺失字段不会触发 UnmarshalJSON，因此旧 Set 与旧 Value 可能继续存在。每次请求新建 DTO，解码失败则不进入业务；字段类型的记录能力不等于自动重置整个对象。

### 9.2 DisallowUnknownFields 能拒绝重复字段和大写字段名吗

在本章兼容 API 实测中不能。它只拒绝无法匹配的未知字段；重复键处理、名称匹配和完整正文结束是独立策略。

### 9.3 UseNumber 后就能把任何数字准确转成 int64 吗

不能。它保存数字文本，Int64 仍可能遇到超范围或非整数字面量。应保留转换错误，并按字段语义约束类型和范围。

## 10. 参考资料

- [Go 1.27.3 JSON v1/v2 兼容说明](https://github.com/golang/go/blob/go1.27.3/src/encoding/json/v2_options.go)
- [Go 1.27.3 Decoder 兼容实现](https://github.com/golang/go/blob/go1.27.3/src/encoding/json/v2_stream.go)
- [encoding/json API](https://pkg.go.dev/encoding/json)
- [配套 Optional 与 DecodeOne 实验](https://github.com/newswitch/newswitch.github.io/tree/main/examples/go/core-lab/internal/valueflow)
