---
title: "ansible.cfg、并发与大规模执行性能"
sidebar_label: "11. ansible.cfg、并发与性能"
sidebar_position: 11
description: "理解配置搜索与来源、forks、SSH 复用、pipelining、strategy、fact cache 和性能测量，安全扩展到大规模主机。"
tags: [Ansible, ansible.cfg, Forks, SSH, 性能优化]
---

# ansible.cfg、并发与大规模执行性能

Ansible 变慢可能发生在 Inventory API、控制端 CPU、SSH 建连、模块传输、目标 Python、包管理器或外部服务。先分层测量，再调整并发。

## 1. 配置来源

```bash
ansible --version
ansible-config view
ansible-config dump --only-changed
ansible-config list
```

`ansible --version` 会显示实际配置文件路径。执行证据必须保存该输出，因为同一仓库在不同目录运行可能读取不同配置。

配置通常可来自配置文件、环境变量、CLI、Play/变量和插件参数。`ansible-config dump --only-changed` 用于查看偏离默认值的最终配置及来源提示。

## 2. 性能分解

```text
总耗时 ≈ Inventory 解析
       + Playbook/模板解析
       + 连接建立与认证
       + 模块打包/传输/启动
       + 目标任务执行
       + 串行/批次等待
       + Callback 与日志 I/O
```

为任务记录 `duration`、每主机延迟、失败/重试和控制端 CPU/内存。只看总时间无法判断瓶颈。

## 3. Forks

`forks` 是控制节点并发进程上限，默认值通常较保守。提高它会同时增加：

- 控制端 CPU、内存和文件描述符。
- SSH 连接与跳板机压力。
- 目标主机并发。
- DNS、包仓库、API 和日志系统压力。

逐级压测 5、10、20、50 等并发，观察吞吐和错误拐点。不要直接按主机数设置 Forks。

## 4. SSH 连接复用

```ini
[ssh_connection]
ssh_args = -o ControlMaster=auto -o ControlPersist=60s
pipelining = True
```

ControlPersist 减少重复握手。控制套接字路径要避免过长、冲突和不安全目录。Pipelining 减少部分模块文件传输/命令次数，但可能与需要 TTY 的 sudo 策略冲突，启用前在目标系统测试。

不要通过关闭 Host Key 检查“优化”连接。

## 5. Strategy、Serial 与 Throttle

```text
forks：控制端全局并发容量
serial：当前 Play 每批主机数
throttle：指定 Task/Block 的并发上限
strategy：主机和任务推进算法
```

外部 API 只能承受 2 个并发时：

```yaml
- name: Update rate-limited external service
  ansible.builtin.uri:
    url: "{{ api_url }}"
    method: POST
  throttle: 2
```

不要为了总体速度让脆弱的共享服务承受全部 Forks。

## 6. Facts 与缓存

优化方式：

- 不需要 Facts 的 Play 设置 `gather_facts: false`。
- 只采集所需 Subset。
- 合理使用 Fact Cache 和 TTL。
- OS 检测结果改变时主动刷新。

缓存提高速度但会用陈旧换取性能，不能用于强一致发布判断。

## 7. 模块选择与循环

低效模式：

```yaml
- package:
    name: "{{ item }}"
    state: present
  loop: "{{ packages }}"
```

如果模块支持列表，改为一次调用：

```yaml
- ansible.builtin.package:
    name: "{{ packages }}"
    state: present
```

减少远程往返往往比增加 Forks 更有效。包管理器自身有锁，针对同一主机并发执行包任务只会制造冲突。

## 8. Async

异步适合远端长任务，使控制端不保持阻塞连接。它不能提升任务本身速度，也不会自动保证作业唯一性。保存 Job ID、设置最长运行时间、轮询并处理控制节点重启后的状态。

## 9. Callback 与输出

高详细度、完整 Diff 和同步写远程日志可能成为控制端瓶颈。生产 Callback 应：

- 使用结构化事件和稳定 Schema。
- 异步或批量发送，但不能静默丢失关键失败。
- 脱敏参数和 Diff。
- 对日志后端故障定义降级策略。
- 保留本地最小证据。

## 10. 大规模分片

当规模超过单控制节点安全容量时，可按区域/故障域分片作业，但必须避免两个控制器同时修改同一对象。AWX Instance Group/容器化执行节点可以扩展执行能力；共享状态仍需要锁、幂等键或平台级排他控制。

## 11. 性能实验

固定 Playbook、Inventory 快照和网络条件，测量：

| 变量 | 指标 |
| --- | --- |
| Forks | 总耗时、失败率、控制端 RSS/CPU |
| ControlPersist | 新建连接数、SSH 阶段耗时 |
| Pipelining | 每 Task 延迟、sudo 兼容失败 |
| Facts Subset | Gather 时间和数据完整性 |
| Callback | 控制端 I/O 和日志丢失 |
| Batch Size | 剩余容量、业务 SLO 和完成时间 |

## 12. 常见反模式

- 只增加 Forks，不观察下游限流。
- 开启 Fact Cache 却没有 TTL。
- 所有 Task 都使用循环逐项远程调用。
- 使用 `free` Strategy 破坏跨主机顺序。
- 在共享控制节点使用来源不明的 `ansible.cfg`。
- 将调试 Verbosity 长期开到 `-vvvv`。

## 13. 掌握标准

- [ ] 能显示每个非默认配置的来源。
- [ ] 性能报告按阶段和 Task 分解。
- [ ] Forks、Serial 和 Throttle 分别有容量依据。
- [ ] SSH 复用没有降低身份校验安全性。
- [ ] 缓存有 TTL、刷新和陈旧数据处理策略。
- [ ] 多执行节点不会并发修改同一目标。

## 14. 官方资料

- [Ansible 配置](https://docs.ansible.com/ansible/latest/installation_guide/intro_configuration.html)
- [性能策略](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_strategies.html)
- [异步操作](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_async.html)
