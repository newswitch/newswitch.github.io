---
title: "Go Race、Fuzz 与属性测试：在执行路径之外寻找边界"
sidebar_label: "03. Go Race、Fuzz 与属性测试：在执行路径之外寻找边界"
sidebar_position: 3
description: "示例测试适合固定场景，Fuzz 适合探索输入空间，Race 适合观察已执行路径中的数据竞争。三者各有边界，不能混成一个“全部验证通过”。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go Race、Fuzz 与属性测试：在执行路径之外寻找边界

示例测试适合固定场景，Fuzz 适合探索输入空间，Race 适合观察已执行路径中的数据竞争。三者各有边界，不能混成一个“全部验证通过”。

## 1. 属性先于随机输入

Fuzz 应检查始终成立的性质，例如编码解码往返、规范化幂等、长度与大小限制、租户不串数据。只有“不能 panic”通常不足以证明业务正确。

core-lab 的 FuzzSum 是最小入门例子：对两个 int64，sum 的结果与相同溢出规则下的 a+b 一致。它教会运行与保存语料，不宣称覆盖了复杂算法。

## 2. 有限 Fuzz 实验

```bash
cd examples/go/core-lab
go test ./internal/demos -run '^$' -fuzz FuzzSum -fuzztime=2s -parallel=2
```

一次 Windows/amd64、Go 1.27.3 本机运行摘要：

```text
fuzz: elapsed: 2s, execs: 36296 (17375/sec), new interesting: 1 (total: 2)
PASS
```

执行数取决于机器和当次负载，不应硬编码成验收门槛。发现失败后应把最小化语料纳入回归，不要只删除触发输入。

## 3. Race 与平台条件

```bash
go test -race ./... -count=1 -timeout=60s
```

需要支持 Race 的目标平台和相应工具链。本机无合适 C 编译器，未完成 -race 执行；普通测试、Fuzz seed 通过均不替代该项。CI 可在已配置的 Linux runner 上独立运行。

Race 只发现被执行的竞争路径，不检测所有死锁和分布式重复副作用。并发设计仍需所有权与 happens-before 依据。

## 4. 输入与资源安全

Fuzz 目标不能对随机路径任意写文件、无限分配或连接外部服务。先验证输入大小，再进行解析；使用临时目录与有限时间，错误语料不能含真实凭证。

随机失败要记录版本、种子/语料和构建选项。并发时间相关错误可通过注入时钟、控制通知顺序与有限等待提高可复现性，不能单靠 sleep。

## 5. 练习与答案

### 5.1 Fuzz 运行两秒等于覆盖所有输入吗

不等于，只是有限探索。

### 5.2 Race 通过能证明没有死锁吗

不能，它不是死锁与业务一致性验证器。

### 5.3 遇到导致失败的语料能删除吗

应先定位修复并保留为回归样本。

## 6. 参考资料

- [Go fuzzing](https://go.dev/doc/security/fuzz/)
- [Race detector](https://go.dev/doc/articles/race_detector)
