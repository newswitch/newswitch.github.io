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

## 8. 安装与版本固定

```bash
conftest --version
conftest verify --policy policy/
conftest test --policy policy/ examples/
```

本地、Pre-commit 和 CI 使用同一精确版本及校验来源。容器镜像使用 Digest；官方当前镜像为 `openpolicyagent/conftest`，旧 `instrumenta/conftest` 已停止维护。

## 9. Parser 决定 Input Schema

Conftest 会按扩展名推断 Parser，也可显式指定：

```bash
conftest test deployment.yaml --parser yaml
conftest test main.tf --parser hcl2
terraform show -json plan.bin | conftest test - --parser json
```

多文档 YAML、Helm 渲染输出、HCL2 和 Dockerfile 的 Input 结构不同。`--combine` 会改变多个输入如何组合，属于需要单独测试的契约，不应在 CI 中临时添加后沿用原规则。

## 10. Namespace 与入口规则

Conftest 默认查询 `main` Namespace 中的 `deny`/`violation`、`warn` 和 `exception`。可通过配置或 `--namespace` 改变：

```toml
policy = "policy/kubernetes"
namespace = "kubernetes"
```

`package kubernetes.lib` 中的公共函数不会因为目录名就自动成为入口。Package、Namespace 与 CI 参数必须一致。多策略目录会一起加载，同名规则要有兼容的合并语义。

## 11. Failure、Warning、Exception 与退出码

默认 Warning 不让测试失败；启用 `--fail-on-warn` 后：

```text
0：无 Failure/Warning
1：只有 Warning
2：至少一个 Failure
```

CI 不能写成“只有 Exit Code 1 才失败”，否则真实 Failure 的 2 可能被错误处理。Exception 会单独统计，应对异常数量和到期时间做门禁。

## 12. 输出格式

```bash
conftest test rendered.yaml --output=github
conftest test rendered.yaml --output=junit
conftest test rendered.yaml --output=sarif
conftest test rendered.yaml --output=json
```

GitHub/JUnit/SARIF 用于平台展示，JSON 用于二次处理。脚本应解析结构化字段，不解析人类可读文本。违规对象包含稳定 Policy ID 和资源位置，才能生成可靠 Annotation。

## 13. 外部 Data 与共享 Policy

```bash
conftest test -p policy/ -d data/ rendered.yaml
conftest pull oci://registry.example.com/policy/kubernetes:v1.4.0
```

共享 Policy 应固定不可变 Tag/Digest、验证来源并离线缓存，不能在每次 CI 中拉 `latest`。Data 目录也要版本化、Schema 校验，不能包含生产 Secret。

## 14. Trace 限制

`--trace` 只对默认标准输出格式生效；与其他 `--output` 同时使用时，输出格式优先。Trace 体积大且可能包含完整配置，应用最小失败输入在受控环境调试。

## 15. 练习与答案

**问题：规则文件在 `policy/kubernetes/`，为什么 Conftest 仍说零条违规？**

答案：目录不决定查询入口。要检查 Rego `package`、Conftest `namespace`、入口规则名、Parser 生成的 Input 和是否因 Undefined 未产生结果。

**问题：为什么 CI 要检查 Helm 渲染结果而不只检查 values.yaml？**

答案：模板、默认值、Chart 版本和 Values 共同决定最终 Kubernetes 对象；单看 Values 看不到真实容器、权限和网络字段。

参考资料：

- [Conftest options](https://www.conftest.dev/options/)
- [Sharing policies](https://www.conftest.dev/sharing/)
- [Conftest exceptions](https://www.conftest.dev/exceptions/)
