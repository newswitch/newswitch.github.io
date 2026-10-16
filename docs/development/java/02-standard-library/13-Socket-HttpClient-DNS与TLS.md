---
title: "Socket、HttpClient、DNS 与 TLS 的请求路径"
sidebar_label: "13. Socket、HttpClient、DNS 与 TLS"
sidebar_position: 13
description: "拆解 Java 网络调用的解析、建连、TLS、请求与响应阶段，区分超时、状态码、连接复用、正文消费及并发上限。"
tags: [Java, HttpClient, Socket, DNS, TLS]
---

# Socket、HttpClient、DNS 与 TLS 的请求路径

一次 HTTP 调用慢，可能慢在名称解析、连接建立、TLS、服务端处理或响应正文。只给一个“超时 3 秒”的配置，不一定覆盖这条调用链，更不能保证重试后的总耗时仍小于 3 秒。

本篇使用 JDK 25 自带 HttpClient。实验只访问当前机器的回环地址，自动选择临时端口，不依赖外部网站，也不会留下常驻服务。

## 1. 一次调用经过哪些阶段

```text
URI 与代理选择
→ 主机名解析为候选地址
→ TCP 连接或复用已有连接
→ HTTPS 时进行 TLS 握手与身份验证
→ 发送 HTTP 请求
→ 接收响应头与正文
→ 消费/关闭正文，连接进入后续生命周期
```

连接复用时可能跳过解析、建连和握手。DNS 缓存与连接存活是两套机制：DNS 地址已经变化，不代表客户端立刻放弃旧连接。诊断时应把首次调用与复用调用分开观察。

Socket 是较低层的字节连接，应用自己负责消息边界。TCP 保证字节流顺序，不保证一次 write 对应一次 read。连接成功也不证明对端已经完成业务操作。

## 2. 超时不是一个数字

| 设置或边界 | 作用 | 不能直接推断 |
| --- | --- | --- |
| Socket.connect 的 timeout | 建立连接的等待上限 | 所有 DNS、读取与业务的总预算 |
| Socket SO_TIMEOUT | 阻塞 read 的等待边界 | 连接寿命或全部请求的 deadline |
| HttpClient connectTimeout | 需要新建连接时的连接超时 | 已复用连接上的所有等待 |
| HttpRequest timeout | 请求等待响应的 API 超时 | 任意流式正文后续消费和重试的总预算 |
| 应用 deadline | 统一调用链预算 | 自动取消远端已经执行的业务 |

正文处理器会影响何时能拿到结果。ofString 把正文收集成字符串；ofInputStream 可以把流交给调用方继续消费，必须关闭并设计后续读取限制。应按 [HttpClient](https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpClient.html)与 [HttpRequest.Builder](https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpRequest.Builder.html)契约设置超时。

## 3. 本机可运行实验

```java title="HttpDemo.java"
import com.sun.net.httpserver.HttpServer;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public class HttpDemo {
    public static void main(String[] args) throws Exception {
        var address = new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0);
        HttpServer server = HttpServer.create(address, 0);
        var executor = Executors.newFixedThreadPool(1);
        server.setExecutor(executor);
        server.createContext("/health", exchange -> {
            try {
                byte[] response = "ready".getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "text/plain; charset=utf-8");
                exchange.sendResponseHeaders(200, response.length);
                try (var output = exchange.getResponseBody()) {
                    output.write(response);
                }
            } finally {
                exchange.close();
            }
        });
        try {
            server.start();
            URI base = URI.create("http://127.0.0.1:" + server.getAddress().getPort());
            try (HttpClient client = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofSeconds(2))
                    .version(HttpClient.Version.HTTP_1_1)
                    .followRedirects(HttpClient.Redirect.NEVER).build()) {
                HttpRequest request = HttpRequest.newBuilder(base.resolve("/health"))
                        .timeout(Duration.ofSeconds(3)).GET().build();
                var response = client.send(request,
                        HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
                System.out.println("status=" + response.statusCode());
                System.out.println("body=" + response.body());
                var missing = HttpRequest.newBuilder(base.resolve("/missing"))
                        .timeout(Duration.ofSeconds(3)).GET().build();
                var failure = client.send(missing, HttpResponse.BodyHandlers.discarding());
                System.out.println("missingStatus=" + failure.statusCode());
            }
        } finally {
            server.stop(0);
            executor.shutdownNow();
            if (!executor.awaitTermination(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("server executor did not stop");
            }
        }
    }
}
```

```bash
javac -encoding UTF-8 --release 25 --add-modules jdk.httpserver -d out HttpDemo.java
java --add-modules jdk.httpserver -cp out HttpDemo
```

```text title="expected-output"
status=200
body=ready
missingStatus=404
```

404 是合法 HTTP 响应，不是 send 自动抛出的网络异常。调用方需要根据业务判断状态码。本例的 HttpServer 仅用于学习客户端，不是生产网关或完整服务框架。

## 4. DNS 与 TLS 的身份关系

DNS 把域名映射到地址，TLS 验证证书链及所访问主机身份，HTTP 再选择应用资源。把 URL 换成 IP 后只补 Host 请求头，不能普遍保留原域名的 TLS SNI 与主机名验证语义。

HTTPS 客户端常见文件包括：受信任 CA 所在 truststore，以及双向 TLS 时装有客户端私钥与证书的 keystore。普通单向 HTTPS 不要求客户端拥有服务端私钥。链不完整、名称不匹配、证书时间异常和 truststore 错误应分别诊断。

不要用“信任所有证书”或关闭主机名验证作为修复。客户端可以显式配置 SSLContext，但应维护可信身份边界。Socket 的底层超时与关闭约定见 [Socket API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/Socket.html)。

## 5. 连接复用与过载控制

HttpClient 应按配置与生命周期复用，不是每次请求创建一个。响应正文要消费或按 API 关闭，否则可能影响连接复用和客户端关闭。大文件不要直接 ofString；应流式保存并限制内容大小。

sendAsync 返回 CompletableFuture，不意味着无限并发安全。需要限制在途请求、排队长度和响应内存，重试要消耗统一 deadline；非幂等请求更要处理“远端已成功、客户端却没收到响应”的情况。

排查时分别记录目标域名、实际目标地址、连接复用、状态码、首字节和总耗时，关联服务端请求标识。日志不要泄露 Authorization、Cookie 或敏感正文。

## 6. 练习与答案

### 6.1 服务返回 503，为什么没有 IOException

网络和 HTTP 协议交换可能成功，但服务拒绝了业务请求。检查 statusCode，结合重试语义处理；不能把没有异常当成功。

### 6.2 connectTimeout 为两秒，调用是否最多两秒

不是。它不是解析、已建连接、服务处理、正文消费以及重试的统一总预算。需要针对阶段配置并维护应用 deadline。

### 6.3 请求取消是否等于远端事务回滚

不是。取消主要约束本地等待和资源，服务端可能已执行。需要幂等键、可查询结果或业务补偿等协议支持。

## 7. 继续阅读

- [JDK HttpServer API](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.httpserver/com/sun/net/httpserver/HttpServer.html)
- [反射、注解与动态代理](./14-反射注解与动态代理.md)
