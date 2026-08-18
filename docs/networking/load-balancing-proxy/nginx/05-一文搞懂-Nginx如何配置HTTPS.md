---
title: "一文搞懂 Nginx 如何配置 HTTPS：从 HTTP 跳转、混合访问到生产实践"
sidebar_label: "05. Nginx HTTPS、TLS 握手、证书与性能"
sidebar_position: 5
description: "从 HTTP 跳转、HTTPS 混合访问到生产环境证书与配置实践的完整指南。"
tags: [Nginx, HTTPS, TLS, 证书]
---

# 一文搞懂 Nginx 如何配置 HTTPS：从 HTTP 跳转、混合访问到生产实践

在日常部署 Web 服务时，Nginx 经常被放在系统的最前面，用来承担静态资源访问、反向代理、负载均衡、HTTPS 证书卸载等职责。

对于很多刚接触 HTTPS 配置的人来说，最容易混淆的问题有几个：

- HTTP 和 HTTPS 到底分别监听什么端口？
- `ssl_certificate` 和 `ssl_certificate_key` 有什么区别？
- 为什么 HTTP 要跳转到 HTTPS？
- 后端服务还需要自己配置 HTTPS 吗？
- `X-Forwarded-Proto` 有什么用？
- HTTP 和 HTTPS 能不能同时访问？
- WebSocket、流式接口、大模型接口遇到 HTTPS 要注意什么？

这篇文章会从基础概念开始，结合实际配置，把 Nginx 中常见的 HTTPS 配置方式完整梳理一遍。

## 1. HTTP 和 HTTPS 的区别

HTTP 是明文传输协议，默认端口是 **80**，访问地址形如 `http://example.com`。

HTTPS 可以理解为 **HTTP + TLS/SSL 加密**，默认端口是 **443**，访问地址形如 `https://example.com`。

HTTP 请求在网络中是明文传输的，如果中间链路被抓包，请求内容可能被看到。HTTPS 通过 TLS 证书和加密机制，可以保证：

- 传输内容加密
- 服务端身份可信
- 数据在传输过程中不容易被篡改

所以现在生产环境中的网站、接口、后台系统、网关服务，基本都应该优先使用 HTTPS。

## 2. Nginx 在 HTTPS 架构中的位置

一个常见架构如下：

```text
用户浏览器
    |
    | HTTPS
    v
Nginx
    |
    | HTTP
    v
后端服务（Spring Boot / Go / Python / Node.js 等）
```

也就是说：

- 用户访问 Nginx 时走 HTTPS
- Nginx 负责处理证书和 TLS 握手
- Nginx 再把请求转发给后端服务
- 后端服务一般只需监听普通 HTTP 端口

这种方式也叫做 **SSL 终止 / SSL 卸载**：HTTPS 在 Nginx 处终止，后面的内部服务可以继续使用 HTTP。

## 3. HTTPS 配置需要准备什么

配置 HTTPS 至少需要两个文件：

- **证书文件**（`ssl_certificate`）
- **私钥文件**（`ssl_certificate_key`）

例如：

```text
/etc/nginx/certs/example.com.pem
/etc/nginx/certs/example.com.key
```

如果使用 Let's Encrypt，常见路径为：

```text
/etc/letsencrypt/live/example.com/fullchain.pem
/etc/letsencrypt/live/example.com/privkey.pem
```

> **注意：** 证书和私钥必须是一对。若不匹配，执行 `nginx -t` 时会报错。

## 4. 最小可用 HTTPS 配置

假设：

- 域名：`example.com`
- 后端服务：`http://127.0.0.1:8080`
- 证书：`/etc/nginx/certs/example.com.pem`
- 私钥：`/etc/nginx/certs/example.com.key`

最小可用配置如下：

```nginx
server {
    listen 443 ssl;
    server_name example.com;

    ssl_certificate     /etc/nginx/certs/example.com.pem;
    ssl_certificate_key /etc/nginx/certs/example.com.key;

    location / {
        proxy_pass http://127.0.0.1:8080;
    }
}
```

含义简要说明：

