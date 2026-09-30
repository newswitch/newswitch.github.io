---
title: "OpenSSL 组件、状态机、BIO、EVP 与一次握手调用链"
sidebar_label: "19. OpenSSL 源码与调用链"
sidebar_position: 19
description: "从 SSL_CTX、SSL、BIO、EVP、Provider 和 TLS 状态机理解应用配置如何进入 Socket、握手与密码实现。"
tags: [OpenSSL, 源码, SSL_CTX, BIO, EVP, Provider]
---

# OpenSSL 组件、状态机、BIO、EVP 与一次握手调用链

源码学习的目标不是记函数名，而是能把“配置一张证书、发起握手、读写应用数据”映射到上下文、连接状态、I/O 抽象和密码算法层。

## 1. 组件地图

```text
Application
  ├─ SSL_CTX：进程/监听级共享配置
  ├─ SSL：单条 TLS 连接状态
  ├─ BIO：Socket、Memory、Filter 等 I/O 抽象
  ├─ X509 / X509_STORE：证书解析、信任库、路径验证
  └─ EVP：统一密码算法接口
         └─ Provider：具体算法实现和属性选择
```

OpenSSL 3.x 引入 Provider 模型。应用经 EVP 获取算法，默认、FIPS、Legacy 或第三方 Provider 能提供不同实现；不能假定所有算法都来自同一个静态函数表。

## 2. SSL_CTX

典型服务端初始化：

```c
SSL_CTX *ctx = SSL_CTX_new(TLS_server_method());
SSL_CTX_set_min_proto_version(ctx, TLS1_2_VERSION);
SSL_CTX_use_certificate_chain_file(ctx, "fullchain.pem");
SSL_CTX_use_PrivateKey_file(ctx, "server.key", SSL_FILETYPE_PEM);
SSL_CTX_check_private_key(ctx);
```

`SSL_CTX` 可保存协议范围、证书、验证参数、Session Cache、回调和 Ticket 配置。多线程共享时要区分初始化后只读配置和运行时更新机制。

## 3. SSL 对象

每接受一个连接创建一个 `SSL`：

```c
SSL *ssl = SSL_new(ctx);
SSL_set_fd(ssl, client_fd);
int ret = SSL_accept(ssl);
```

`SSL` 保存当前角色、握手状态、协商参数、Record 状态、流量秘密、读写 BIO、Session 和错误状态。证书 Reload 后，已有 SSL 对象通常继续使用创建时关联的配置/会话状态，新连接才使用新配置。

## 4. BIO

BIO 抽象 I/O：

- Socket BIO：真实网络；
- Memory BIO：测试、异步框架和自定义传输；
- Buffer/Base64 等 Filter BIO；
- BIO Pair：在 TLS 引擎与外部事件循环间搬运字节。

TLS 状态机需要更多网络数据时返回 WANT_READ，需要把输出写出时可能返回 WANT_WRITE。非阻塞应用不能把它们当永久错误。

## 5. 握手状态机

简化服务端路径：

```text
SSL_accept / SSL_do_handshake
  → 读取 Record
  → 解析 ClientHello
  → 选择版本、Cipher、Group、证书、ALPN
  → 生成 ServerHello
  → 派生握手流量秘密
  → 构造 Certificate / CertificateVerify / Finished
  → 等待并验证 Client Finished
  → 握手完成
```

实际函数和源码目录会随 OpenSSL 版本变化。阅读应围绕状态迁移、输入消息、输出消息和错误栈，而不是把某个版本内部函数名当作稳定 API。

## 6. EVP 与 Provider

EVP 提供算法无关接口：

```text
EVP_MD      摘要
EVP_CIPHER  对称加密/AEAD
EVP_MAC     MAC
EVP_KDF     密钥派生
EVP_PKEY    公钥、签名和密钥交换
```

Provider Fetch 会根据算法名和属性选择实现，例如组织启用 FIPS 属性后，一些旧算法可能获取失败。出现 `unsupported` 时应检查 Provider 加载、配置文件、属性查询和算法策略，而不只检查 Cipher 名称拼写。

## 7. X.509 验证路径

握手中的证书验证大体涉及：

```text
解析 Peer Chain
→ 构造 X509_STORE_CTX
→ 从 Untrusted Chain 与 Trust Store 构建候选路径
→ 检查签名、时间、约束、用途和策略
→ 执行应用 Verify Callback（如配置）
```

危险回调模式是记录错误后无条件返回成功，相当于关闭验证。自定义回调应保留库验证结果，只在明确策略内增加约束。

## 8. SSL_read 与 SSL_write

```text
SSL_write
  → 应用明文
  → Record 分片
  → AEAD 加密与 Tag
  → BIO_write
  → Socket

SSL_read
  → BIO_read
  → Record 重组与认证
  → 解密
  → 返回应用明文
```

一次 `SSL_write` 不保证对应一次 Socket Write 或一条 TCP 包；一次 `SSL_read` 也不保证获得完整应用消息。应用层仍需自己的 framing。

## 9. 错误处理

正确模式：

```c
int n = SSL_read(ssl, buf, sizeof(buf));
if (n <= 0) {
    int e = SSL_get_error(ssl, n);
    /* 区分 WANT_READ/WANT_WRITE、ZERO_RETURN、SYSCALL、SSL */
}
```

同时读取 OpenSSL Error Queue：

```c
ERR_print_errors_fp(stderr);
```

Error Queue 与 `errno` 表示不同层次；多线程中错误队列与当前线程相关。延迟读取可能被后续调用覆盖或混淆。

## 10. 源码阅读路线

以使用的精确 Tag 建立调用图：

1. 从 `apps/s_client.c`、`apps/s_server.c` 看 API 使用；
2. 跟踪 `SSL_do_handshake` 到状态机；
3. 定位 ClientHello 解析与扩展处理；
4. 跟踪 TLS 1.3 Key Schedule 与 Record Protection；
5. 跟踪 X.509 Store/Verify；
6. 跟踪 EVP Fetch 到 Provider 实现；
7. 用 `-trace`、Key Log、GDB/UProbe 对照运行证据。

编译调试版时保留版本、Configure 参数和 Provider 配置。生产二进制的发行版补丁可能与上游 Tag 不完全相同。

## 11. 练习与答案

**问题：** 非阻塞 Socket 上 `SSL_read` 返回失败且 `SSL_get_error` 为 WANT_READ，连接是否坏了？

不一定。状态机需要更多网络字节，应在事件循环可读后继续调用，同时处理可能的 WANT_WRITE。

**问题：** 为什么只替换磁盘证书文件，不一定影响新握手？

进程可能已把证书加载进 SSL_CTX 内存，且没有 Reload；必须确认配置重载生成了使用新材料的上下文。

## 12. 参考资料

- [OpenSSL SSL Library](https://docs.openssl.org/master/man7/ossl-guide-tls-introduction/)
- [OpenSSL BIO](https://docs.openssl.org/master/man7/bio/)
- [OpenSSL EVP](https://docs.openssl.org/master/man7/evp/)
- [OpenSSL Provider](https://docs.openssl.org/master/man7/provider/)
