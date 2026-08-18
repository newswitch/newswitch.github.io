---
title: "Ansible Vault、Become 与 Secret 治理"
sidebar_label: "08. Vault、Become 与 Secret 治理"
sidebar_position: 8
description: "区分数据加密、身份认证和权限提升，设计 Vault ID、外部 Secret、最小 sudo、日志脱敏与凭据轮换。"
tags: [Ansible, Vault, Become, Secret, 安全]
---

# Ansible Vault、Become 与 Secret 治理

Vault、SSH 和 Become 解决三个不同问题：

```text
Vault：仓库或文件中的敏感数据如何加密
SSH/API Credential：控制端如何证明连接身份
Become：登录后如何切换到更高或其他权限
```

把它们混为“一个密码”会造成共享凭据、无法审计和过度授权。

## 1. Vault 能保护什么

Vault 可以加密整个文件或单个变量，适合需要随代码版本化但不能明文保存的数据。它保护静态密文，不自动解决：

- 谁可以获得解密密码。
- 解密后的值是否进入内存、日志或目标文件。
- Secret 的轮换、吊销和访问审计。
- 外部系统中的长期凭据生命周期。

高频轮换和动态凭据更适合由 Vault 类 Secret Manager、云 KMS/Secrets 服务或 AWX Credential Plugin 在运行时获取。

## 2. Vault ID

不同环境使用不同身份：

```bash
ansible-vault encrypt \
  --vault-id dev@prompt inventories/dev/group_vars/all/vault.yml

ansible-vault encrypt \
  --vault-id prod@/secure/path/prod-password-client \
  inventories/production/group_vars/all/vault.yml
```

执行时可以提供多个 Vault ID：

```bash
ansible-playbook site.yml \
  --vault-id dev@prompt \
  --vault-id prod@/secure/path/prod-password-client
```

密码客户端脚本必须权限受控、输出仅包含密码，并从经过认证的 Secret 系统获取；脚本本身不能硬编码密钥。

## 3. 变量命名与分离

```yaml
# group_vars/production.yml
database_user: app
database_password: "{{ vault_database_password }}"

# group_vars/vault.yml（加密）
vault_database_password: "..."
```

这样非敏感结构可以审查，密文可以独立轮换。变量名也让调用点显式显示这是敏感输入。

## 4. SSH 身份

优先级建议：

1. 每个自动化系统独立的短期证书或密钥。
2. SSH Agent/受控 Credential 注入。
3. 权限受控的专用私钥文件。
4. 密码认证只在无法使用密钥时采用。

不要把私钥放进 Git，即使它又被 Vault 加密。长期私钥的复制、解密和落盘面过大。Host Key 校验用于验证服务器身份，与客户端私钥认证不是一回事。

## 5. Become

```yaml
- hosts: web
  become: true
  become_method: sudo
  become_user: root
```

安全边界：

- 默认以普通用户连接。
- 只在需要的 Play/Block/Task 提权。
- sudoers 限制来源用户和允许命令，但要注意允许编辑文件或执行解释器可能等价于完整 root。
- 不在命令行直接输入密码，避免历史和进程信息泄露。
- AWX/AAP 中将连接凭据和 Become 凭据作为受控 Credential。

`become_user` 不会自动启用 Become，必须同时配置 `become: true`。

## 6. 日志与 Diff 泄露面

Secret 可能出现在：

```text
CLI 参数和 Shell 历史
Ansible Verbose 输出
模块调用参数
register/debug
--diff 内容
目标进程 argv 和环境变量
临时文件、备份文件
Callback/日志平台
CI Artifact
外部 API 审计日志
```

使用模块原生 Secret 参数，并在最小范围设置 `no_log: true`。同时对 Callback、Artifact 保留时间和访问权限进行治理。

## 7. 目标端 Secret 发布

```yaml
- name: Publish application secret file
  ansible.builtin.template:
    src: app-secret.env.j2
    dest: /etc/app/secret.env
    owner: root
    group: app
    mode: "0640"
    backup: false
  no_log: true
  diff: false
```

检查：

- 父目录权限。
- 备份是否留下旧 Secret。
- 服务用户最小读取权限。
- 轮换时旧进程和连接何时失效。
- 临时路径、Core Dump 和诊断包是否包含内容。

## 8. Secret 轮换流程

```text
创建新凭据
→ 双凭据/双证书兼容窗口
→ Canary 发布消费者
→ 验证认证和业务指标
→ 扩大发布
→ 吊销旧凭据
→ 验证旧凭据不可用
→ 清理旧密文和备份
```

直接覆盖 Secret 并重启所有节点会同时放大发布和认证风险。

## 9. 常见误区

- Vault 密文提交到 Git 就等于完整 Secret 管理。
- 所有环境使用同一个 Vault 密码。
- 将 Vault 密码文件放在项目目录并提交。
- `no_log` 后认为外部系统不会记录 Secret。
- 为省事给自动化用户 `NOPASSWD: ALL`。
- 把 SSH Host Key 检查关闭来解决首次连接。
- 在错误信息里拼接完整 API 响应。

## 10. 实验与验收

1. 创建 Dev/Prod 两个 Vault ID，证明无法互相解密。
2. 用密码客户端从环境外部读取测试 Secret。
3. 检查 `-vvvv`、Diff 和 Artifact 是否出现 Secret。
4. 只给自动化用户一个受控 sudo 动作，验证越权失败。
5. 模拟双凭据轮换与旧凭据吊销。

- [ ] 连接、解密和 Become 使用不同身份边界。
- [ ] 生产 Vault 密码不在代码仓库和项目目录。
- [ ] Secret 不进入 CLI、Debug、Diff 和长期 Artifact。
- [ ] 目标文件、备份和临时文件权限经过验证。
- [ ] 轮换包含吊销和旧凭据失效验证。

## 11. 官方资料

- [Ansible Vault](https://docs.ansible.com/ansible/latest/vault_guide/index.html)
- [Become](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_privilege_escalation.html)
- [保护敏感数据](https://docs.ansible.com/ansible/latest/tips_tricks/ansible_tips_tricks.html#keep-vaulted-variables-safely-visible)
