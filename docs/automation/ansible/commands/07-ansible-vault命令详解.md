---
title: "ansible-vault 命令详解"
sidebar_label: "07. ansible-vault 命令详解"
sidebar_position: 7
description: "详解 ansible-vault create、encrypt、decrypt、view、edit、encrypt_string、rekey 与 Vault ID、输出和密码来源。"
tags: [Ansible, ansible-vault, Vault, Secret, CLI]
---

# ansible-vault 命令详解

```text
ansible-vault {create|encrypt|decrypt|view|edit|encrypt_string|rekey} ...
```

Vault 用于加密 Ansible 数据文件，不是动态 Secret 生命周期系统。

## 1. Actions

| Action | 用途 | 主要风险 |
| --- | --- | --- |
| `create` | 在编辑器中新建并加密文件 | 编辑器临时文件/交换文件 |
| `encrypt` | 加密已有文件 | 原文件替换与备份 |
| `decrypt` | 解密并写回/输出 | 明文落盘或终端泄露 |
| `view` | 查看解密内容 | 终端录屏和滚屏历史 |
| `edit` | 临时解密、编辑后重新加密 | 编辑器插件、Crash 和临时文件 |
| `encrypt_string` | 加密单个字符串为变量片段 | Shell 历史、stdin 和复制粘贴 |
| `rekey` | 用新 Vault Secret 重新加密 | 多文件部分成功和旧密钥吊销顺序 |

## 2. 通用认证参数

| 参数 | 含义 |
| --- | --- |
| `--vault-id ID@SOURCE` | Vault 身份，可重复 |
| `-J/--ask-vault-password/--ask-vault-pass` | 交互询问密码 |
| `--vault-password-file/--vault-pass-file` | 密码文件或客户端脚本 |
| `--encrypt-vault-id` | 多个 Vault ID 时指定用于加密的身份 |
| `--new-vault-id` | Rekey 的新身份，具体以子命令帮助为准 |
| `--new-vault-password-file` | Rekey 新密码来源 |
| `--output FILE` | Encrypt/Decrypt 输出；`-` 代表 stdout，容易泄露 |
| `--skip-tty-check` | 允许无 TTY 打开编辑器，自动化中风险高 |
| `-v/--verbose` | 诊断，可叠加 |

每个 Action 支持集不同，执行 `ansible-vault ACTION --help`。

## 3. 安全示例

```bash
umask 077
ansible-vault create --vault-id dev@prompt group_vars/dev/vault.yml
ansible-vault view --vault-id dev@prompt group_vars/dev/vault.yml
ansible-vault rekey \
  --vault-id dev@prompt \
  --new-vault-id dev@/secure/new-client \
  group_vars/dev/vault.yml
```

加密字符串时优先从交互输入读取，不把 Secret 作为命令行位置参数。

## 4. 换密钥流程

```text
备份密文 Artifact
→ 新密钥写入 Secret Manager
→ 对测试文件 Rekey/解密验证
→ 批量 Rekey 并检查全部文件
→ 用新 ID 跑只读 Playbook
→ 更新生产 Credential
→ 吊销旧密钥
```

不要先吊销旧密钥再尝试 Rekey。

## 5. 常见误区

- `decrypt` 后把明文留在工作区。
- Vault 密码文件与密文一起提交。
- 多环境共用一个 Vault 密码。
- 通过 CLI 参数传递明文 Secret。
- 认为 Vault 会自动脱敏 Debug、Diff 和目标日志。
- 编辑器 Swap/Backup 把明文留在磁盘。

## 6. 官方资料

- [`ansible-vault` CLI](https://docs.ansible.com/projects/ansible/latest/cli/ansible-vault.html)
- [Vault 指南](https://docs.ansible.com/ansible/latest/vault_guide/index.html)
