---
title: "Access Key、Policy、STS、OIDC、TLS、KMS、SSE 与审计"
sidebar_label: "08. 身份、加密与审计"
sidebar_position: 8
description: "建立 MinIO 身份认证、最小权限、临时凭据、传输加密、服务端加密和审计体系。"
tags: [MinIO, Policy, STS, OIDC, TLS, KMS, SSE]
---

# Access Key、Policy、STS、OIDC、TLS、KMS、SSE 与审计

对象存储安全分为身份、授权、传输加密、静态加密和审计。只启用 TLS 不能阻止合法账号越权，只启用 SSE 也不能保护网络中的明文凭据。

## 1. 请求安全路径

```text
Client
→ TLS校验Endpoint
→ SigV4验证Access Key/临时Token
→ Policy判断Action/Resource/Condition
→ 可选SSE/KMS加解密
→ Audit记录
```

## 2. 身份选择

| 身份 | 用途 |
| --- | --- |
| Root | 初始管理和紧急操作，不作为日常业务身份 |
| 长期 Access Key | 遗留服务，需严格轮换 |
| Service Account | 从父身份派生、限定应用 |
| STS 临时凭据 | 工作负载短期访问 |
| OIDC/LDAP 等外部身份 | 人员/平台统一认证 |

Kubernetes 工作负载优先使用短期凭据和工作负载身份映射，避免把长期 Root Key 写入所有 Pod。

### 2.1 OIDC到临时对象凭证

OIDC提供外部身份声明，STS把验证过的身份换成限时对象凭证。链路是：工作负载取得JWT，MinIO验证发行者、签名、受众及有效期，按配置映射策略，再返回AccessKeyId、SecretAccessKey、SessionToken和到期时间。

