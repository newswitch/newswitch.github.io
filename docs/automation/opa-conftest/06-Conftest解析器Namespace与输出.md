---
title: "Conftest 解析器、Namespace 与输出"
sidebar_label: "06. Conftest 配置检查"
sidebar_position: 6
description: "使用 Conftest 将 YAML、JSON、HCL 等配置转换为 Input，组织 Namespace、Data、输出和本地 CI 检查。"
tags: [Conftest, OPA, Rego, 配置检查, CI]
---

# Conftest 解析器、Namespace 与输出

## 1. Conftest 的位置

```text
配置/IaC/渲染清单
→ Conftest Parser 转换为结构化 Input
→ 加载 Rego Policy 与 Data
→ 查询指定 Namespace
→ 输出 Failure、Warning、Success
→ Shell/CI 根据退出码执行门禁
```

它适合 Shift Left，但不是持续准入控制器。文件通过后仍可能在部署时被替换、变异或手工修改，生产需配合集群 Admission/漂移检测。

## 2. 先观察实际 Input

不同 Parser 对多文档 YAML、HCL、Dockerfile 和 Terraform Plan 的结构不同。写规则前先生成/查看解析后的 JSON，固定 Conftest 版本并保留代表性样本，不凭原文件视觉结构猜测 `input` 路径。

## 3. Namespace 组织

```text
policy/
├── main/
├── kubernetes/
├── terraform/
└── dockerfile/
```

按输入 Schema 和技术栈划分 Package/Namespace，避免一套规则对任何文件都运行。公共函数放入明确库 Package，不产生意外 `deny` 入口。

## 4. Failure、Warning 与 Exception

- Failure：核心安全/合规，必须阻断；
- Warning：成本、规范或迁移阶段问题；
- Exception：带 Owner、范围、原因和到期时间的结构化数据。

规则输出包含稳定 ID、资源定位、原因和修复建议。不要只输出“policy failed”。

## 5. 数据与 Secret

Conftest 可加载外部 Data，但不得把生产 Secret 作为普通文件传入策略或上传到 CI Artifact。允许列表和组织元数据进入版本化、经过评审的数据文件。

## 6. 本地到 CI

开发者使用与 CI 相同的工具容器/锁定版本运行。CI 检查最终渲染产物，而不只检查模板源码；Helm/Kustomize/Terraform 的变量会改变最终 Input。

## 7. 排障

没有规则命中时依次检查 Parser、实际 Input、Namespace、Package、Query 和 Undefined；不要立即把 `deny` 改成全局匹配。输出 JSON 并查询中间规则能更快定位。
