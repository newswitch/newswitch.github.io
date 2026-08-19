---
title: "SOPS 编辑、加解密与轮换"
sidebar_label: "04. SOPS 操作与轮换"
sidebar_position: 4
description: "安全使用 SOPS 创建、编辑、加解密、更新接收者和轮换数据密钥，并控制明文临时文件。"
tags: [SOPS, CLI, Rotation, GitOps, Secret]
---

# SOPS 编辑、加解密与轮换

## 1. 安全编辑路径

优先让 SOPS 调用编辑器并在受控临时位置处理明文，而不是先解密到普通文件再编辑。关闭编辑器备份、Swap、云同步和历史记录；终端录屏与剪贴板同样可能泄漏。

## 2. 常见操作语义

```text
sops <file>                  交互编辑并重新加密
sops --decrypt <file>        输出明文到 stdout
sops --encrypt <plain-file>  按规则加密
sops updatekeys <file>       按配置更新接收者
sops rotate <file>           轮换数据密钥并重新加密
```

具体参数以安装版本帮助为准。任何解密输出重定向都会在磁盘生成明文，必须使用受限临时目录、严格权限和可靠清理。

## 3. 新建文件

1. 先确认仓库根目录和实际命中的 Creation Rule。
2. 使用最小样例验证接收者和解密身份。
3. 通过 SOPS 创建/加密，检查没有明文字段。
4. 用另一名授权接收者验证恢复。
5. 提交密文、Metadata 和非敏感 Schema，不提交明文副本。

## 4. 修改与合并冲突

结构化密文仍可能冲突。不要手工拼接加密值或 Metadata；在受控环境解密双方、按明文语义合并，再完整重新加密和验证 MAC。冲突期间的明文不得上传普通 CI Artifact。

## 5. 接收者变更

人员离职或 CI 身份迁移时，先添加并验证新接收者，再移除旧接收者并更新所有相关文件。最后根据风险轮换业务 Secret。批量更新先 Dry Run/清点目标，避免遗漏目录。

## 6. 自动检查

- 文件存在合法 SOPS Metadata 和 MAC；
- 接收者符合路径策略；
- 没有已知明文模式、私钥或 Token；
- 解密后的 Schema 合法，但 CI 不输出内容；
- 修改 Secret 文件需 CODEOWNERS/环境 Owner 评审。
