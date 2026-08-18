---
title: "smartctl 命令详解：ATA、SCSI、NVMe 健康、错误与自检"
sidebar_label: "11. smartctl 命令详解：ATA、SCSI、NVMe 健康、错误与自检"
sidebar_position: 11
description: "讲解 smartctl 设备识别、全部核心参数族、SMART 属性、NVMe/SCSI 差异、错误日志、自检、JSON、RAID 控制器透传和退出码位图。"
tags: [Linux, smartctl, SMART, SSD, HDD, NVMe]
---

# smartctl 命令详解：ATA、SCSI、NVMe 健康、错误与自检

`smartctl` 读取或控制磁盘固件暴露的 SMART/health 信息。它能发现介质、接口、温度、寿命和错误线索，但“PASSED”不代表磁盘没有风险，厂商 raw attribute 也不能跨型号机械比较。

## 1. 设备和版本

```bash
smartctl --version
smartctl --scan-open
smartctl -i /dev/sda
```

设备可能位于 SATA/SAS/NVMe、USB bridge、MegaRAID/cciss 等控制器后。`-d TYPE` 指定透传类型：

```bash
smartctl -a -d sat /dev/sdX
smartctl -a -d megaraid,0 /dev/sdX
```

错误 TYPE 可能导致“设备不支持”，并不等于盘无 SMART。

## 2. 核心参数族

| 参数 | 作用 |
|---|---|
| `-a, --all` | 常用 SMART 信息集合，不一定等于 `-x` |
| `-x, --xall` | 扩展全量信息 |
| `-i, --info` | 设备身份和能力 |
| `-H, --health` | overall health |
| `-A, --attributes` | ATA attributes / 设备属性 |
| `-l TYPE, --log=TYPE` | error/selftest/selective/scttemp/devstat 等日志 |
| `-c, --capabilities` | SMART 与自检能力 |
| `-g NAME, --get=NAME` | 获取设置 |
| `-s VALUE, --smart=VALUE` | 开关 SMART，属于写操作 |
| `-o VALUE, --offlineauto=VALUE` | 自动离线测试控制 |
| `-S VALUE, --saveauto=VALUE` | attribute autosave 控制 |
| `-t TEST, --test=TEST` | 启动 short/long/conveyance/select 等自检 |
| `-X, --abort` | 中止非 captive 自检 |
| `-d TYPE, --device=TYPE` | 设备/控制器协议 |
| `-T TYPE, --tolerance=TYPE` | 错误容忍行为 |
| `-b TYPE, --badsum=TYPE` | checksum 错误策略 |
| `-n POWERMODE[,STATUS]` | 盘处于 standby 等状态时不唤醒/指定退出状态 |
| `-j[modifier]` | JSON 输出，支持简洁/pretty 等 modifier |
| `-q TYPE` | quiet 模式 |
| `-r TYPE` | 打印 ioctl/协议调试信息，可能包含敏感数据 |
| `-B FILE` / `-P TYPE` | drive database 文件/数据库策略 |

版本和协议专属子选项非常多，执行 `smartctl --help` 和 `smartctl -x` 识别本机支持范围。

## 3. ATA 属性判读

```text
VALUE/WORST/THRESH  厂商归一化值；VALUE <= THRESH 常表示失败
RAW_VALUE           厂商自定义编码，不总是简单十进制计数
WHEN_FAILED         何时越过阈值
```

重点不是背 attribute ID，而是同型号趋势、错误日志和业务 I/O 证据：

- Reallocated/Pending/Offline Uncorrectable 扇区；
- UDMA CRC error 可能指向线缆/链路而非 NAND/盘面；
- 温度、Power_On_Hours、Unsafe Shutdown；
- SSD wear/percentage used 需参考厂商定义。

## 4. NVMe 与 SCSI

```bash
smartctl -x /dev/nvme0
smartctl -x /dev/sdX
```

NVMe 常见：Critical Warning、Temperature、Available Spare、Percentage Used、Data Units、Media and Data Integrity Errors、Error Log Entries、Unsafe Shutdowns。SCSI 信息和 error counter/log sense 格式不同。不能强求三种协议出现相同字段。

## 5. 自检

```bash
smartctl -c /dev/sda
smartctl -t short /dev/sda
smartctl -l selftest /dev/sda
```

long test 可能持续数小时并与业务 I/O 竞争；captive test 可能阻塞设备。启动前读取预计时长、确认 RAID/controller 行为和维护窗口。测试结束必须重新读 self-test/error log，启动命令成功不代表测试通过。

## 6. 退出码

smartctl 使用位图表达命令行/设备打开/SMART command/health/attribute/error log/self-test 等多类状态。脚本必须按本机 man page逐位解释：

```bash
smartctl -H /dev/sda
rc=$?
printf 'smartctl_rc=%d\n' "$rc"
```

不能用 `if rc != 0 then disk failed` 简化所有情况，也不能只 grep `PASSED`。

## 7. 生产流程

```bash
smartctl --scan-open
smartctl -x -j /dev/sda > smart-sda.json
journalctl -k | grep -Ei 'I/O error|reset|timeout|nvme|ata|scsi'
iostat -x -d -y 1 10
```

把设备 serial/WWN 与 `lsblk -o NAME,SERIAL,WWN` 对齐，再决定下线。RAID 成员必须结合阵列状态；云盘通常不暴露底层 SMART。

完成标准：能识别协议/透传类型，联合 health、attributes、error/selftest log、内核和 iostat 判断，且不会把单一 raw 值或 PASSED 当最终结论。

参考：[smartmontools 官方资料](https://www.smartmontools.org/)与本机 `man smartctl`。
