---
title: "Nginx 配置上下文、指令继承、变量、Location 与 Reload"
sidebar_label: "03. 配置、Location 与 Reload"
sidebar_position: 3
description: "从配置解析和请求 URI 规范化，系统掌握上下文、继承、server/location 选择、rewrite、变量、map 与安全 Reload。"
tags: [Nginx, Location, Rewrite, Map, Reload, 配置]
---

# Nginx 配置上下文、指令继承、变量、Location 与 Reload

Nginx 配置不是按文件从上到下执行的脚本。启动或 Reload 时，各模块解析属于自己的指令并生成配置对象；请求到来后，事件处理器再按阶段使用这些对象。理解上下文、继承和请求阶段，才能解释“配置看起来在上面，为什么没有生效”。

## 1. 配置树与模块所有权

```text
main
├─ events
├─ http
│  ├─ upstream
│  ├─ map / geo / split_clients
│  └─ server
│     └─ location
├─ stream
└─ mail（按构建模块）
```

同名或相似指令可能属于不同模块，例如 HTTP 与 Stream 的 `proxy_pass` 不是同一个实现。用以下命令确认编译模块、默认路径和最终展开配置：

```bash
nginx -V 2>&1
nginx -t
nginx -T 2>&1 | less
```

`nginx -T` 会展开 `include`，排障时应保存这份最终配置，而不是只查看某个片段。

## 2. 继承不是简单覆盖

每个模块自行定义合并规则，常见模式包括：

- 子上下文未配置时继承父值；
- 子上下文一旦出现同类指令，整组重新定义；
- 数组型指令追加或覆盖取决于模块；
- 有些指令只允许出现在特定上下文；
- `add_header`、`proxy_set_header` 等常因子级出现任意一条而不再继承父级整组配置。

例如子 Location 重新定义一个代理 Header 后，要用 `nginx -T` 和实际请求确认其他 Header 是否仍存在，不能凭缩进判断继承。

## 3. Server 选择

HTTP 请求先由监听地址和端口进入一组 Server，再依据 Host/SNI 选择虚拟主机：

```text
listen address:port
  → TLS SNI 参与证书/虚拟服务选择
  → HTTP Host 参与 server_name 匹配
  → 默认 Server 兜底
```

`default_server` 属于 `listen` 地址，不属于某个域名的全局默认。HTTPS 中证书选择发生在读取 HTTP Host 之前，不能只修改 Host Header 修复错误证书。

## 4. URI 与 Location 匹配

常用类型：

```nginx
location = /healthz { }
location ^~ /static/ { }
location /api/ { }
location ~ \.php$ { }
location ~* \.(jpg|png)$ { }
location @fallback { }
```

简化顺序：

1. 查找精确匹配 `=`；
2. 记录最长前缀匹配；
3. 若最长前缀带 `^~`，跳过同层正则；
4. 按配置出现顺序测试正则 Location；
5. 没有正则命中时使用最长前缀。

嵌套 Location、内部重定向和 URI 重写会再次触发部分选择过程。生产排障应构造边界请求：大小写、尾斜杠、编码字符、重复斜杠、查询参数和不存在路径。

## 5. `root`、`alias` 与 `try_files`

```nginx
location /assets/ {
    root /srv/www;
}
```

`/assets/a.css` 映射为 `/srv/www/assets/a.css`。

```nginx
location /assets/ {
    alias /srv/static/;
}
```

映射为 `/srv/static/a.css`。`alias` 与 Location 尾斜杠、正则捕获组合时最容易产生路径错误。

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

最后一个参数可能触发内部重定向。单页应用使用它时要防止把 API 404 误返回 HTML 200。

## 6. `proxy_pass` URI 规则

```nginx
location /api/ {
    proxy_pass http://backend;
}
```

通常保留原规范化 URI。

```nginx
location /api/ {
    proxy_pass http://backend/v1/;
}
```

会用 `/v1/` 替换匹配的 Location 前缀。正则 Location、命名 Location、变量 `proxy_pass` 和 `rewrite ... break` 的行为更复杂，应通过后端回显 `$request_uri`、`$uri` 和实际上游路径验证。

## 7. Rewrite 循环与阶段

`rewrite`、`return`、`if` 属于 Rewrite Module。Server 级和 Location 级指令运行阶段不同；URI 被改写后 Location 搜索可能重复，循环次数受限。

优先选择声明式指令：

