---
title: "Go 数组与 Slice：长度、容量、共享和扩容"
sidebar_label: "01. Go 数组与 Slice：长度、容量、共享和扩容"
sidebar_position: 1
description: "Slice 很适合表达可变长序列，但它不是独立拥有数据的数组。理解切片描述符与底层数组，才能解释 append、意外修改、内存滞留和并发访问。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go 数组与 Slice：长度、容量、共享和扩容

Slice 很适合表达可变长序列，但它不是独立拥有数据的数组。理解切片描述符与底层数组，才能解释 append、意外修改、内存滞留和并发访问。

## 1. 数组与切片分别复制什么

`[3]int` 的长度属于类型，数组赋值复制元素；`[]int` 是切片值，描述一段底层数组，包含起点、长度和容量。切片赋值复制描述信息，不复制元素。

`len` 限制索引，`cap` 限制可重新切片的范围。`make([]int, 3, 8)` 已有三个零值元素，不是长度为零的预分配队列；要 append 三次，应使用 `make([]int, 0, 8)`。

## 2. 共享与脱离实验

```bash
cd examples/go/core-lab
go run ./cmd/lab -case slice
```

```text
shared=[9 2 3]
clone=[7 2 3] detached=[8 2 4]
```

完整实现和断言见 [core-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/go/core-lab)。

实验先把 `a[:2]` 的第一个元素改为 9，原数组随之改变。`slices.Clone(a)` 复制一层元素；`a[:2:2]` 用完整切片表达式把容量限制为 2，再 append 第三个元素，必须获得新的底层存储，因此后续写入不再影响 a。

## 3. append 为什么有时影响原值

容量足够时，append 可以复用原数组；不够时分配并复制。必须接收返回值：`s = append(s, v)`。具体增长倍率是实现细节，不要把某个倍率写成语言契约。

Clone 不是递归深拷贝。`[]*Task` 复制后仍指向同一批 Task，`[][]byte` 的内层也可能共享。并发读写相同元素仍需同步，容量被限制并不使 Slice 自动线程安全。

## 4. 小切片为何留住大内存

从大缓冲区截取少量字节后长期保存，仍可能通过底层数组引用保留整块内存。若需要独立生命周期，复制所需范围；但要根据 heap profile 证明滞留，不能把每次切片都改成拷贝。

删除元素后，可清零不再使用的含指针槽位，避免仍在底层数组里的引用延长对象生命。`slices.Delete` 的具体行为要按目标版本文档检查。

## 5. 练习与答案

### 5.1 cap 足够就不会发生共享修改吗

相反，cap 足够时 append 更可能复用底层数组。

### 5.2 Clone 一个指针切片会复制对象吗

不会，只复制指针元素；对象仍共享。

### 5.3 nil Slice 与空 Slice 一样吗

len 都可为零，append 均可使用，但是否为 nil 以及某些序列化结果可以不同。

## 6. 参考资料

- [Slice 规范](https://go.dev/ref/spec#Slice_types)
- [slices](https://pkg.go.dev/slices)
