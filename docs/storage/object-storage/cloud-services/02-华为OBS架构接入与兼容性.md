---
title: "华为 OBS 架构接入与兼容性"
sidebar_label: "02. 华为 OBS 架构与接入"
sidebar_position: 2
description: "区分华为云 OBS、对象桶与并行文件系统，学习地域端点、obsutil、身份与签名、存储类别、完整性、复制和 S3 兼容边界。"
tags: [华为云, OBS, obsutil, 对象存储, 兼容性]
---

# 华为 OBS 架构接入与兼容性

华为云 OBS 是托管对象存储服务，可以通过控制台、原生 API、SDK 和 obsutil 等方式访问。它不是 OceanStor 本地存储设备的另一个名字，也不因为使用华为 GPU/NPU 集群就自动成为节点上的文件系统。

学习 OBS 应先确认地域、桶形态、Endpoint、身份和 API，再选择客户端。本文以对象桶和 obsutil 的受限访问为主，具体功能及命令以目标区域和工具版本为准。

## 1. 对象桶与并行文件系统

| 形态 | 需要理解的区别 |
| --- | --- |
| OBS对象桶 | 以对象Key组织数据，路径中的斜杠不能直接解释为POSIX目录 |
| OBS并行文件系统 | 具有独立目录对象和相应文件语义，功能矩阵与对象桶不同 |
| OceanStor等自建或本地存储 | 硬件、部署和协议选型属于另一层，不是OBS桶配置 |