- Nginx 监听 443 端口
- 使用指定证书提供 HTTPS 服务
- 所有请求转发给本机 8080 端口的后端服务

访问流程：

```text
https://example.com → Nginx:443 → http://127.0.0.1:8080
```

## 5. 生产常用方式：HTTP 自动跳转 HTTPS

生产环境中，通常不希望用户继续使用 HTTP 访问，因此会把 HTTP 自动跳转到 HTTPS。推荐配置如下：

```nginx
server {
    listen 80;
    server_name example.com;
    # 强制重定向到 HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name example.com;

    # 证书
    ssl_certificate     /etc/nginx/certs/example.com.pem;
    ssl_certificate_key /etc/nginx/certs/example.com.key;

    # 允许的 TLS 协议版本
    ssl_protocols TLSv1.2 TLSv1.3;
    # 高强度加密套件：禁用匿名认证、禁用 MD5
    ssl_ciphers HIGH:!aNULL:!MD5;

    # SSL 会话缓存 10MB，有效时间 10 分钟
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:8080;

        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

这也是最常见、最推荐的 HTTPS 配置方式。

## 6. HTTP 跳转 HTTPS 配置详解

先看负责 HTTP 的 `server` 块：

```nginx
server {
    listen 80;
    server_name example.com;

    return 301 https://$host$request_uri;
}
```

| 配置项 | 含义 |
|--------|------|
| `listen 80;` | 监听 HTTP 默认端口 |
| `server_name example.com;` | 匹配域名 `example.com` |
| `return 301 https://$host$request_uri;` | 永久重定向到 HTTPS |

变量说明：

- **`$host`**：用户访问的域名
- **`$request_uri`**：路径与查询参数

例如访问 `http://example.com/user/list?page=1` 会跳转到 `https://example.com/user/list?page=1`，既切换到 HTTPS，又不丢失原始路径和参数。

## 7. HTTPS Server 配置详解

第二段是真正处理 HTTPS 请求的 `server` 块开头：

```nginx
server {
    listen 443 ssl http2;
    server_name example.com;
    # ...
}
```

`listen 443 ssl http2;` 表示：

- 监听 443 端口
- 启用 SSL/TLS
- 启用 HTTP/2（连接复用更好，适合网页与多接口并发）

较新的 Nginx 版本更推荐：

```nginx
listen 443 ssl;
http2 on;
```

老版本中常见写法仍是 `listen 443 ssl http2;`。

## 8. 证书配置详解

```nginx
ssl_certificate     /etc/nginx/certs/example.com.pem;
ssl_certificate_key /etc/nginx/certs/example.com.key;
```

- `ssl_certificate`：证书文件
- `ssl_certificate_key`：证书私钥

Let's Encrypt 示例：

```nginx
ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
```

生产环境建议使用完整证书链（`fullchain.pem`），避免部分浏览器或客户端出现证书链不完整的问题。

## 9. TLS 协议和加密套件配置

```nginx
ssl_protocols TLSv1.2 TLSv1.3;
```

表示只允许 TLS 1.2 和 TLS 1.3。不建议启用 SSLv2、SSLv3、TLSv1、TLSv1.1 等旧协议。

```nginx
ssl_ciphers HIGH:!aNULL:!MD5;
```

表示使用高强度加密套件，并禁用匿名认证算法和 MD5。普通业务通常足够；金融、政企等场景可进一步收紧策略。

## 10. SSL 会话缓存配置

```nginx
ssl_session_cache shared:SSL:10m;
ssl_session_timeout 10m;
```

HTTPS 建立连接需要 TLS 握手，比普通 HTTP 更耗资源。开启会话缓存后，客户端短时间内再次访问可复用部分握手信息。

- `shared:SSL:10m`：名为 `SSL` 的共享缓存区，大小 10MB
- `ssl_session_timeout 10m`：缓存有效时间 10 分钟

## 11. 请求体大小限制

```nginx
client_max_body_size 100m;
```

限制客户端上传请求体的最大大小，影响文件上传、大 JSON、语音/模型文件等场景。超过限制会返回 **`413 Request Entity Too Large`**。

可按业务调整，例如普通后台 `20m`，涉及大文件上传时 `100m` 或更大。

