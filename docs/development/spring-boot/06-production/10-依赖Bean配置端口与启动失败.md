---
title: "依赖、Bean、配置、端口和环境引起的启动失败"
sidebar_label: "10. 启动失败定位"
sidebar_position: 10
description: "按 JVM、环境、定义注册、Bean 创建、端口与就绪阶段分类故障，沿因果链定位而不是只看最后一行异常。"
tags: [SpringBoot, 启动日志, 自动配置, 故障排查]
---

# 依赖、Bean、配置、端口和环境引起的启动失败

最后一行“Application run failed”是结果，不是根因。启动异常常层层包装，应结合发生阶段与最内层可行动错误理解。

## 1. 按阶段分类

| 阶段 | 常见证据 | 首先检查 |
| --- | --- | --- |
| JVM/装载 | UnsupportedClassVersion、NoClassDefFound | JDK、产物、依赖布局 |
| 环境准备 | 配置文件缺失、绑定转换失败 | 路径、优先级、Profile |
| 定义与候选 | 找不到 Bean、多个候选 | 扫描范围、条件、限定符 |
| 创建与初始化 | BeanCreationException、连接失败 | 工厂方法、依赖、生命周期 |
| Web 监听 | 地址已占用、绑定拒绝 | 实际端口、地址、权限 |
| Runner/就绪 | 端口已起但启动最终失败 | 初始化工作与超时 |

外层 UnsatisfiedDependencyException 可能来自最底层数据源连接错误，不代表给 Service 随便加一个注解就能修好。

## 2. 先保存版本与有效输入

记录 JDK、Boot、构建 commit、启动参数、Profile、外部配置位置和依赖树。敏感值不输出，优先记录来源和是否存在。

```bash
java -version
mvn dependency:tree
java -jar target/boot-service-lab-1.0.0.jar --debug
```

debug 可帮助查看条件评估，但不是所有系统故障都由自动配置引起；日志级别与内容要受控。生产排查不要直接公开 env 或完整进程参数里的秘密。

## 3. 常见机制误判

NoSuchMethodError 常提示编译/运行类版本冲突，不是方法真的从源码“消失”。检查被哪个 JAR 装载、BOM 是否被覆盖和打包布局。

Bean 不存在：看扫描、定义是否注册、条件为何不满足。Bean 多个：明确业务选择、Qualifier/Primary，别无差别允许覆盖。循环依赖：重构方向优先，开启循环引用不保证构造器环和代理语义正确。

配置绑定失败：字段类型、单位、前缀、校验和优先级一起看。一个同名环境变量可能覆盖文件，改 YAML 不生效不等于 Boot 没读配置。

## 4. 端口与就绪

Linux 可用 `ss -lntp`，Windows 可用 `Get-NetTCPConnection -State Listen` 识别占用者。只读检查后，不直接结束不属于本应用的进程；隔离实验改用空闲端口。

端口监听成功后 Runner 仍可能失败。Kubernetes startup/readiness 能避免过早接流，但不能代替应用自身有界初始化和清晰失败策略。

## 5. 缩小问题而不改变题目

复用同一产物，只改变一个配置或依赖，比较条件与日志；先用最小上下文复现 Bean/绑定问题，再回到完整应用验证。删除全部 Starter 后“能启动”只说明路径被删掉，不表示原问题解决。

已有 startup-lab 覆盖条件退让、绑定与校验、扫描和生命周期；service-lab 验证完整数据/安全应用的实际启动。外部数据库、证书、权限和 Linux 端口问题需对应环境证据。

## 6. 练习与答案

### 6.1 应用端口起来了就算启动成功吗

不一定，后续 Runner 或其他就绪条件仍可能失败。

### 6.2 NoSuchMethodError 先改业务方法吗

先检查运行依赖冲突与实际类来源，编译时和运行时可能不是同一版本。

### 6.3 为什么不直接开 Bean 覆盖

可能掩盖重复配置并让错误实现获胜，应先明确候选来源和选择。

## 7. 参考资料 {/* #7-参考 */}

- [条件与评估报告](../01-startup-configuration/04-自动配置条件与评估报告.md)
- [Boot 故障分析](https://docs.spring.io/spring-boot/reference/features/spring-application.html)