不能因为工具可以呈现目录，就把对象桶当作并行文件系统；也不能因为并行文件系统提供部分文件能力，就推断全部对象功能及任意客户端都兼容。参见[并行文件系统概述](https://support.huaweicloud.com/usermanual-obs/obs_13_0007.html)及[支持特性](https://support.huaweicloud.com/usermanual-obs/obs_13_0012.html)。

## 2. 地域与Endpoint决定访问目标

记录资源时至少包含：所属账号、地域、桶名、桶形态、Endpoint、对象Key、可选版本，以及客户端版本。

Endpoint 应从实际桶和对应区域的服务接入信息取得。公网、私网、自定义域名和不同区域不能随意混用；URL 能返回响应，也不表示请求已经到达预期桶。

跨区域访问还会影响时延、可用功能和流量路径。不要在配置时只检查一个桶名，忽略同名配置或旧环境中的 Endpoint。

## 3. 先使用原生工具建立基线

从[OBS工具入口](https://support.huaweicloud.com/obs/)选择与操作系统、架构匹配的 obsutil，并校验官方提供的制品信息。记录版本，查看本地帮助，不使用不受控的第三方二进制。

```bash
obsutil version
obsutil help config
obsutil help ls
obsutil help stat
obsutil help cp
```

准备受限测试身份，使用交互式方式初始化独立配置：

```bash
obsutil config -interactive -config=/path/to/private/obsutil-lab.conf
chmod 600 /path/to/private/obsutil-lab.conf
```

目录需要预先由当前用户管理。不要把 AK、SK 或 Token 放在 `-i/-k/-t` 命令参数里，避免进入历史和进程列表。临时凭证必须包含对应 Token，并有明确的更新与重载流程。命令定义见[配置文件更新](https://support.huaweicloud.com/utiltg-obs/obs_11_0023.html)。

### 3.1 创建专用对象桶

先由管理员确认账号、费用、桶类型和区域。本例采用cn-north-4，管理配置文件指向 `https://obs.cn-north-4.myhuaweicloud.com`；不是并行文件系统，不指定 `-fs`。

在独立、已授权的实验环境创建新桶：

```bash
BUCKET="obs-learning-$(date -u +%Y%m%d%H%M%S)-$$"
obsutil mb "obs://$BUCKET" -location=cn-north-4 -acl=private \
  -config=/path/to/private/obsutil-admin.conf
```

这里管理配置具有创建能力，不是后续模型读取身份。桶名冲突就换新名，不能连接错误账号后继续操作。地域和Endpoint必须一致，具体命令见[创建桶](https://support.huaweicloud.com/intl/zh-cn/utiltg-obs/obs_11_0008.html)。也可以在控制台选择对象桶、标准存储、私有访问和所需版本控制，再记录实际区域信息，见[桶创建说明](https://support.huaweicloud.com/usermanual-obs/zh-cn_topic_0045829088.html)。

### 3.2 准备读取身份并验证正文

管理员为独立IAM用户或受支持的临时身份授予目标桶/前缀的列举、读取能力，不授予对象写删和策略管理。IAM授权、桶策略与ACL的作用不同；“桶私有”不等于指定业务身份自动可读，也不要把AWS策略原样绑定。见[OBS权限方式](https://support.huaweicloud.com/perms-cfg-obs/obs_40_0001.html)。

用前述交互式config方法分别准备管理和读取配置，配置文件路径不同。先以管理身份上传新探针，再用受限身份读取：

```bash
LOCAL_DIR="$(mktemp -d)"
printf 'ready\n' > "$LOCAL_DIR/ready.txt"
obsutil cp "$LOCAL_DIR/ready.txt" "obs://$BUCKET/models/demo/r1/ready.txt" \
  -config=/path/to/private/obsutil-admin.conf
obsutil cp "obs://$BUCKET/models/demo/r1/ready.txt" "$LOCAL_DIR/download.txt" \
  -config=/path/to/private/obsutil-reader.conf
cmp "$LOCAL_DIR/ready.txt" "$LOCAL_DIR/download.txt"
```

相同正文应为6字节，cmp返回0；stat元数据成功不能替代此比较。再按测试Key验证拒绝越界和未授权写入，不能只以管理员成功代替业务验收。管理与读取配置可能含AK/SK/Token，均应受限存放，不能提交或打印。

## 4. 限定范围列举并下载一个对象

以下以自己的测试桶及 `models/demo/r1/config.json` 为例，配置文件已指向正确 Endpoint：

```bash
obsutil ls obs://your-owned-test-bucket/models/demo/r1/ \
  -limit=10 -config=/path/to/private/obsutil-lab.conf
obsutil stat obs://your-owned-test-bucket/models/demo/r1/config.json \
  -config=/path/to/private/obsutil-lab.conf

LAB_DIR="$(mktemp -d)"
obsutil cp obs://your-owned-test-bucket/models/demo/r1/config.json \
  "$LAB_DIR/config.json" -config=/path/to/private/obsutil-lab.conf
```

这些操作不写入远端，但下载可能产生请求、流量或取回费用。`-limit=10` 是观察范围限制，不是完整列举。`stat` 获取属性，不等于已经验证正文。

正文下载后仍应按可信 Manifest 校验。示例使用新的本地目录，避免覆盖已有文件；批量命令则还要检查结果清单和逐项失败，不只看一个总体退出提示。参见[列举](https://support.huaweicloud.com/utiltg-obs/obs_11_0014.html)与[下载](https://support.huaweicloud.com/utiltg-obs/obs_11_0018.html)。

## 5. OBS与S3兼容要逐层验证

| 层次 | 需要确认 |
| --- | --- |
| 资源及寻址 | 对象桶还是其他形态，域名及路径如何解释 |
| 认证 | 原生认证、兼容通路、签名版本与临时Token |
| Payload与校验 | 请求正文签名模式、流式上传及Checksum扩展 |
| API | Multipart、Range、版本、条件请求等实际支持范围 |
| 权限 | IAM、桶策略和兼容接口策略的动作及资源格式 |
| 错误与重试 | 状态码、错误体、可重试条件及结果未知处理 |

例如，华为提供了 V4 访问说明，并对不同 SDK 版本的配置给出约束。这说明兼容性不能简化成“替换 AWS Endpoint”。参见[如何使用V4签名访问OBS](https://support.huaweicloud.com/obs_faq/obs_faq_0274.html)。

新的 AWS SDK 可能改变默认校验及流式传输行为；旧客户端成功，也不证明新版本的全部请求都相同。遇到不兼容时先识别具体请求和支持矩阵，不直接关闭 TLS 或把所有校验全局关掉。

原生 SDK 的 `x-obs-*` 等请求约定、兼容通路中的请求，以及 AWS IAM 模板，都应按实际产品说明分别核对，不混用配置。

## 6. 存储类别与恢复状态

OBS 提供标准、低频、归档、深度归档等存储类别。类别影响访问条件、最短存储期、数据取回和计费，不能仅按容量单价选择。

对归档及深度归档对象，应确认恢复操作、完成状态和临时可读期限。恢复被受理不等于立即能够下载；恢复形成的临时可读副本也不等于永久修改了原对象类别。参见[存储类别](https://support.huaweicloud.com/usermanual-obs/obs_41_0080.html)与[恢复对象](https://support.huaweicloud.com/usermanual-obs/obs_03_0320.html)。

模型上线所需对象要提前检查全套文件的存储状态。只验证配置JSON可读，而忽略某个权重分片已进入归档，仍可能在启动时失败。

## 7. 完整性 版本与复制

数据完整性需要把上传校验、下载校验和业务 Manifest 分开。对象元数据里写了一个摘要，不表示客户端已经实际计算并比较过正文。算法和工具支持情况见[OBS数据一致性校验](https://support.huaweicloud.com/intl/zh-cn/bestpractice-obs/obs_05_0801.html)。

多版本保留、生命周期和复制分别解决历史、保留成本和数据传播问题。跨区域复制是异步过程，应检查适用范围、失败及积压，并验证目标可恢复；不能只看到规则存在就认为目标已有所有数据。参见[数据保护技术](https://support.huaweicloud.com/productdesc-obs/obs_03_0375.html)。

“副本足够”“有版本”“有复制”和“误操作后能恢复业务”是不同结论，需要独立权限与恢复验证支撑。

## 8. 运维观察的五组证据

1. 客户端：版本、实际配置来源、脱敏请求ID、重试和逐项结果。
2. 网络：解析、路由、Endpoint、公私网路径、TLS和代理。
3. 身份：AK或角色来源、Token到期、资源范围和策略条件。
4. 数据：Key、版本、存储类别、恢复状态、长度和内容校验。
5. 资源：并发、客户端内存、本地断点与临时文件空间、远端限流及账单工作量。

obsutil 的断点记录和本地结果清单同样需要空间与受限权限。远端容量充足，不表示本地临时下载不会写满磁盘。

### 8.1 一个常见的恢复状态问题

如果归档对象恢复请求已受理，但下载仍失败，先核对Key、版本、恢复是否完成、临时可读期限和身份；不要立刻把桶改为公开或不断提交恢复。待所有模型分片都可读，再校验并发布本地版本。

版本、生命周期与复制应分别查看实际配置和状态。错误Lifecycle可能让旧分片过期，目标站规则存在也不证明历史对象已经复制。恢复结果要以指定文件集合及摘要为准，不只检查一个桶的属性页。

## 9. 练习与答案

### 9.1 OBS对象桶是否等同于并行文件系统

答案：不是。两者的目录模型和功能矩阵不同，工具支持也要分别确认。目录外观不能证明底层具备相同文件语义。

### 9.2 为什么建议先用obsutil建立访问基线

答案：可以先按原生工具验证地域、身份和对象，再分析兼容客户端增加的签名、校验及协议差异。这不意味着原生工具可以代替所有应用验收。

### 9.3 修改AWS客户端Endpoint是否就完成适配

答案：没有。还要确认寻址、签名、Token、payload与校验扩展、API支持及错误处理。不同SDK版本也可能改变实际请求。

### 9.4 恢复对象是否永久改变归档对象类别

答案：不能这样推断。需要区分原对象类别、恢复状态和临时可读副本期限。业务必须确认读取窗口，不能只看恢复请求已经受理。

### 9.5 远端容量正常为什么下载仍可能失败

答案：还可能是权限、恢复状态、网络、限流、本地断点目录或临时磁盘空间等问题。应按请求和资源层次收集证据，而不是只检查桶容量。

## 10. 参考资料

- [OBS产品与工具入口](https://support.huaweicloud.com/obs/)
- [并行文件系统](https://support.huaweicloud.com/usermanual-obs/obs_13_0007.html)
- [obsutil配置](https://support.huaweicloud.com/utiltg-obs/obs_11_0023.html)
- [obsutil列举](https://support.huaweicloud.com/utiltg-obs/obs_11_0014.html)
- [obsutil下载](https://support.huaweicloud.com/utiltg-obs/obs_11_0018.html)
- [V4兼容访问](https://support.huaweicloud.com/obs_faq/obs_faq_0274.html)
- [存储类别](https://support.huaweicloud.com/usermanual-obs/obs_41_0080.html)
- [恢复对象](https://support.huaweicloud.com/usermanual-obs/obs_03_0320.html)