## 12. 反向代理配置详解

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
}
```

- `location /`：匹配所有路径
- `proxy_pass`：转发到本机 8080 端口

例如用户访问 `https://example.com/api/user`，Nginx 会转发给 `http://127.0.0.1:8080/api/user`。

## 13. 代理请求头配置

生产环境反向代理时，建议补充以下请求头：

```nginx
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto https;
```

### 13.1 Host

```nginx
proxy_set_header Host $host;
```

把用户访问的原始域名传给后端。例如用户访问 `https://example.com`，后端收到的 `Host` 仍是 `example.com`，对多域名、多租户、登录回调地址生成很重要。

### 13.2 X-Real-IP

```nginx
proxy_set_header X-Real-IP $remote_addr;
```

把客户端真实 IP 传给后端。

### 13.3 X-Forwarded-For

```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

传递完整代理链路上的 IP。若请求经过 CDN、负载均衡、Nginx，`X-Forwarded-For` 中可能包含多个 IP。

### 13.4 X-Forwarded-Proto

```nginx
proxy_set_header X-Forwarded-Proto https;
```

告诉后端：用户原始访问协议是 HTTPS。

虽然 Nginx 转发给后端时可能是 HTTP（`Nginx → 后端：http://127.0.0.1:8080`），但用户访问 Nginx 时是 HTTPS。若不传递原始协议，后端可能误认为用户走 HTTP，导致：

- 登录跳转地址错误
- OAuth 回调地址错误
- 生成的链接变成 `http`
- Cookie `Secure` 判断异常
- 前端接口地址拼接错误

因此 `X-Forwarded-Proto` 非常重要。

## 14. HTTP 和 HTTPS 同时可访问的配置

有些场景不希望 HTTP 自动跳转 HTTPS，而是希望两者都可访问，例如：

- 内网测试
- 兼容旧设备
- 健康检查只能走 HTTP
- 局域网服务
- 临时迁移阶段

可配置两个 `server`，分别处理 HTTP 和 HTTPS：

```nginx
server {
    listen 80;
    server_name example.com;

    location / {
        proxy_pass http://127.0.0.1:8080;

        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto http;
    }
}

server {
    listen 443 ssl http2;
    server_name example.com;

    ssl_certificate     /etc/nginx/certs/example.com.pem;
    ssl_certificate_key /etc/nginx/certs/example.com.key;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://127.0.0.1:8080;

        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

此时 `http://example.com` 与 `https://example.com` 都可访问同一后端，区别在于传给后端的 `X-Forwarded-Proto` 分别为 `http` 和 `https`。

## 15. 一个 server 同时监听 HTTP 和 HTTPS

技术上也可以写在一个 `server` 中：

