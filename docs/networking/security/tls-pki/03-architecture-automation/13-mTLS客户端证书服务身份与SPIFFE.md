---
title: "mTLS、客户端证书、服务身份与 SPIFFE"
sidebar_label: "13. mTLS 与工作负载身份"
sidebar_position: 13
description: "从客户端证书握手进入工作负载身份、SPIFFE ID、授权映射、信任域和证书轮换。"
tags: [mTLS, SPIFFE, SPIRE, 客户端证书, 工作负载身份]
---

# mTLS、客户端证书、服务身份与 SPIFFE

mTLS 在服务端认证之外增加客户端证书认证。它解决“连接对端持有什么受信任身份”，不自动解决业务级权限。

## 1. 握手差异

服务端发送 CertificateRequest 后，客户端返回：

```text
Client Certificate
Client CertificateVerify
Client Finished
```

服务端检查：

- 链是否到达受信任客户端 CA；
- 是否在有效期内；
- EKU 是否允许 `clientAuth`；
- 身份字段是否符合命名规则；
- CertificateVerify 是否证明私钥持有；
- 吊销或短生命周期策略是否满足。

## 2. 认证与授权分开

```text
mTLS 认证结果：spiffe://example.org/ns/prod/sa/frontend
授权策略：允许调用 orders 的 GET /v1/orders
```

若只验证“由公司 CA 签发”而不检查具体身份，任何持有该 CA 叶子证书的主体都可能获得过宽访问。

## 3. 身份放在哪里

传统内部 PKI 可能使用 Subject CN/OU 或 DNS SAN。工作负载身份更适合使用明确 URI SAN。SPIFFE ID 形式：

```text
spiffe://trust-domain/path
spiffe://example.org/ns/prod/sa/frontend
```

路径语义由组织或平台定义，必须稳定、可授权、不能依赖容易漂移的 Pod IP。

## 4. SPIFFE 与 SPIRE

- SPIFFE：工作负载身份规范和 API；
- SPIRE：实现 SPIFFE 的运行系统之一；
- SVID：工作负载身份文档，可表现为 X.509-SVID 或 JWT-SVID；
- Workload API：工作负载获取并轮换身份材料的本地接口；
- Trust Bundle：验证信任域身份所需的根材料。

Agent 先证明节点身份，再根据工作负载选择器向符合条件的进程提供 SVID。应用或 Sidecar 不需要把长期私钥烘焙进镜像。

## 5. 服务网格 mTLS

网格常见路径：

```text
Application → Local Proxy ==mTLS==> Remote Proxy → Application
```

证书证明的是 Proxy 代表的工作负载身份。需要区分：

- 应用到本地 Proxy 是否明文；
- Sidecar/Ambient 数据面终止位置；
- STRICT/PERMISSIVE 模式；
- 对端认证策略与授权策略；
- 非网格工作负载如何互通。

## 6. 轮换与长连接

新证书通常只影响新握手。已建立 TLS 连接可继续使用原会话流量密钥，直到连接关闭或策略主动重连。因此轮换验证要覆盖：

- 文件或 Secret 已更新；
- 代理/进程已加载新证书；
- 新连接展示新序列号；
- 旧长连接是否需排空；
- 新旧信任 Bundle 是否有重叠窗口。

## 7. 故障模式

| 现象 | 常见原因 |
| --- | --- |
| `certificate required` | 客户端未发送证书 |
| `unknown ca` | 服务端不信任客户端链 |
| `unsupported certificate` | EKU/算法/格式不符合策略 |
| 认证成功但 403 | 身份未匹配授权策略 |
| 部分 Pod 失败 | 证书/Bundle 轮换不同步 |
| 新连接失败、旧连接正常 | 新证书、信任链或 SNI 配置错误 |

## 8. 练习与答案

**问题：** mTLS 成功后是否可以删除 API 鉴权？

不能。mTLS 给出连接主体身份，业务仍需执行资源和动作授权，必要时还要关联最终用户身份。

**问题：** 为什么不宜用 Pod IP 作为长期身份？

Pod IP 会随重建变化且可能复用，不能稳定表示工作负载职责。应使用受平台证明的逻辑身份。

## 9. 参考资料

- [SPIFFE Concepts](https://spiffe.io/docs/latest/spiffe-about/spiffe-concepts/)
- [SPIFFE X.509-SVID](https://github.com/spiffe/spiffe/blob/main/standards/X509-SVID.md)
- [RFC 8446 Client Authentication](https://www.rfc-editor.org/rfc/rfc8446)
