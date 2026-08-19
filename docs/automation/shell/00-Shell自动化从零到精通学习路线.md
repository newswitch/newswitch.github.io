---
title: "Shell 自动化从零到精通学习路线"
sidebar_label: "00. Shell 自动化学习路线"
sidebar_position: 0
description: "从 Bash 执行模型、展开与引用开始，逐步掌握错误处理、参数接口、原子文件、并发、远程执行、安全、测试和生产发布。"
tags: [Shell, Bash, 自动化, Linux, 脚本, 学习路线]
---

# Shell 自动化从零到精通学习路线

Shell 擅长连接现有 Unix 工具、编排进程和完成短小系统任务。它不擅长复杂数据模型、长期运行状态机和大型并发系统。精通 Shell 的第一步，是知道何时使用它、何时升级为 Python、Go、Ansible 或工作流平台。

```text
输入参数与环境
→ 展开、引用和重定向
→ 调用外部命令
→ 汇总退出状态
→ 清理临时资源
→ 输出机器可读结果
```

## 1. 学习顺序

| 阶段 | 文章 | 完成后的能力 |
| --- | --- | --- |
| 1 | [Bash 执行模型、环境与兼容边界](./01-Bash执行模型环境与兼容边界.md) | 区分 Shell、进程、环境变量、启动文件和 POSIX/Bash 边界 |
| 2 | [变量、引用、展开与数组](./02-变量引用展开与数组.md) | 避免单词分割、通配符和空值造成的参数错误 |
| 3 | [条件、循环、函数与数据流](./03-条件循环函数与数据流.md) | 写出边界明确、返回值稳定的控制结构 |
| 4 | [重定向、管道、子 Shell 与进程替换](./04-重定向管道子Shell与进程替换.md) | 正确控制文件描述符、管道状态和作用域 |
| 5 | [错误处理、Trap、信号与资源清理](./05-错误处理Trap信号与资源清理.md) | 设计可预测的失败、退出和清理路径 |
| 6 | [参数、配置、日志与退出码接口](./06-参数配置日志与退出码接口.md) | 把脚本变成能被人和平台稳定调用的 CLI |
| 7 | [临时文件、文件锁与原子更新](./07-临时文件文件锁与原子更新.md) | 安全修改配置并防止并发实例互相覆盖 |
| 8 | [进程、并发、超时与任务收敛](./08-进程并发超时与任务收敛.md) | 限制并发、收集子进程状态并停止失败扩散 |
| 9 | [SSH 远程执行与批量操作边界](./09-SSH远程执行与批量操作边界.md) | 控制本地/远端展开、标准输入和退出状态 |
| 10 | [输入、权限、Secret 与注入防护](./10-输入权限Secret与注入防护.md) | 防止命令注入、路径攻击和敏感信息泄露 |
| 11 | [ShellCheck、shfmt、Bats 与测试](./11-ShellCheck-shfmt-Bats与测试.md) | 建立静态检查、格式、单元和集成测试 |
| 12 | [安全配置发布综合项目](./12-安全配置发布综合项目.md) | 完成带锁、校验、备份、原子切换、验收和回退的项目 |

## 2. 与命令参考库的关系

本模块讲脚本工程和命令组合语义。单命令的完整参数继续查阅：

- [Shell、帮助与安全自动化命令导读](../../linux/commands/00-shell-help-automation/00-Shell帮助与安全自动化命令导读.md)
- [文件与目录命令](../../linux/commands/01-files-directories/00-文件与目录命令导读.md)
- [文件内容与文本处理命令](../../linux/commands/02-file-content-text/00-文件内容与文本处理命令导读.md)
- [进程、信号与作业控制](../../linux/commands/04-processes-signals/00-进程线程作业与信号命令导读.md)

不要在工程文章中复制所有参数，也不要只会查参数却不知道命令组合后的失败语义。

## 3. 何时不再使用 Shell

出现以下情况时，应评估迁移：

- 需要解析复杂 JSON/YAML 并维持 Schema。
- 需要大型数据结构和复杂业务规则。
- 需要可取消的高并发任务图。
- 需要长时间运行、服务发现和健康检查。
- 需要跨平台一致行为。
- 测试中大量依赖替换外部命令。

通常：短小系统编排用 Shell；复杂 API 工具用 Python；长时间运行和高并发用 Go；多主机状态收敛用 Ansible。

## 4. 推荐脚本骨架

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

readonly PROGRAM=${0##*/}

log() {
  printf '%s level=info program=%q message=%q\n' \
    "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$PROGRAM" "$*" >&2
}

cleanup() {
  : # 只清理本脚本确认创建的资源
}
trap cleanup EXIT

main() {
  log "start"
}

main "$@"
```

`set -e` 有复杂例外，严格模式不是正确性的证明。每篇文章会解释其中的边界。

## 5. 掌握标准

- [ ] 能解释参数展开、命令替换、单词分割和路径名展开的顺序影响。
- [ ] 所有可能包含空格或通配符的数据都按参数边界传递。
- [ ] 能说明每个命令失败后脚本是否继续。
- [ ] Trap 不覆盖原退出码，也不会删除不属于本次运行的路径。
- [ ] 临时文件权限正确，配置发布经过校验和原子切换。
- [ ] 并发有上限，所有子进程都被 Wait 和收敛。
- [ ] SSH 命令明确区分本地展开和远端展开。
- [ ] Secret 不出现在命令行、调试追踪和日志。
- [ ] 脚本通过 ShellCheck、格式检查和失败路径测试。

## 6. 官方资料

- [GNU Bash Manual](https://www.gnu.org/software/bash/manual/bash.html)
- [POSIX Shell Command Language](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html)
- [ShellCheck](https://www.shellcheck.net/)
- [Bats Core](https://bats-core.readthedocs.io/)
