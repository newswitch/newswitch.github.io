---
title: "GitLab CI YAML、Stage、Rule 与变量"
sidebar_label: "02. YAML、Stage、Rule 与变量"
sidebar_position: 2
description: "掌握 .gitlab-ci.yml、default、extends、workflow/rules、变量优先级和输入校验。"
tags: [GitLab CI, YAML, Rules, Variables, Pipeline]
---

# GitLab CI YAML、Stage、Rule 与变量

## 1. 最小示例

```yaml
stages: [test, build]

default:
  image: registry.example.invalid/ci/base@sha256:...

test:
  stage: test
  script:
    - ./scripts/test.sh
```

镜像按 Digest 固定；脚本进入仓库并单独测试。

## 2. Workflow 与 Job Rules

`workflow:rules` 决定是否创建 Pipeline，Job `rules` 决定 Job 是否进入该 Pipeline。混用旧式条件和 Rules 容易产生重复 Push/MR Pipeline。

## 3. 变量

变量可能来自 YAML、项目/组、Schedule、Trigger 和手工输入。优先级和扩展行为以当前 GitLab 版本为准，关键配置在 Job 开始时输出来源摘要但不输出 Secret。

## 4. 输入校验

环境、区域、操作类型使用白名单。不能把变量直接拼接为 Shell 命令或文件路径。

## 5. Reuse

`extends`、Anchor 和 Include 可以复用，但多层继承会让最终 Job 难以解释。使用 CI Lint/合并后的配置视图验证实际结果。

## 6. allow_failure

仅对明确非阻断检查使用，并在 UI/指标中保持可见。不要把核心安全扫描和部署验证设为无条件允许失败。
