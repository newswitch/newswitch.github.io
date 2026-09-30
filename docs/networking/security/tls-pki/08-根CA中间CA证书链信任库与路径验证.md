---
title: "根 CA、中间 CA、证书链、信任库与路径验证"
sidebar_label: "08. CA、证书链与路径验证"
sidebar_position: 8
description: "理解信任锚、中间 CA、服务端证书链、客户端路径构建、交叉签名及链不完整故障。"
tags: [PKI, Root CA, Intermediate CA, Trust Store, 证书链]
---

# 根 CA、中间 CA、证书链、信任库与路径验证

“证书是某 CA 签的”还不够。客户端必须从叶子证书找到一条满足本地策略、最终到达本地信任锚的有效路径。

## 1. 典型层次

![X.509 证书链与路径验证](/img/networking/tls-pki/certificate-chain.svg)

```text
Offline Root CA
  └─ Intermediate Issuing CA
       ├─ api.example.com
       ├─ db.example.com
       └─ client/workload certificate
```

根 CA 私钥通常离线或由严格受控 HSM 保护，只签发中间 CA。在线中间 CA 负责日常叶子证书签发。这样中间 CA 出现问题时可以吊销和替换，而不必立即更换所有客户端根信任。

## 2. 服务端发送什么

常见服务端链：

```text
server.crt
intermediate-ca.crt
[另一级 intermediate-ca.crt]
```

通常不发送根证书。客户端不会因为服务器自带一个根证书就自动信任它，信任锚必须来自客户端本地可信分发。

链文件顺序通常从叶子到签发者逐级排列；具体软件对文件拆分和顺序要求不同，应以产品文档及实际握手验证为准。

## 3. 客户端保存什么

客户端 Trust Store 包含它主动信任的根或特定信任锚。不同运行时可能使用不同信任库：

- Linux 系统 CA Bundle；
- 容器镜像内的 CA Bundle；
- Java Truststore；
- 浏览器自带或操作系统证书库；
- 应用显式配置的 `CAfile`/`CApath`；
- 服务网格代理的动态 Secret。

“宿主机 Curl 正常、容器 Java 失败”往往是两个进程使用了不同信任库。

## 4. 路径构建与路径验证

客户端先尝试构建候选路径，再验证：

1. 每级证书签名；
2. 有效期；
3. Basic Constraints 和 Path Length；
4. Key Usage/EKU；
5. 名称约束与策略约束；
6. 目标身份匹配；
7. 本地算法和密钥强度策略；
8. 需要时检查吊销。

同一叶子证书可能存在多条候选链，例如交叉签名环境。不同客户端因信任库和路径构建算法不同，可能产生不同结果。

## 5. AIA 不能替代完整服务端链

部分客户端能根据 Authority Information Access 下载缺失中间证书，另一些客户端不会或无法访问。服务端漏发中间证书可能出现：

```text
浏览器正常
Java/容器/嵌入式客户端失败
```

生产服务应发送所需中间证书，而不是依赖客户端临时下载。

## 6. 验证链

```bash
openssl verify \
  -CAfile root-ca.crt \
  -untrusted intermediate-ca.crt \
  server.crt
```

成功示例：

```text
server.crt: OK
```

若服务端链已保存：

```bash
openssl s_client -connect api.example.com:443 \
  -servername api.example.com -showcerts </dev/null
```

`-showcerts` 展示服务端实际发送的证书，不等于已经验证成功。还要检查 `Verify return code`，并在自动化中使用严格失败参数。

## 7. 私有 CA 分发

导入私有根 CA 相当于授权它为相应客户端签发身份。分发必须：

- 使用经过认证和完整性保护的渠道；
- 限定使用范围，避免全局信任过宽；
- 版本化并支持新旧根重叠；
- 能审计哪些主机、容器、JVM 已安装；
- 有误签、泄露和紧急移除方案。

不要通过业务 Pod 随意挂载根 CA 私钥。绝大多数工作负载只需要根证书，不需要 CA 私钥。

## 8. 根轮换的重叠窗口

安全轮换通常遵循：

```text
先让验证端同时信任旧根和新根
→ 用新链签发/部署叶子证书
→ 验证所有调用方
→ 等待旧证书和长连接退出
→ 移除旧根信任
```

若先替换服务端证书、后分发新根，大量客户端会立即报 `unknown ca`。

## 9. 练习与答案

**问题：** 为什么把根 CA 拼进 `fullchain.pem` 不能修复客户端不信任该根？

信任来自客户端本地 Trust Store，不来自服务端自我提供。服务端发送根证书不能建立新的信任锚。

**问题：** 为什么同一站点浏览器成功而 Java 失败？

可能是浏览器缓存/下载了中间证书，或两者信任库、算法策略、主机名验证和代理路径不同。应比较实际服务端链与各自 Trust Store。

## 10. 参考资料

- [RFC 5280 Section 6：Path Validation](https://www.rfc-editor.org/rfc/rfc5280#section-6)
- [OpenSSL verify](https://docs.openssl.org/master/man1/openssl-verify/)
