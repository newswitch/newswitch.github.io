---
title: "Shell SSH 远程执行与批量操作边界"
sidebar_label: "09. SSH 远程执行与批量操作"
sidebar_position: 9
description: "拆解 SSH 本地和远端展开、标准输入、退出码、主机指纹、超时和批量执行边界。"
tags: [Bash, SSH, Remote Execution, 自动化]
---

# Shell SSH 远程执行与批量操作边界

SSH 一行命令可能经历两次 Shell 解析：本地 Shell 先展开，再把字符串交给远端 Shell。引号边界不清时，变量可能在错误的一侧展开，用户输入甚至可能成为远端命令。

## 1. 先区分本地与远端

本地展开：

```bash
local_path=/tmp/report
ssh node01 "printf '%s\n' '$local_path'"
```

远端展开：

```bash
ssh node01 'printf "%s\n" "$HOME"'
```

两者混合时不要不断堆叠转义。更安全的是把固定脚本通过 stdin 传输，把数据作为独立参数传递。

## 2. 通过 stdin 执行固定脚本

```bash
ssh -- node01 bash -s -- "$environment" <<'REMOTE_SCRIPT'
set -Eeuo pipefail
environment=$1
printf 'host=%s environment=%s\n' "$(hostname)" "$environment"
REMOTE_SCRIPT
```

Quoted Here-document 阻止本地展开。参数仍需要在本地调用层正确引用。远端脚本必须被视为代码并进入版本控制，而不是由不可信输入拼接。

## 3. 标准输入冲突

循环中使用 SSH 时，SSH 默认可能读取循环的 stdin：

```bash
while IFS= read -r host; do
  ssh -n -- "$host" 'uptime'
done < hosts.txt
```

`-n` 将 SSH stdin 指向空设备，适合远端命令不需要输入的情况。需要传脚本时则不能同时这样处理，应重新设计文件描述符。

## 4. 连接安全

- 预先建立并管理 `known_hosts`。
- 不通过关闭 Host Key 检查绕过首次连接。
- 使用专用自动化用户和有限 sudo。
- Key、证书和 Token 有独立生命周期。
- 不允许任意目标主机名和 ProxyCommand 来自未经校验的输入。

```bash
ssh -o BatchMode=yes \
    -o ConnectTimeout=5 \
    -o StrictHostKeyChecking=yes \
    -- "$host" 'true'
```

`BatchMode=yes` 防止无人值守任务卡在密码提示，但前提是认证已正确配置。

## 5. 远端退出状态

```bash
if ssh -- "$host" 'systemctl is-active --quiet app'; then
  printf 'target=%s status=active\n' "$host"
else
  rc=$?
  printf 'target=%s ssh_or_command_rc=%d\n' "$host" "$rc" >&2
fi
```

单一退出码可能同时表达 SSH 连接故障和远端命令状态。需要精确分类时，在远端输出受控 JSON 或状态记录，并保留 SSH 客户端诊断。

## 6. 文件传输

根据需求选择：

- `scp`：简单文件复制。
- `sftp`：交互或批处理文件操作。
- `rsync` over SSH：增量同步和属性控制。
- Ansible：多主机幂等配置与受控发布。

传输完成后验证大小、权限和内容摘要。不要把“命令返回 0”当作应用已经加载新配置。

## 7. 批量执行边界

Shell + SSH 适合少量只读检查和明确操作。当出现动态 Inventory、并发批次、提权、幂等、模板、差异、失败阈值和审计要求时，应使用现有的 [Ansible 模块](../ansible/00-Ansible从零到精通学习路线.md)。

## 8. 证据记录

每个目标至少记录：

```text
目标标识
解析后的地址
开始/结束时间
本地脚本版本
远端用户
远端命令版本
退出状态
stdout/stderr 摘要
验收结果
```
