---
title: "Go 接口、方法集与 typed nil：从替换到运行时判断"
sidebar_label: "04. Go 接口、方法集与 typed nil：从替换到运行时判断"
sidebar_position: 4
description: "接口表达调用方需要的行为，不是 Java 类层次的翻译。方法集、隐式实现与动态值共同决定接口赋值、nil 判断以及边界设计。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go 接口、方法集与 typed nil：从替换到运行时判断

接口表达调用方需要的行为，不是 Java 类层次的翻译。方法集、隐式实现与动态值共同决定接口赋值、nil 判断以及边界设计。

## 1. 接口为何由使用方定义

小接口只暴露实际需要的方法，例如 `Load(ctx, id)`，由调用方表达需求。具体类型只要方法集满足接口即可，不需要显式 implements。不要为了每个结构体都建立同名大接口。

T 的方法集包含值接收者方法；*T 还包含指针接收者方法。可寻址变量调用指针方法的便利语法，不代表 T 自动满足要求该指针方法的接口。

## 2. typed nil 实验

```bash
cd examples/go/core-lab
go run ./cmd/lab -case interfaces
```

```text
pointer-nil=true interface-nil=false
nil receiver
```

完整实现和断言见 [core-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/go/core-lab)。

接口变量既承载动态类型，也承载动态值。动态类型为 *label、动态值为 nil 时，接口本身不为 nil。方法调用仍会进入对应实现，是否 panic 取决于方法是否解引用 nil，实验方法显式处理了 nil。

## 3. 错误返回与依赖注入

返回 error 时不要把 nil 的 *MyError 直接装入 error 后返回；成功路径明确 `return nil`。边界上用构造函数检查必需依赖，不能只靠 `if dependency == nil` 识别所有 typed nil。

组合比继承更常见，但嵌入提升方法并不自动表达正确的业务关系。接口也不保证线程安全、幂等或资源关闭，这些要在契约和测试中说明。

## 4. 源码阅读与性能

接口调用可能涉及动态分派，也可能被编译器去虚化或内联。不要未经 benchmark 就把接口全部移除。性能判断应结合逃逸分析、分配次数和完整路径。

类型断言 `v.(T)` 会在不匹配时 panic；`x, ok := v.(T)` 用于可预期分支。类型 switch 适合有限类型协议，不应变成无边界地猜测传入对象。

## 5. 练习与答案

### 5.1 var e *MyError=nil 后 return e 是否成功

若返回类型是 error，得到的接口通常非 nil。

### 5.2 *T 的方法集与 T 完全一样吗

不一样，*T 包含指针接收者方法。

### 5.3 接口能保证实现不会阻塞吗

不能，必须定义时限、取消和同步契约。

## 6. 参考资料

- [Go 语言规范](https://go.dev/ref/spec)