```nginx
return 301 https://$host$request_uri;
try_files $uri @backend;
map $http_upgrade $connection_upgrade { ... }
```

`if` 并非绝对不能用，但在 Location 中组合代理、文件处理和复杂 Rewrite 时容易产生非直觉行为。适合用 `return`、`rewrite` 或变量赋值的简单条件，不应用它模拟通用编程语言控制流。

## 8. 变量与求值时机

变量可能来自请求解析、Map、正则捕获、Upstream 或模块 Getter。许多变量按需惰性求值；有些值只有进入 Upstream 后才存在。

常见区别：

| 变量 | 含义 |
| --- | --- |
| `$request_uri` | 原始请求 URI，通常包含查询字符串 |
| `$uri` | 当前规范化 URI，内部重定向时可能变化 |
| `$args` | 当前查询字符串，可被修改 |
| `$host` | 按请求行、Host、server_name 等规则得到的规范主机值 |
| `$http_host` | 客户端原始 Host Header，可能为空或含端口 |
| `$upstream_addr` | 实际尝试的上游地址，可能有多个 |
| `$upstream_response_time` | 每次上游尝试的耗时序列 |

不要把未校验的客户端 Header 直接用于文件路径、缓存键、内部跳转或安全决策。

## 9. `map`、`geo` 与 `split_clients`

`map` 在 `http` 上下文定义变量映射，通常按需计算：

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

`geo` 适合按客户端地址生成变量；使用前必须先正确配置可信代理和 Real IP，否则依据的可能是负载均衡器地址。

`split_clients` 基于输入字符串哈希做稳定分桶：

```nginx
split_clients "${remote_addr}${http_user_agent}" $bucket {
    5%      canary;
    *       stable;
}
```

NAT、IPv6 Privacy Address 或 User-Agent 变化会影响稳定性，重要用户灰度应使用可信业务身份。

## 10. Include 与生成配置

风险包括：

- Glob 展开顺序影响正则 Location 或默认配置；
- 自动化残留旧文件导致重复监听/域名；
- Secret 模板写出半个文件时触发 Reload；
- 容器镜像配置与 ConfigMap 挂载互相遮盖。

采用“写临时文件 → 语法测试 → 原子替换 → Reload → 真实请求验证”的流程，不直接覆盖正在使用的文件。

## 11. Reload 的内部过程

```text
Master 收到 HUP
→ 解析全部新配置
→ 尝试打开日志和监听资源
→ 成功后启动新 Worker
→ 通知旧 Worker 停止接收新连接
→ 旧 Worker 处理存量连接后退出
```

解析失败时旧配置继续服务。成功 Reload 后旧 Worker 可能因 WebSocket、SSE、慢客户端或卡住的 Upstream 长时间不退出，造成进程和内存暂时翻倍。

```bash
nginx -t && nginx -s reload
ps -o pid,ppid,state,etime,cmd -C nginx
```

在 systemd 下优先使用发行版提供的 Reload 单元，并检查退出码与日志。

## 12. 配置变更验收

```text
1. nginx -V 保存版本和模块
2. nginx -T 保存新旧最终配置
3. nginx -t 检查语法与文件权限
4. Canary 实例验证 Host/SNI/Path/Headers
5. Reload 后观察新旧 Worker
6. 验证真实入口和上游
7. 观察 4xx/5xx、延迟、连接和资源
8. 保留可立即恢复的上一版本配置
```

## 13. 练习与答案

**问题：** `nginx -t` 成功是否证明业务路由正确？

不能。它验证语法、引用文件和部分初始化，不会证明 Location 选择、DNS、上游协议和授权符合业务预期。

**问题：** Reload 后两个 Worker 代际长期并存，优先检查什么？

检查旧 Worker 的活动连接、WebSocket/SSE、慢请求、上游阻塞和 `worker_shutdown_timeout`，不要直接把所有旧 Worker `kill -9`。

**问题：** `$request_uri` 与 `$uri` 为什么可能不同？

前者保留原始请求表示，后者是当前规范化并可能被内部重定向修改的 URI。

## 14. 参考资料

- [Nginx Core Module](https://nginx.org/en/docs/ngx_core_module.html)
- [HTTP Core Module](https://nginx.org/en/docs/http/ngx_http_core_module.html)
- [Rewrite Module](https://nginx.org/en/docs/http/ngx_http_rewrite_module.html)
- [Map Module](https://nginx.org/en/docs/http/ngx_http_map_module.html)
