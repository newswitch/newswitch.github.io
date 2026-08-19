---
title: "ShellCheck、shfmt、Bats 与 Shell 测试"
sidebar_label: "11. ShellCheck、shfmt、Bats 与测试"
sidebar_position: 11
description: "使用语法检查、静态分析、统一格式、函数测试、命令替身、集成测试和故障注入验证 Shell 自动化。"
tags: [ShellCheck, shfmt, Bats, Test, CI]
---

# ShellCheck、shfmt、Bats 与 Shell 测试

Shell 脚本不能因为只有几十行就跳过测试。它通常直接操作文件、服务和远端主机，失败影响可能比普通业务代码更大。

## 1. 测试金字塔

```text
语法与静态检查
→ 纯函数和参数测试
→ 外部命令边界测试
→ 隔离环境集成测试
→ 故障注入
→ 测试主机端到端验收
```

## 2. 语法检查

```bash
bash -n scripts/deploy.sh
```

它只能发现语法问题，不会验证变量引用、命令状态和业务逻辑。

## 3. ShellCheck

```bash
shellcheck scripts/*.sh
```

ShellCheck 可以发现常见引用、数组、管道、Source 和可移植性问题。抑制规则前要理解原因，并尽量限定到最小位置：

```bash
# shellcheck disable=SC1091  # 说明为什么运行时路径无法静态解析
source "$runtime_library"
```

静态分析通过不代表脚本安全，尤其不能证明外部命令幂等和远端状态正确。

## 4. shfmt

```bash
shfmt -d scripts/
shfmt -w scripts/
```

团队固定格式参数和版本。格式化与行为修改最好分开提交，降低 Review 噪声。

## 5. 使用 Bats 测试接口

示例：

```bash
#!/usr/bin/env bats

@test "missing environment returns usage error" {
  run ./scripts/deploy.sh
  [ "$status" -eq 2 ]
  [[ "$output" == *"environment is required"* ]]
}
```

测试公共行为：参数、退出码、stdout/stderr、文件结果和副作用，而不是只测试内部实现。

## 6. 替换外部命令

可以为测试创建临时 `PATH`，放入同名测试替身：

```text
test-bin/
├── curl
├── systemctl
└── ssh
```

测试替身记录参数并返回预设状态。必须确保测试不会意外落到真实系统命令，且生产环境不会加载测试目录。

更容易测试的结构：

```bash
systemctl_cmd=${SYSTEMCTL_CMD:-systemctl}
"$systemctl_cmd" is-active --quiet "$service"
```

命令路径覆盖本身也是接口，应限制只在测试环境使用，防止生产命令劫持。

## 7. 隔离集成测试

可选择临时容器或虚拟机，但要验证：

- 目标发行版和 Bash 版本。
- systemd、权限、SELinux 等是否真实存在。
- 容器测试没有掩盖主机级差异。
- 测试结束能够完整清理。

高风险系统修改不应在共享 CI Runner 主机直接执行。

## 8. 故障注入矩阵

| 故障 | 期望 |
| --- | --- |
| 配置缺失 | 返回参数/配置错误，不产生写入 |
| 校验命令失败 | 正式文件不变 |
| 磁盘满 | 不留下半配置 |
| 锁已占用 | 明确退出，不并发执行 |
| 服务 Reload 失败 | 恢复旧配置并报告 |
| 收到 TERM | 停止新动作，清理并保留状态 |
| 一个远端失败 | 按阈值停止或报告部分成功 |

## 9. CI 门禁

```bash
bash -n scripts/*.sh
shellcheck scripts/*.sh
shfmt -d scripts/
bats tests/
```

此外验证脚本可执行位、Shebang、依赖清单和目标环境矩阵。
