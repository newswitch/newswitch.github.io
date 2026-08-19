---
title: "Jenkins Shared Library、模板与平台接口"
sidebar_label: "06. Shared Library 与模板"
sidebar_position: 6
description: "使用 Shared Library 封装受控流水线能力，治理版本、信任、兼容、测试和弃用。"
tags: [Jenkins, Shared Library, Pipeline Template, Platform Engineering]
---

# Jenkins Shared Library、模板与平台接口

## 1. 目标

Shared Library 提供组织标准能力，例如测试、构建镜像、扫描和部署门禁，不应隐藏全部 Pipeline 使业务无法理解。

## 2. 结构

```text
vars/
src/
resources/
test/
```

公共 Step 输入采用明确 Schema 和安全默认值，复杂逻辑进入普通 Groovy/外部工具并测试。

## 3. 信任

受信 Library 可能绕过 Sandbox 并访问 Controller 能力。只有少数管理员维护，分支保护、评审、签名和发布独立治理。

## 4. 版本

生产 Jenkinsfile 固定已发布版本，不默认跟随主分支。升级提供 Changelog、迁移期和兼容测试。

## 5. 模板边界

平台提供 Golden Path，同时允许业务声明构建命令、资源和验收。高风险动作不能通过任意脚本回调绕过审批。

## 6. 测试

验证参数、Stage 生成、凭据范围、失败/取消/Post 行为，以及在测试 Controller 上的集成兼容。
