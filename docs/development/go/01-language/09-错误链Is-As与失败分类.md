---
title: "Go 错误链 Is As 与失败分类"
sidebar_label: "09. Go 错误链 Is As 与失败分类"
sidebar_position: 9
description: "error 不只是打印给人的一段文本。调用方需要区分不存在、冲突、超时、权限不足和依赖不可用，才能决定返回什么、是否重试以及如何记录证据。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go 错误链 Is As 与失败分类

error 不只是打印给人的一段文本。调用方需要区分不存在、冲突、超时、权限不足和依赖不可用，才能决定返回什么、是否重试以及如何记录证据。

## 1. 错误值与错误链

error 是接口，具体错误可以是哨兵值或携带结构化字段的类型。用 fmt.Errorf 的 %w 包装后，errors.Is 可以判断链中目标，errors.As 可以取得匹配类型；用 %v 只格式化文字，不保留相同的可解包关系。

错误链要提供必要上下文，但不能泄露密码、Token、完整请求正文或 DSN。每层都打印同一错误会产生噪声，通常由边界统一记录，内部负责带信息返回。

下面为包内错误分类片段，需导入 errors 与 fmt：

```go
var ErrMissing = errors.New("missing")

func load(id string) error {
    return fmt.Errorf("load %s: %w", id, ErrMissing)
}

func classify() bool {
    return errors.Is(load("t1"), ErrMissing)
}
```

需要结构化字段时，定义实现 Error() string 的类型，再用 errors.As 取得该类型。每次新建 errors.New("missing")，不会因为文字相同就与原哨兵成为同一个错误值。

## 2. 分类实验

```bash
cd examples/go/core-lab
go run ./cmd/lab -case errors
```

```text
is=true as=true code=409
```

完整代码与断言见 [core-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/go/core-lab)。

实验分别包装哨兵错误和 typed error。判断不依赖“字符串里包含 missing”；后续 Gin 把 store.ErrMissing 映射 404、ErrConflict 映射 409，底层文本改变不应改变接口语义。

## 3. 重试与未知结果

网络超时代表没有及时得到结果，不一定代表对方没有执行。写操作要有业务幂等或查询确认机制，不能对所有 error 统一重试三次。Context 取消、输入非法和认证失败通常不属于继续重试同样输入的理由。

errors.Join 可以表达多个清理/执行错误，但需要保持主要失败可识别。关闭失败不能无条件覆盖最初的业务错误；也不能所有 defer 都忽略关闭结果而从不说明其影响。

## 4. 练习与答案

### 4.1 能否根据 err.Error 包含 timeout 来决定重试

不可靠。文本不是稳定类型契约，应优先按错误类型、错误链、Context 与具体操作语义分类。

### 4.2 %w 与 %v 有什么区别

两者都能展示文本，但 %w 建立可解包关系，errors.Is/As 才能沿链检查被包装错误。

### 4.3 发送消息超时是否可以认定没有发送

不能。结果可能未知，应保留稳定事件 ID 并通过确认、重试和消费去重处理。

## 5. 参考资料

- [errors 包](https://pkg.go.dev/errors)
- [错误包装](https://go.dev/blog/go1.13-errors)
