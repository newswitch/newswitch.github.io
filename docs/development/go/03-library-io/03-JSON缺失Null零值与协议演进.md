---
title: "Go JSON：缺失、null、零值、严格解码与协议演进"
sidebar_label: "03. Go JSON：缺失、null、零值、严格解码与协议演进"
sidebar_position: 3
description: "JSON 解码成功只说明语法和部分类型匹配，不代表业务输入合法。字段存在性、重复键、未知字段、数字精度和多段正文都可能影响接口契约。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go JSON：缺失、null、零值、严格解码与协议演进

JSON 解码成功只说明语法和部分类型匹配，不代表业务输入合法。字段存在性、重复键、未知字段、数字精度和多段正文都可能影响接口契约。

## 1. 缺失与零值要分清

普通 int 字段无法区分未提供和明确输入 0。指针可以区分非 nil 的明确零值与 nil，但通常仍把缺失和 null 都表示为 nil；若三态都有业务意义，需要自定义 Optional 类型记录 presence 与 null。

匿名 map 的数字表示、整数边界与精度必须明确。大 ID 不应在浮点数与字符串之间悄悄转换；金额也不应依赖无约束 float64。

## 2. 严格字段实验

```bash
cd examples/go/core-lab
go run ./cmd/lab -case json
```

```text
missing=true explicit-zero=0 unknown-rejected=true
```

完整实现和断言见 [core-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/go/core-lab)。

实验用指针表达 count，并对未知字段启用 DisallowUnknownFields。它没有实现三态 null，也没有仅凭一个 Decode 就证明整个输入只有一个 JSON 对象。

## 3. 入站契约需要四层控制

先限制正文大小和读取时间，再 Decode 类型，再拒绝多余尾部对象，最后验证范围与跨字段关系。service-lab 的 decode 会再次 Decode 并要求 io.EOF，避免把 `{} {}` 的后一半忽略。

未知字段是否拒绝要按接口演进规则决定；严格拒绝能尽早暴露拼写错误，但也需要协调客户端升级。对于重复键和大小写匹配，必须按所用 encoding/json 版本语义测试，不能只看 JSON Schema 就假定库已执行全部约束。

## 4. 输出与版本边界

内部数据库字段用 `json:"-"` 或专用 DTO 排除。omitempty 的零值省略会改变响应语义，不能仅为了 JSON 更短而删除业务需要的 0/false。

本系列以 Go 1.27.3 的公开 encoding/json API 为基线。工具链内部 JSON 实现已在演进，不沿用“永远是旧反射编码器”一类结论。协议兼容性用黄金样例和真实客户端契约验证，别依赖未承诺的字段顺序或空白格式。

## 5. 练习与答案

### 5.1 *int 能区分缺失和 null 吗

一般不能，两者常都为 nil；需要自定义三态表示。

### 5.2 第一次 Decode 成功就说明正文全部合法了吗

不说明，后面可能还有另一个对象或垃圾字符。

### 5.3 严格 JSON 解码能替代业务验证吗

不能，范围、权限、状态和关联条件仍需验证。

## 6. 参考资料

- [encoding/json](https://pkg.go.dev/encoding/json)
- [Go 1.27](https://go.dev/doc/go1.27)
