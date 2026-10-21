---
title: "Gin JWT 认证：签名、算法、Issuer、Audience 与过期"
sidebar_label: "01. Gin JWT 认证：签名、算法、Issuer、Audience 与过期"
sidebar_position: 1
description: "JWT 是一种声明载体，签名有效不代表它就是当前服务应该接受的凭证。认证需要同时验证信任来源、用途、时间与必要身份字段。"
tags: [Go, Gin, 技术原理, 实验]
---

# Gin JWT 认证：签名、算法、Issuer、Audience 与过期

JWT 是一种声明载体，签名有效不代表它就是当前服务应该接受的凭证。认证需要同时验证信任来源、用途、时间与必要身份字段。

## 1. JWT 的信任边界

常见签名 JWT 包含 Header、Payload 与 Signature，Payload 可被读取，不是加密保险箱。客户端可解析内容但不能因此获得可信身份，服务端必须验证签名与声明。

算法必须由服务端固定允许集，而不是无条件信任 Header 的 alg。HS256 使用共享秘密，持有验证密钥的一方也可签发；RS/ES 等公私钥模型的权限边界不同。

## 2. 工程验证项

authenticate 使用 golang-jwt/jwt/v5，限制 HS256，检查 issuer=gin-lab、audience=task-api、必须有 exp、校验 iat，并要求非空 subject/tenant。允许五秒 leeway 仅用于有限时钟偏差，不意味着可以无限接受过期凭证。

缺失或无效 Bearer 返回 401，身份有效但缺 task:write 返回 403。JWT key 至少 32 字节，长度检查不代表密钥具有足够随机性；生产应使用可靠随机源与受控存储。

## 3. 运行安全回归

```bash
cd examples/gin/service-lab
go test ./internal/app -run 'TestMissingBearer|TestScopeDenied|TestWrong|TestExpired' -count=1 -v -timeout=30s
```

-token 命令用于隔离学习签发，不是公开登录接口。-demo 使用公开实验密钥，CLI 禁止用它监听远端地址；绝不能把它复制到生产 Secret。

## 4. 轮换、撤销与 OIDC

JWT 验证可以离线进行，但撤销、退出和权限即时变更需要短寿命、版本/会话状态或受控撤销机制。不是删除浏览器 Token 就让所有已泄露副本失效。

接入 OIDC 时固定 issuer，限制受信 JWKS 地址、kid 选择与刷新，验证 audience 和时间；登录交互还涉及 state、nonce 与 PKCE。当前工程没有实现完整身份提供方，不能把 HMAC 实验等同于 OIDC 联调。

## 5. 练习与答案

### 5.1 JWT Payload 默认加密吗

不是，签名不等于加密。

### 5.2 签名正确就能省略 audience 吗

不能，它用于限制凭证用途。

### 5.3 删除客户端 Token 能撤销所有副本吗

不能，服务端接受策略仍需设计。

## 6. 参考资料

- [golang-jwt 使用](https://golang-jwt.github.io/jwt/)
- [JWT RFC](https://www.rfc-editor.org/rfc/rfc7519)