```nginx
server {
    listen 80;
    listen 443 ssl http2;

    server_name example.com;

    ssl_certificate     /etc/nginx/certs/example.com.pem;
    ssl_certificate_key /etc/nginx/certs/example.com.key;

    location / {
        proxy_pass http://127.0.0.1:8080;

        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`$scheme` 会根据用户访问协议自动为 `http` 或 `https`。这种方式较简洁，但不如分开两个 `server` 清晰。

生产环境若需要 HTTP 跳 HTTPS，仍建议：

- **80 端口 `server`**：只负责跳转
- **443 端口 `server`**：处理业务

## 16. WebSocket / 流式接口 HTTPS 配置

若后端涉及 WebSocket、SSE、大模型流式输出、语音流式识别、实时消息推送等，需要额外配置 `Upgrade` 和 `Connection` 请求头。

通常在 `http` 块中先定义 `map`（**不能**放在 `server` 或 `location` 内）：

```nginx
http {
    map $http_upgrade $connection_upgrade {
        default upgrade;
        ''      close;
    }

    server {
        listen 80;
        server_name example.com;
        return 301 https://$host$request_uri;
    }

    server {
        listen 443 ssl http2;
        server_name example.com;

        ssl_certificate     /etc/nginx/certs/example.com.pem;
        ssl_certificate_key /etc/nginx/certs/example.com.key;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;

        location / {
            proxy_pass http://127.0.0.1:8080;
            proxy_http_version 1.1;

            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;

            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto https;
        }
    }
}
```

## 17. 静态网站 HTTPS 配置

若 Nginx 直接托管前端静态页面（Vue、React、博客等），可这样配置：

```nginx
server {
    listen 80;
    server_name example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name example.com;

    ssl_certificate     /etc/nginx/certs/example.com.pem;
    ssl_certificate_key /etc/nginx/certs/example.com.key;

    root /data/www/example.com;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

- `root`：静态文件目录
- `try_files`：常用于 SPA，避免刷新时出现 404

## 18. HTTPS 配置后的检查命令

修改配置后，先检查语法：

```bash
nginx -t
```

若输出包含 `syntax is ok` 与 `test is successful`，说明语法无误。然后重载：

```bash
nginx -s reload
# 或
systemctl reload nginx
```

确认 Nginx 监听 80 和 443：

```bash
ss -lntp | grep nginx
```

正常应能看到 `0.0.0.0:80` 与 `0.0.0.0:443`。云服务器还需在安全组开放 **TCP 80**、**TCP 443**。

## 19. 常见问题排查

### 19.1 访问 HTTPS 提示证书不安全

常见原因：

- 证书不是可信 CA 签发
- 证书过期
- 证书域名与访问域名不一致
- 证书链不完整

排查示例：

```bash
openssl x509 -in /etc/nginx/certs/example.com.pem -noout -subject -dates
```

重点检查：绑定域名、有效期、是否使用完整证书链。

### 19.2 Nginx reload 报证书错误

`nginx -t` 报错常见原因：路径错误、证书与私钥不匹配、文件权限不足。

```bash
ls -l /etc/nginx/certs/
```

检查证书与私钥是否匹配：

```bash
openssl x509 -noout -modulus -in example.com.pem | openssl md5
openssl rsa  -noout -modulus -in example.com.key | openssl md5
```

两次 MD5 输出一致则说明匹配。

### 19.3 浏览器访问不到 HTTPS

排查方向：

- Nginx 是否监听 443
- 防火墙 / 安全组是否开放 443
- 域名是否解析到正确服务器
- 配置是否已成功 reload

```bash
ss -lntp | grep 443
curl -vk https://example.com
```

### 19.4 后端获取不到真实 IP

确认 Nginx 已配置：

```nginx
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

同时后端框架需支持读取这些头。例如 Spring Boot 部署在反向代理后时，需关注 forwarded headers 的处理。

### 19.5 后端生成的链接变成 HTTP

用户访问 `https://example.com`，但后端生成 `http://example.com/callback`，通常是因为后端不知道原始协议为 HTTPS。应配置：

```nginx
proxy_set_header X-Forwarded-Proto https;
```

若 HTTP 与 HTTPS 同时访问，可使用：

```nginx
proxy_set_header X-Forwarded-Proto $scheme;
```

## 20. 推荐生产模板

普通后端服务可直接使用以下模板（按需修改域名、证书路径、`proxy_pass`）：

```nginx
server {
    listen 80;
    server_name example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name example.com;

    ssl_certificate     /etc/nginx/certs/example.com.pem;
    ssl_certificate_key /etc/nginx/certs/example.com.key;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:8080;

        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

需要修改的主要是四处：`server_name`、证书路径、私钥路径、`proxy_pass`。

## 21. 总结

Nginx 配置 HTTPS，本质上就是三件事：

1. 监听 443 端口
2. 配置证书和私钥
3. 把请求转发给后端服务

生产环境最推荐的方式：

- 80 端口只负责 HTTP → HTTPS 跳转
- 443 端口处理 HTTPS 业务
- 后端继续使用 HTTP
- 通过 `proxy_set_header` 传递真实 IP 与原始协议

若需 HTTP 与 HTTPS 同时访问，可分别配置两个 `server`。掌握以下核心指令后，各场景都会清晰很多：

`listen 443 ssl`、`ssl_certificate`、`ssl_certificate_key`、`ssl_protocols`、`proxy_pass`、`proxy_set_header`、`return 301`
