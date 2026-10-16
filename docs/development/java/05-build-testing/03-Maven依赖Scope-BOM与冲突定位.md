---
title: "Maven 依赖解析、Scope、BOM 与冲突定位"
sidebar_label: "03. Maven 依赖、Scope、BOM 与冲突"
sidebar_position: 3
description: "理解直接与传递依赖、最近路径仲裁、dependencyManagement、BOM 导入、Scope 与 optional，建立从依赖树到实际运行产物的诊断方法。"
tags: [Java, Maven, 依赖冲突, BOM, Classpath]
---

# Maven 依赖解析、Scope、BOM 与冲突定位

源码可以编译，运行却出现 NoSuchMethodError，常见原因不是少写 import，而是实际装载的类与编译时使用的版本不一致。依赖问题要同时看声明、解析结果、打包结果与运行环境。

本篇按 Maven 3.9.14 解释行为，使用[构建实验工程](./02-Maven生命周期插件与集成测试.md)的 JUnit BOM 作为可执行观察对象。

## 1. 坐标与依赖图

groupId、artifactId、version 标识常用制品坐标，type/classifier 进一步区分 POM、测试归档或平台变体等。相同 Java 包名不意味着同一个 Maven 制品，不同制品也可能带入重复类。

```text
应用
├── 库 A → 公共库 1.0
└── 库 B → 公共库 2.0
```

这是假设的依赖图，用来说明版本仲裁，不是配套工程的真实输出。Maven 默认采用最近定义等仲裁规则；相同深度通常受声明顺序影响，不是总选最大版本。直接声明可以让某个版本更近，dependencyManagement 又可以统一管理相应依赖版本。[依赖机制文档](https://maven.apache.org/guides/introduction/introduction-to-dependency-mechanism.html)给出这些规则。

仲裁选出一个版本，不代表该版本满足所有调用方。旧库调用新库已删除方法，或新库调用旧版本不存在方法，都可能在运行时失败。

## 2. Scope 控制哪些 Classpath

| Scope | 应用编译 | 测试 | 普通运行依赖 | 典型边界 |
| --- | --- | --- | --- | --- |
| compile | 有 | 有 | 有 | 默认，参与传递 |
| provided | 有 | 有 | 通常无 | 预期由外部运行环境提供 |
| runtime | 无 | 有 | 有 | 运行实现、部分驱动 |
| test | 无 | 有 | 无 | 测试工具，不向消费者传递为正常依赖 |
| import | 不按普通 JAR 处理 | 不按普通 JAR 处理 | 不按普通 JAR 处理 | 仅用于 dependencyManagement 中导入 POM |

Scope 不等于打包插件最终一定包含或排除哪些字节，最终还要检查产物。system 依赖绑定本机路径，破坏可移植性，普通工程不要用它绕过仓库管理。

optional 表示消费者通常不会自动获得该传递依赖，不表示当前工程自己不需要它。exclusions 在特定依赖边上排除传递项，也不保证其他路径不会再引入相同制品。

## 3. BOM 做了什么

build-lab 的 dependencyManagement 导入 junit-bom 6.0.3，dependencies 再声明 junit-jupiter，省略版本。这使相关 API、引擎等获得相应管理版本。

```text
dependencyManagement / BOM → 提供版本管理规则
dependencies              → 真正引入项目所需依赖
pluginManagement          → 管理构建插件，不是普通依赖 BOM
```

BOM 不是下载所有库的清单，也不自动创建插件执行。多个 BOM 重叠、子 POM 显式版本和管理层覆盖时，需要看 effective POM 与最终依赖树，不能只凭文件位置猜测胜出项。

## 4. 实际观察命令

在 build-lab 目录执行固定版本的诊断插件：

```bash
mvn -B org.apache.maven.plugins:maven-dependency-plugin:3.8.1:tree -Dincludes=org.junit.jupiter
mvn -B org.apache.maven.plugins:maven-help-plugin:3.5.1:effective-pom -Dverbose
```

依赖树中应能看到以下条目的测试 Scope；其他输出不是逐字固定：

```text
org.junit.jupiter:junit-jupiter:jar:6.0.3:test
org.junit.jupiter:junit-jupiter-api:jar:6.0.3:test
org.junit.jupiter:junit-jupiter-params:jar:6.0.3:test
org.junit.jupiter:junit-jupiter-engine:jar:6.0.3:test
```

effective-pom 展示合并父 POM、管理规则和活动配置后的模型。它帮助确定版本来源，不证明运行容器里没有别人手动放置的 JAR。

需要真实运行 Classpath 时，可观察相应 Scope 的解析结果，再与启动脚本、容器层和 JAR 内容核对。不要公开包含凭据的 settings、仓库 URL 或完整敏感环境变量。

## 5. 从异常反推检查位置

| 现象 | 优先检查 |
| --- | --- |
| 编译找不到包 | 依赖是否引入、Scope 是否参与编译 |
| ClassNotFoundException | 运行 Classpath 和加载器搜索路径 |
| NoClassDefFoundError | 缺失定义，也可能是类初始化曾失败，必须看原因链 |
| NoSuchMethodError | 实际加载类版本是否具有所调用签名 |
| 重复类或不同行为 | 不同制品、容器共享库、嵌套归档与类加载器顺序 |

可用 `java -Xlog:class+load=info ...` 观察类加载来源。日志量可能很大，应在可控环境限定采集。定位到实际来源后，再决定排除、直接约束、升级兼容库或修正分发方式。

## 6. 管理冲突不只是让树变干净

统一版本后应运行功能与集成测试，确认消费者兼容。Maven Enforcer 的依赖收敛或上界检查可以作为构建约束，但不同规则解决不同问题，不提供行为兼容证明。

避免动态范围、随意 SNAPSHOT 和只在某台机器可用的镜像。远程仓库与本地缓存也应明确区分：install 写入本地仓库，不等于其他构建节点能获取。依赖校验、制品签名与供应链控制是另一层保障，不能靠清空整个缓存来代替定位。

## 7. 练习与答案

### 7.1 导入数据库 BOM 后，为什么驱动仍找不到

BOM 只管理版本，仍需在 dependencies 中声明实际驱动，并选择正确 Scope 和运行分发方式。

### 7.2 依赖树只显示一个版本，为何还会 NoSuchMethodError

树只描述当前 Maven 解析结果。实际环境可能有旧 JAR、容器共享库或重复类；还可能选中版本本身不兼容。检查类加载来源和最终运行产物。

### 7.3 provided 是否意味着依赖不存在也没关系

不是。它表达由运行环境提供的约定，环境没有提供就可能失败。必须把提供者、版本和发布边界说清楚。

## 8. 继续阅读

- [Maven Dependency Plugin](https://maven.apache.org/plugins/maven-dependency-plugin/tree-mojo.html)
- [Maven Enforcer 依赖收敛](https://maven.apache.org/enforcer/enforcer-rules/dependencyConvergence.html)
- [JUnit 参数化测试与隔离](./04-JUnit参数化测试隔离与测试边界.md)
