---
title: "UEFI Secure Boot、TPM、Measured Boot 与启动信任链"
sidebar_label: "03. 启动安全与信任链"
sidebar_position: 3
description: "区分 UEFI Secure Boot、TPM、Measured Boot、PCR、远程证明、密钥数据库和磁盘加密解封。"
tags: [UEFI, Secure Boot, TPM, Measured Boot, PCR]
---

# UEFI Secure Boot、TPM、Measured Boot 与启动信任链

Secure Boot 回答“是否允许执行”，Measured Boot 回答“实际执行了什么”。二者可组合，但不是同一机制，也不能替代操作系统运行时安全。

## 1. 启动链

```text
Platform Root of Trust
→ UEFI Firmware
→ UEFI Driver / Option ROM
→ Bootloader / Shim
→ Kernel
→ Initramfs
→ OS Userspace
```

每一阶段都可能验证下一阶段，也可能把测量值扩展到 TPM PCR。

## 2. Secure Boot

UEFI Secure Boot 使用签名和密钥数据库决定 UEFI Image 是否允许执行。常见数据库：

- PK：Platform Key，控制平台 Secure Boot 所有权；
- KEK：授权更新允许/撤销数据库；
- db：允许的签名、证书或 Hash；
- dbx：撤销/禁止列表。

实现和管理细节以平台规范为准。启用 Secure Boot 后，未签名或被撤销的 Bootloader、Kernel/Module 可能无法加载。

## 3. TPM

TPM 是提供受保护密钥操作、PCR、随机数和密封能力的安全模块。它可能是独立芯片、Firmware TPM 或平台集成实现。

TPM 不是用于存放大量秘密文件的普通磁盘，主要保存密钥材料、策略和测量状态。

## 4. Measured Boot 与 PCR

启动组件在执行前计算摘要，并执行 PCR Extend：

```text
PCR_new = Hash(PCR_old || Measurement)
```

它形成顺序敏感的测量链。PCR 最终值不同，只说明测量序列不同，定位还需 Event Log 解释每次 Extend 对应什么组件。

## 5. 验证与测量的区别

| 机制 | 动作 | 不符合时 |
| --- | --- | --- |
| Secure Boot | 验证签名/撤销策略 | 阻止执行或进入恢复 |
| Measured Boot | 记录组件摘要到 PCR | 通常继续启动，但状态可被证明 |
| Remote Attestation | 验证签名 PCR 与策略 | 控制面决定是否信任/准入 |

Measured Boot 本身不自动阻止恶意组件，必须有验证方消费测量结果。

## 6. 磁盘加密解封

密钥可按 PCR Policy 密封：只有启动状态符合策略时 TPM 才解封。优点是自动启动同时绑定可信状态；风险是 BIOS、Bootloader、Kernel 等正常升级也可能改变 PCR。

生产设计要包含：

- Recovery Key；
- 多个允许策略或升级过渡；
- TPM 清除、主板更换和 RMA 流程；
- 密钥托管、轮换和审计；
- 无法解封时的安全恢复通道。

## 7. Option ROM 与设备风险

PCIe 设备的 UEFI Driver/Option ROM 也可能在 OS 前执行。平台需决定是否验证它们，固件升级和设备换件也可能改变测量值。

只验证 Bootloader 而忽略早期可执行组件，会留下信任链空缺。

## 8. 更新与撤销

Secure Boot 数据库和 dbx 更新本身也是敏感固件变更：

- 更新撤销列表可能阻止旧恢复介质启动；
- 证书过期或丢失会影响未来签名；
- 更换 PK/KEK 需要所有权和恢复设计；
- 集群灰度必须验证正常启动、恢复启动和回滚介质。

## 9. 生产验收

1. 确认 Secure Boot 状态和密钥所有权；
2. 验证目标 Bootloader、Kernel 和 Module 签名；
3. 保存并解析 TPM Event Log；
4. 验证 Attestation 的 Nonce、防重放和证书链；
5. 演练 Kernel/BIOS 更新后的解封；
6. 演练主板/TPM 更换和 Recovery Key；
7. 记录安全配置漂移并限制未证明节点准入。

## 10. 练习与答案

**问题：启用了 Secure Boot，是否说明运行中的 Linux 一定未被攻击？**

答案：不能。Secure Boot 主要保护启动阶段允许执行的组件，运行时漏洞、凭据泄露和合法签名组件中的缺陷仍需其他防护。

**问题：PCR 值变化是否一定表示入侵？**

答案：不一定。正常固件、Bootloader、Kernel 或配置变化也会改变测量链，应解析 Event Log 并与批准基线对比。
