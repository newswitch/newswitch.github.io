---
title: "augenrules 命令详解：合并并持久化加载 Linux Audit 规则"
sidebar_label: "17. augenrules 命令详解：合并并持久化加载 Linux Audit 规则"
sidebar_position: 17
description: "完整讲解 augenrules 的 --check/--load、rules.d 自然排序、特殊指令重排、生成文件、原子验证、发行版加载路径和安全回滚。"
tags: [Linux, augenrules, Audit, auditd, 配置管理]
---

# augenrules 命令详解：合并并持久化加载 Linux Audit 规则

`augenrules` 把 `/etc/audit/rules.d/*.rules` 按自然顺序合并为 `/etc/audit/audit.rules`，并可把结果加载到内核。它解决模块化持久配置，不负责分析事件。源目录、生成文件和内核运行规则是三层状态，任何验收都必须同时核对。

## 1. 语法与全部参数

```text
augenrules [--check] [--load]
```

| 参数 | 含义 |
|---|---|
| 无参数 | 合并规则；仅当结果变化时覆盖 `/etc/audit/audit.rules` |
| `--check` | 只判断源规则变化后是否需要更新，不覆盖生成文件 |
| `--load` | 合并（若需要）并把旧或新生成规则加载到内核 |

命令只有这两个选项，没有短参数。部分发行版的 systemd unit 会调用它，另一些可能直接用 `auditctl -R`；上线前查看实际 unit 和发行版配置。

```bash
sudo augenrules --check
sudo augenrules
sudo augenrules --load
sudo auditctl -l
```

## 2. 文件选择和自然排序

只处理 `/etc/audit/rules.d/` 下以 `.rules` 结尾的文件，其他后缀忽略。文件按 natural/version sort 拼接，并去掉空行和以 `#` 开头的注释。推荐数字前缀表达阶段：

```text
10-base-config.rules
20-suppressions.rules
30-filesystem.rules
40-identity.rules
70-local-app.rules
99-finalize.rules
```

自然排序使 `2-x.rules` 位于 `10-y.rules` 之前，但为了跨工具清晰，统一两位数字。不要在目录留下 `old.rules` 作为备份——它仍会参与合并；备份改为非 `.rules` 后缀并放到受控目录。

## 3. 四类特殊指令会被重排

`augenrules` 不只是简单拼接：

- 最后一个无参数 `-D` 被移到生成文件第一行；带选项的 `-D` 保持原位。
- 最后一个 `-b` 被移到第二行。
- 最后一个 `-f` 被移到第三行。
- 最后一个 `-e` 被移到生成文件最后一行。

所以多个模块重复设置这些全局项时，表面文件顺序可能误导；以生成文件为准。尤其 `-e 2` 会锁定内核配置，必须明确只有最终文件拥有它，并在重启前完成全部验证。

```bash
grep -R -nE '^\s*-(D|b|f|e)(\s|$)' /etc/audit/rules.d
sudo sed -n '1,10p;$p' /etc/audit/audit.rules
```

## 4. `--check` 的正确用法

`--check` 只回答“源文件合并结果是否与生成文件一致”，不证明：

- 每条规则语法/字段/架构正确；
- 内核能接受所有规则；
- 内核运行规则等于生成文件；
- 规则能捕获目标事件且性能可接受。

安全发布可先在同版本测试节点复制规则，`--check`/生成后逐行审查，再 `--load`。CI 还应检查文件权限、重复 key、弃用 `-w`、无约束 `-S all`、多个全局指令和 `-e 2` 位置。

## 5. `--load` 不是原子事务

内核规则加载可能在中间行失败，前面操作可能已生效；不要假定非零退出会自动恢复。`-D` 通常位于第一行，因此失败甚至可能先清空旧规则再留下部分新规则。高风险系统应：

1. 保存 `auditctl -s` 和 `auditctl -l` 原始输出。
2. 在同版本/同架构测试节点加载完整规则。
3. 确保控制台/带外访问和回滚文件可用。
4. 在维护窗口加载，立即检查命令退出码、journal、`auditctl -l/-s`。
5. 产生每类 canary 事件，用 key 检索。

```bash
sudo augenrules --load
rc=$?
sudo auditctl -s
sudo auditctl -l
sudo journalctl -u auditd --since '-5 min' --no-pager
exit "$rc"
```

## 6. 配置管理与幂等性

配置管理应管理 `/etc/audit/rules.d/*.rules` 源文件，不直接编辑生成的 `/etc/audit/audit.rules`；否则下次合并会覆盖手工变化。每个业务模块使用唯一 key、明确 owner 和清理路径：

```text
-a always,exit -F arch=b64 -F path=/etc/example.conf -F perm=wa -k example-config
```

部署后比较三层：源文件哈希、生成文件哈希、`auditctl -l` 规范化输出。内核可能把 syscall/UID 等规范化，不能简单逐字节比较，但规则数量、key、arch、filter 和核心字段必须一致。

## 7. 回滚和不可变模式

回滚步骤：恢复上一版本 `rules.d` → 在未锁定节点 `augenrules --load` → 验证关键旧规则和 canary → 重启测试。若已经 `-e 2`，内核拒绝 reload 是设计行为，只能通过受控重启加载磁盘旧版本；不要尝试停止 auditd 或绕过锁定。

```bash
sudo auditctl -s   # enabled=2 表示已锁定
sudo augenrules --check
```

生成文件没变化但运行规则异常时，可能是上次 load 失败、服务启动顺序、手工 `auditctl` 漂移或 immutable 阻止加载；不要反复覆盖源文件。

## 8. 实验与掌握标准

在快照 VM 创建多份 `.rules`，验证自然排序、非 `.rules` 忽略、空行/注释去除和 `-D/-b/-f/-e` 重排；制造一条中段错误观察部分加载，再恢复旧规则。最后做重启一致性验证。

掌握标准：能列出全部参数；能解释三层状态和特殊重排；能发现备份文件误加载；能设计非原子加载的验证/回滚；理解 `-e 2` 后只能重启更改。

## 9. 官方参考 {/* #官方参考 */}

- [augenrules(8)](https://manpages.debian.org/unstable/auditd/augenrules.8.en.html)
- [audit.rules(7)](https://manpages.debian.org/unstable/auditd/audit.rules.7.en.html)
- [auditctl(8)](https://manpages.debian.org/unstable/auditd/auditctl.8.en.html)

上一篇：[`auditctl` 命令详解](./16-auditctl命令详解.md)

下一篇：[`ausearch` 命令详解](./18-ausearch命令详解.md)
