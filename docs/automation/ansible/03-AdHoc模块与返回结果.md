---
title: "Ansible Ad-hoc 命令、模块与返回结果"
sidebar_label: "03. Ad-hoc、模块与返回结果"
sidebar_position: 3
description: "从单任务执行理解 FQCN、模块状态语义、command 与 shell 边界、异步任务及结构化返回。"
tags: [Ansible, Ad-hoc, Module, FQCN, 幂等]
---

# Ansible Ad-hoc 命令、模块与返回结果

Ad-hoc 命令适合一次性检查和受控操作，也是理解模块的最短路径。需要审查、复跑和协作的操作应尽快转为 Playbook。

## 1. 基本结构

```bash
ansible <pattern> -i <inventory> \
  -m <collection.module> -a '<arguments>'
```

例如只读采集服务状态：

```bash
ansible web -i inventories/lab/hosts.yml \
  -m ansible.builtin.service_facts
```

显式使用 FQCN（Fully Qualified Collection Name）可以避免同名模块冲突，并让依赖来源可审计。

## 2. 常用内置模块

| 目标 | 首选模块 | 不推荐替代 |
| --- | --- | --- |
| 软件包状态 | `package`、`apt`、`dnf` | `shell: apt install ...` |
| 文件/目录属性 | `file` | `command: chmod/chown` |
| 文件分发 | `copy`、`template` | `scp` 后手工修改 |
| 服务状态 | `systemd_service`、`service` | `shell: systemctl ...` |
| 用户与组 | `user`、`group` | `useradd` 字符串 |
| 仓库内容 | `git` | `shell: git clone` |
| 归档 | `unarchive`、`archive` | 多段 tar 命令 |
| API | `uri` | `shell: curl` |
| 等待条件 | `wait_for` | 固定 `sleep` |

先用 `ansible-doc` 阅读参数、属性和返回值：

```bash
ansible-doc ansible.builtin.systemd_service
ansible-doc -s ansible.builtin.template
```

## 3. `command`、`shell` 与 `raw`

```text
有专用模块 → 使用专用模块
只需执行程序，不需要管道/重定向 → command
确实依赖 Shell 语法 → shell
目标没有 Python，需要引导 → raw
```

`command` 不经过 Shell，减少注入和转义问题：

```yaml
- name: Validate configuration
  ansible.builtin.command:
    argv:
      - /usr/sbin/nginx
      - -t
      - -c
      - /etc/nginx/nginx.conf
  changed_when: false
```

使用 `argv` 避免手工拼接包含空格的参数。若命令支持 `creates`、`removes` 等守卫，可以改善幂等，但仍不如专用模块完整。

`shell` 的变量必须引用并过滤：

```yaml
- name: Example requiring a pipeline
  ansible.builtin.shell: >-
    set -o pipefail &&
    journalctl -u {{ service_name | quote }} --since '10 minutes ago' |
    tail -n 100
  args:
    executable: /bin/bash
  changed_when: false
```

不要把不可信输入拼进 Shell。

## 4. 返回结果契约

注册任务结果：

```yaml
- name: Read kernel release
  ansible.builtin.command: uname -r
  register: kernel_release
  changed_when: false
```

常见字段：

| 字段 | 含义 |
| --- | --- |
| `changed` | 模块认为是否改变了状态 |
| `failed` | 任务是否失败 |
| `msg` | 人类可读摘要 |
| `rc` | 命令退出码，部分模块没有 |
| `stdout` / `stderr` | 命令输出 |
| `stdout_lines` | 按行拆分的输出 |
| `results` | 循环中每个 Item 的结果 |
| `diff` | 启用 Diff 且模块支持时的差异 |

字段由模块定义，使用前通过 `ansible-doc` 的 RETURN 部分确认。不要假定所有模块都有 `rc` 或 `stdout`。

## 5. `changed_when` 与 `failed_when`

它们用于纠正外部程序的状态语义，不应掩盖错误：

```yaml
- name: Check application health
  ansible.builtin.command: /opt/app/bin/healthcheck
  register: health
  changed_when: false
  failed_when:
    - health.rc != 0
    - "'warming up' not in health.stderr"
```

如果每个任务都需要复杂的 `changed_when`，说明应编写模块、封装 Role 或改用具有状态语义的接口。

## 6. Check 与 Diff

```bash
ansible web -m ansible.builtin.file \
  -a 'path=/srv/app state=directory mode=0750' --check --diff
```

Check Mode 是模块对变化的预测：

- 模块必须声明并实现相应支持；
- 外部系统状态可能在执行前变化；
- 命令和自定义逻辑可能无法预测；
- 它不验证重启后服务一定健康。

所以它是门禁的一层，不是完整演练。

## 7. 异步任务

长任务可以后台执行并轮询：

```bash
ansible workers -B 1800 -P 15 \
  -m ansible.builtin.command -a '/opt/jobs/rebuild-index'
```

`-B` 是允许运行的最长秒数，`-P` 是轮询间隔。`-P 0` 表示触发后不等待，需要保存 Job ID 并用 `async_status` 追踪。异步不等于可重入，重试前必须确认远端任务状态。

## 8. 安全的 Ad-hoc 顺序

```text
ansible-inventory --graph
→ ansible <pattern> --list-hosts
→ 只读模块
→ --check --diff
→ --limit 单台 Canary
→ 执行变更
→ 独立验收
→ 转为版本化 Playbook
```

## 9. 常见误区

- 使用 `all`，不先 `--list-hosts`。
- 为了方便关闭 Host Key 检查。
- 使用 `shell` 代替所有模块。
- 认为退出码 0 就等于业务健康。
- 把 `ignore_errors: true` 当错误处理。
- 在命令行 `-e password=...` 暴露 Secret。
- 使用 `-vvvv` 后把含敏感信息的完整日志公开。

## 10. 实验

1. 使用 `package_facts`、`service_facts` 和 `setup` 做只读采集。
2. 用 `file` 创建目录并重复执行，确认第二次 `changed=false`。
3. 用 `command argv` 执行配置校验。
4. 故意使用错误参数，通过 RETURN 和 `-vvv` 定位失败层。
5. 将一组稳定的 Ad-hoc 操作改写为 Playbook。

## 11. 官方资料

- [Ad-hoc 命令介绍](https://docs.ansible.com/ansible/latest/command_guide/intro_adhoc.html)
- [模块与插件索引](https://docs.ansible.com/ansible/latest/collections/index.html)
- [通用返回值](https://docs.ansible.com/ansible/latest/reference_appendices/common_return_values.html)
