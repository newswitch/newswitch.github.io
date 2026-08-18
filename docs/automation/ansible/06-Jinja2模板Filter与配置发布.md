---
title: "Ansible Jinja2 模板、Filter 与配置发布"
sidebar_label: "06. Jinja2、Filter 与配置发布"
sidebar_position: 6
description: "从控制端模板渲染、严格变量、Filter、校验、原子替换和敏感 Diff 出发，建立安全配置发布流程。"
tags: [Ansible, Jinja2, Template, Filter, 配置管理]
---

# Ansible Jinja2 模板、Filter 与配置发布

模板的任务不是把字符串写入文件，而是把经过验证的数据确定性地编译成目标配置，并在替换前由目标程序验证。

## 1. 渲染发生在哪里

Jinja2 表达式主要在控制节点求值，使用该 Inventory Host 的变量上下文；`template` 模块再把结果传到目标端。目标端通常不需要安装 Jinja2。

```text
Variables + Facts + Template
→ 控制端渲染候选内容
→ 传到目标临时路径
→ validate 调用目标程序校验
→ 原子替换目标文件
→ changed 通知 Handler
→ 服务加载后健康检查
```

## 2. 一个可读模板

```jinja2
# Managed by Ansible. Deployment: {{ deployment_id }}
listen_address = {{ app_listen_address | to_json }}
listen_port = {{ app_port }}
worker_count = {{ app_workers }}

{% for peer in app_peers | sort(attribute='name') %}
peer {{ peer.name }} {
  address = {{ peer.address | to_json }}
  weight = {{ peer.weight }}
}
{% endfor %}
```

原则：

- 复杂数据计算在 Vars/Filter 中完成，模板只负责表现。
- 对无序集合排序，确保相同输入产生相同输出。
- 根据目标配置语法正确转义，而不是默认字符串可直接拼接。
- 避免把生成时间写入文件，否则每次执行都会变化。

## 3. Undefined 与 Default

对安全关键变量不要宽泛 `default`：

```jinja2
# 不推荐：拼写错误也会静默回退
listen_port = {{ app_prt | default(8080) }}
```

应在入口 Assert，并在 `ansible.cfg` 保持 Undefined 变量报错。`mandatory` Filter 可用于局部契约：

```jinja2
listen_port = {{ app_port | mandatory }}
```

## 4. 常用 Filter

| Filter/Test | 用途 |
| --- | --- |
| `default` | 为真正可选值设置默认值 |
| `mandatory` | 要求变量必须有值 |
| `bool`、`int`、`float` | 显式类型转换 |
| `to_json`、`to_nice_json` | JSON 序列化和转义 |
| `to_yaml`、`to_nice_yaml` | YAML 序列化 |
| `quote` | Shell 参数引用，仍应优先避免 Shell |
| `regex_replace` | 受控文本变换 |
| `map`、`selectattr`、`rejectattr` | 从结构化列表选择字段 |
| `dict2items`、`items2dict` | 字典与列表转换 |
| `unique`、`sort` | 去重和稳定排序 |
| `password_hash` | 生成兼容散列，需考虑 Salt 与每次变化 |

Filter 名称也可能由 Collection 提供，关键项目使用 FQCN 或锁定 Collection，避免行为漂移。

## 5. 模板任务

```yaml
- name: Publish validated application configuration
  ansible.builtin.template:
    src: app.conf.j2
    dest: /etc/app/app.conf
    owner: root
    group: app
    mode: "0640"
    backup: true
    validate: /usr/bin/app --check-config %s
  notify: Restart app
```

`validate` 中的 `%s` 会被候选临时文件替换，命令不会通过 Shell 解释，因此不能依赖管道和重定向。需要多文件联合校验时，可先渲染到受控候选目录，再运行专门校验流程，最后统一发布。

## 6. 原子性与文件系统边界

模板模块通常尝试安全文件操作和原子替换。某些容器挂载、网络文件系统或特殊文件系统可能不支持标准重命名语义。不要轻率启用不安全写入；先理解文件系统行为，并通过影子路径、应用原生 Reload API 或版本目录加符号链接设计发布。

多文件配置不是事务：

```text
渲染所有候选文件
→ 对完整候选目录执行联合校验
→ 保存当前版本指针
→ 原子切换版本目录/链接
→ Reload
→ 健康验证
→ 失败时恢复旧指针
```

## 7. Diff 与 Secret

`--diff` 可能把数据库密码、证书、Token 和内部地址输出到终端或 CI Artifact。敏感模板使用：

```yaml
diff: false
no_log: true
```

但这会牺牲审计差异。更好的设计是将非敏感配置与 Secret 分离：非敏感文件保留 Diff，Secret 通过权限受控的独立文件或外部 Secret 注入。

## 8. 配置、Reload 和 Restart

| 动作 | 适用条件 | 验证重点 |
| --- | --- | --- |
| Reload | 程序支持原子加载新配置 | 新旧 Worker、连接排空、加载失败反馈 |
| Restart | 配置只能进程启动读取 | 可用副本、启动时间、状态恢复 |
| Rolling Restart | 多副本服务 | LB 摘除、批次、容量和回接 |

Handler 只负责触发动作，不能证明新配置已被业务使用。需要在 Handler 后刷新并执行进程状态、监听端口和业务请求验证。

## 9. 自定义 Filter 的边界

当数据转换复杂且可复用时，可编写 Filter Plugin。它应当是纯函数：相同输入得到相同输出，不访问网络、不修改外部状态，并有单元测试。外部状态读取属于 Lookup/Module，不应隐藏在模板 Filter 中。

## 10. 实验与验收

1. 创建含列表和字典的模板，打乱输入顺序后验证输出仍稳定。
2. 故意生成非法配置，确认 `validate` 阻止替换。
3. 连续执行两次，确认第二次无变化、Handler 不运行。
4. 开启 Diff 检查是否泄露 Secret。
5. 模拟 Reload 成功但健康检查失败，验证停止后续批次。

- [ ] 模板相同输入产生字节级稳定输出。
- [ ] 安全关键变量不会被 Default 掩盖。
- [ ] 文件替换前执行目标程序语法校验。
- [ ] Secret 与可审计配置分离。
- [ ] 配置加载后有独立业务验收。

## 11. 官方资料

- [Templating](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_templating.html)
- [使用 Filter 处理数据](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_filters.html)
- [template 模块](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/template_module.html)