任意ServiceAccount Token不能直接换来对象权限。服务必须信任其issuer，能够取得发现/JWKS配置，校验audience并映射最小策略。使用该社区版本的固定说明配置 `MINIO_IDENTITY_OPENID_CONFIG_URL`、`CLIENT_ID`、`ROLE_POLICY` 或claim映射；两种授权映射不能不理解就混搭。客户端通过AssumeRoleWithWebIdentity提交JWT，最终再用返回的三件套签名S3请求。见[固定源码说明](https://github.com/minio/minio/blob/RELEASE.2025-10-15T17-29-55Z/docs/sts/web-identity.md)。

一次性复制临时凭证到环境不会自动刷新。应测试到期前续期、发行者不可达和Token失效；记录允许已有本地模型继续服务、暂停新下载的边界，不反复重启全部Pod。

## 3. Policy

Policy 按 S3 Action、Bucket/Object ARN 和 Condition 授权。List Bucket 与 Get Object 是不同权限；应用只读模型 Prefix 时，不应获得 Delete、Policy 或其他 Bucket 权限。

策略测试覆盖允许和拒绝，不使用通配 `s3:*` 作为快速修复。显式 Deny、Bucket Policy、用户 Policy 和 STS Policy 的组合按目标版本验证。

### 3.1 前缀读取策略

下面是绑定给测试身份的策略结构，不是匿名Bucket Policy：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect": "Allow", "Action": ["s3:ListBucket"],
     "Resource": ["arn:aws:s3:::model-lab"],
     "Condition": {"StringLike": {"s3:prefix": ["models/demo/*"]}}},
    {"Effect": "Allow", "Action": ["s3:GetObject"],
     "Resource": ["arn:aws:s3:::model-lab/models/demo/*"]}
  ]
}
```

ListBucket的资源是桶，GetObject的资源是对象。把JSON放在客户端目录不会自动完成身份绑定；由实际IAM/STS配置实施，并使用非Root测试身份验证。

在独立实验集群中，管理员可以把JSON保存为本地策略文件，绑定到已经按受控流程创建的测试用户；以下会修改这个测试身份的授权，先确认Alias和归属：

```bash
mc admin policy create lab lab-model-reader /path/to/lab-reader-policy.json
mc admin policy attach lab lab-model-reader --user lab-reader
```

mc子命令按其版本帮助核对；旧客户端可能采用不同语法。这里不在参数中创建用户密码，也不把策略绑定给生产共享身份。绑定后应使用lab-reader自己的独立凭证执行下表操作，而不是继续用管理Alias测试。

| 操作 | 此策略目标 |
| --- | --- |
| LIST Prefix=models/demo/ | 允许 |
| GET models/demo/config.json | 允许 |
| LIST桶根、GET其他前缀 | 未授予 |
| PUT、DELETE、修改策略 | 未授予 |

未授予不等于最终全局拒绝：还要排除叠加授权。检查允许与拒绝时使用全新测试Key，不拿生产对象测试删除。mc管理权限与普通S3数据权限也要分开。

## 4. TLS

证书 SAN 覆盖 S3 域名和 Console 域名，客户端严格校验 CA。轮换使用新旧 CA 重叠期，并监控过期、握手失败和旧协议。节点间与 LB 回源是否加密要明确，不能只看外部 HTTPS。

客户端到LB、LB到节点、节点互连、MinIO到OIDC/KMS分别有自己的信任链。给客户端安装CA不会自动修复节点访问KMS的证书错误。证书轮换先验新链，再更新服务，最后确认所有访问方已接受，不能提前移除仍被使用的旧CA。

## 5. SSE 与 KMS

服务端加密可使用服务管理密钥或 KMS。KMS 的可用性、权限、密钥轮换和备份成为读取路径的一部分：对象仍在但密钥不可用时，数据等同不可用。

加密不替代 Object Lock、版本或备份。记录对象加密方式和 Key ID，但日志不输出数据密钥。

### 5.1 分清SSE种类和密钥依赖

SSE-S3由服务管理相应密钥体系，SSE-KMS显式选择密钥管理能力，SSE-C由客户端按请求提供客户密钥。各产品的实现、权限及支持范围不同，不能把AWS KMS ARN直接当成任意MinIO可识别配置。

固定社区版使用KMS并可通过KES接入外部密钥服务。信封加密保护的是对象密钥，底层盘在线、S3授权正确，也可能因主密钥不可用而读不到正文。见[固定版本密钥说明](https://github.com/minio/minio/blob/RELEASE.2025-10-15T17-29-55Z/docs/kms/README.md)。不要使用文档中的公共演示KMS保存真实数据。

主密钥轮换不等于立即重加密全部历史对象。恢复时至少读取旧对象、当前对象和备份对象，确认密钥版本、授权及材料保留；新写入正常后不能立即销毁旧密钥。

## 6. 审计

审计记录身份、来源、Bucket/Key、Action、结果、Request ID 和时间，并发送到独立受保护后端。Key 可能含敏感业务信息，访问和保留同样受控。

一次业务下载可能包括HEAD及多次GET。服务Request ID用于单次请求，业务download-id用于完整工作量；二者关联才能定位重试和失败。审计记录存在不证明客户端已接收并校验全部正文，不输出STS响应、Secret或完整预签名URL。

## 7. 验收

用只读身份尝试 PUT/DELETE，验证拒绝；签发短期 STS 并等待过期；轮换证书和 KMS Key；停止 KMS 观察读写边界；追踪一次对象访问到审计记录。

## 8. 练习与答案

### 8.1 有集群JWT为什么不能直接读取MinIO

答案：需要服务信任发行者、受众和签名，再映射对象策略；JWT不是S3访问凭证，STS交换和权限绑定不能省略。

### 8.2 临时AccessKey和Secret为什么仍不够

答案：还需SessionToken，并管理到期与刷新。手工环境变量不会自动更新。

### 8.3 Root能读能否证明最小权限正确

答案：不能。应以实际受限身份测试允许及拒绝，并排除叠加授权和Root绕过影响。

### 8.4 KMS恢复为何还要读取旧对象

答案：旧对象可能依赖不同密钥版本和授权，新写入正常不证明历史密钥与恢复材料完整。

参考：[社区身份配置](https://github.com/minio/minio/tree/RELEASE.2025-10-15T17-29-55Z/docs/sts)、[社区加密配置](https://github.com/minio/minio/tree/RELEASE.2025-10-15T17-29-55Z/docs/kms)。
