---
title: "信号完整性、阻抗、眼图、BER、Retimer 与链路降级"
sidebar_label: "06. 高速信号完整性与链路降级"
sidebar_position: 6
description: "解释高速数字链路背后的模拟信号、阻抗、反射、串扰、抖动、眼图、BER、均衡、Redriver、Retimer 和 FEC。"
tags: [信号完整性, 阻抗, 眼图, BER, Retimer, Redriver, FEC]
---

# 信号完整性、阻抗、眼图、BER、Retimer 与链路降级

PCIe、DDR、Ethernet 和 NVLink 在软件里表现为 0 和 1，在主板、Cable 和 Connector 上却是高速模拟波形。速率越高，走线损耗、反射、串扰和时钟抖动越容易把接收端的 0/1 判决窗口压缩。

## 1. 数字系统的模拟基础

```text
Transmitter
→ Package
→ PCB Trace
→ Connector / Cable / Via
→ Retimer/Redriver（可选）
→ Receiver
```

每个环节都会影响幅度、相位、噪声和时序。链路“偶尔掉速”可能是物理信号裕量不足，而不是驱动 Bug。

## 2. 差分信号

高速串行链路通常使用差分对，接收端关注两根线的电压差。差分传输有助于抵消共模噪声，但要求：

- Pair 内长度匹配；
- 阻抗连续；
- 合理间距和参考平面；
- Connector/Via 对称；
- 避免过度串扰。

差分不意味着对布线和接地不敏感。

## 3. 特性阻抗与反射

传输线阻抗由几何尺寸、介质和参考平面决定。阻抗不连续会产生反射，例如：

- Connector；
- Via Stub；
- 走线宽度变化；
- Cable/PCB 过渡；
- 未正确端接。

反射与原信号叠加，可能造成 Overshoot、Undershoot 和数据眼闭合。

## 4. 插入损耗与回波损耗

- Insertion Loss：信号经过通道后的能量衰减；
- Return Loss：阻抗不连续导致能量反射；
- Crosstalk：邻近信号耦合进当前通道；
- Mode Conversion：差分能量转换成共模或反向。

通道预算必须包含主板、Riser、Backplane、Connector 和 Cable 的总损耗。

## 5. 抖动

Jitter 是边沿相对理想时刻的偏移，可能包括：

- Random Jitter；
- Deterministic Jitter；
- Periodic Jitter；
- Data-dependent Jitter；
- Clock/PLL Noise。

抖动压缩采样时刻的安全窗口。频率正确不代表相位噪声和抖动合格。

## 6. Eye Diagram

把大量 Bit 波形按一个 Unit Interval 重叠形成眼图：

```text
眼高：电压噪声裕量
眼宽：时序裕量
眼闭合：损耗、抖动、噪声或均衡不足
```

眼图是统计结果，不是单个报文截图。标准通常定义 Mask、采样点和测试条件。

## 7. BER

Bit Error Rate：

```text
BER = 错误 Bit 数 ÷ 传输 Bit 总数
```

高速链路即使 BER 很低，长时间和大规模部署后仍可能出现错误。需要区分：

- Raw BER：FEC 修正前；
- Pre-FEC BER；
- Post-FEC BER；
- Uncorrectable Error。

只看“业务没丢包”可能错过不断上升的可纠正错误。

## 8. NRZ 与 PAM4

- NRZ：每个 Symbol 两个电平，承载 1 Bit；
- PAM4：四个电平，每个 Symbol 承载 2 Bit。

PAM4 在相同 Symbol Rate 下提高 Bit Rate，但每个电平间距更小，对噪声和线性度更敏感，因此通常更依赖 FEC 和均衡。

## 9. Equalization

均衡补偿通道的频率选择性损耗：

- TX Pre-emphasis/De-emphasis；
- RX CTLE；
- RX DFE；
- Link Training 协商系数。

均衡不是无限补偿。通道损耗、反射或串扰超过预算后，继续提高增益会同时放大噪声。

## 10. Redriver 与 Retimer

### 10.1 Redriver

对模拟信号进行放大和均衡，不完整恢复新的时钟域。它延迟和成本较低，但会继续携带输入抖动和噪声。

### 10.2 Retimer

接收、判决、恢复时钟，再重新发送新的信号：

```text
受损输入
→ CDR / Data Recovery
→ 新 TX
→ 恢复眼图裕量
```

Retimer 能扩展通道，但会新增 Firmware、链路训练、温度和管理故障对象。

## 11. FEC

Forward Error Correction 用冗余编码修正一定数量的 Bit Error。它可以让高 BER 物理通道仍可靠传输，但会带来：

- 编解码延迟；
- 带宽开销；
- 可纠正能力上限；
- FEC 模式兼容要求。

Corrected Error 快速增长说明链路裕量恶化，不能等到 Uncorrectable 才处理。

## 12. Link Training 与降级

链路启动时会训练速率、Lane、均衡等参数。如果高代际/宽度不稳定，系统可能：

- 从 Gen5 降到 Gen4；
- 从 x16 降到 x8；
- 反复 Retrain；
- 触发 Receiver Error/Replay；
- 最终 Link Down。

降级是保护结果，不是根因。根因可能是设备、Slot、Riser、Cable、Retimer、供电、温度或 Firmware。

## 13. 不同总线的证据

| 链路 | 常见证据 |
| --- | --- |
| PCIe | AER、Replay、Correctable Error、Link Speed/Width |
| Ethernet | FEC Corrected/Uncorrected、CRC、Symbol Error、BER |
| InfiniBand | Symbol Error、Link Down、Recovery、Port Counters |
| DDR | Training Failure、ECC、MCA、Margin Test |
| NVLink | Link CRC/Recovery、Lane/Error Counter |

不同协议计数器名称不同，但都要看错误是否持续增长和是否跨设备共享上游。

## 14. 排障矩阵

```text
设备降速/掉链
→ 保存拓扑和计数器基线
→ 比较 Endpoint 与上游 Port
→ 检查温度、功率和 Firmware
→ 固定速率/宽度验证裕量（仅诊断）
→ 交换 Cable/Slot/Riser/Device
→ 判断错误随设备还是随通道迁移
→ 恢复目标速率并做长时间压力回归
```

“降一代后稳定”只能证明链路裕量相关，不能作为永久修复替代故障定位。

## 15. 常用观察

```bash
lspci -vv -s BDF
journalctl -k | grep -Ei 'aer|pcie|replay|receiver|link down'
ethtool eth0
ethtool -S eth0
rdma link show
ibqueryerrors
nvidia-smi nvlink -s
```

真正的眼图、Margin、TDR 和 Compliance 测试通常需要平台/厂商工具和实验室仪器。

## 16. 练习与答案

**问题：PCIe 设备从 Gen5 降到 Gen4 后稳定，能否直接认为是设备性能不够？**

答案：不能。它说明 Gen5 通道裕量可能不足，应检查 Riser、Cable、Connector、Retimer、主板走线、温度和 Firmware；设备本身只是候选之一。

**问题：FEC Corrected 持续增加但业务没有丢包，是否属于正常？**

答案：少量计数是否允许要看设备规范，但持续加速增长表示物理链路裕量恶化，应在出现 Uncorrectable 和业务中断前处理。

## 17. 参考资料

- [PCI-SIG：PCI Express](https://pcisig.com/pci-express)
- [Ethernet Alliance：Technology](https://ethernetalliance.org/technology/)
