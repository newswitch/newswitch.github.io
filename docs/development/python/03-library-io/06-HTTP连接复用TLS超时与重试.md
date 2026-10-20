---
title: "HTTP 连接复用、TLS、超时与重试"
sidebar_label: "06. HTTP 连接复用、TLS、超时与重试"
sidebar_position: 6
description: "以 HTTPX 理解客户端生命周期、连接池、分阶段超时、TLS 验证和重试的幂等边界。"
tags: [Python, 标准库, IO]
---

# HTTP 连接复用、TLS、超时与重试

HTTP 调用包含解析、连接、TLS、发送、等待与读取。一个 timeout 值不能自动表达全部预算，超时也不代表服务端没有执行请求。

本例使用第三方 HTTPX 0.28.1；标准库与第三方库的职责要分开。完整依赖约束在 FastAPI 示例工程中固定，不需要为了每个请求重新创建环境。

## 1. 生命周期与连接池

长生命周期 Client 可以复用连接，减少重复握手；客户端要在适当作用域关闭。每个循环都新建 Client，会削弱复用；无限复用但不限制并发，又会耗尽连接与文件描述符。

连接上限与并发上限不是同一个概念：任务可能先在应用队列等待，再在连接池等待。应同时限制提交、正在处理和返回体大小。

## 2. 不访问公网的实验

```python title="io_http.py"
import httpx

def main():
    def handle(request):
        return httpx.Response(200, json={"path": request.url.path})

    timeout = httpx.Timeout(3.0, connect=1.0, pool=0.5)
    with httpx.Client(transport=httpx.MockTransport(handle),
                      timeout=timeout, trust_env=False) as client:
        response = client.get("https://example.test/jobs")
        response.raise_for_status()
        print(response.status_code, response.json()["path"])

if __name__ == "__main__":
    main()
```

```text title="io_http.out"
200 /jobs
```

MockTransport 验证请求与响应处理，不进行 DNS、TCP 或 TLS 握手；真实链路仍需针对目标环境验证。`trust_env=False` 使本实验不意外读取代理等环境配置，真实部署则按受控策略决定。

## 3. 超时不是总 Deadline

HTTPX 区分 connect、read、write、pool 等超时。read timeout 约束等待读取进展，不等同于整个响应最多耗时多久；持续缓慢发送数据的对端仍可能拖长总时间。

需要总预算时，在外层使用整体 Deadline，并限制最大响应字节、重定向次数与重试次数。网络超时、HTTP 5xx、业务错误也要分开分类，不能只判断“非 200”。

## 4. TLS 与重试

TLS 要验证证书链、主机名与有效期。私有 CA 应通过受控信任配置解决，不默认 `verify=False`。证书验证成功也不代表业务身份授权已经通过。

GET 等通常可按契约重试，但仍要考虑应用副作用；POST 在连接断开时可能已提交，必须依赖幂等键或业务确认。退避应有抖动与总预算，并尊重服务端限流提示。

对可由用户提供的 URL，还要防止 SSRF：限制协议、目的地址、重定向与解析结果。仅检查字符串域名一次不足以覆盖所有网络路径。

## 5. 练习与答案

### 5.1 客户端读超时，能断定对方没写入吗？

答案：不能。对方可能已经提交，只是响应丢失。重试前需要幂等协议或查询确认。

### 5.2 connect timeout 一秒，就能保证请求一秒结束吗？

答案：不能。连接之后还有发送、读取与连接池等待，且可能有重试。总 Deadline 要在外层约束。

### 5.3 使用 MockTransport 是否证明 TLS 配置正确？

答案：不证明。它绕过真实网络协议；需要独立的真实证书、DNS、代理与连通性验证。

## 6. 参考资料

- [HTTPX Client](https://www.python-httpx.org/advanced/clients/)
- [HTTPX 超时](https://www.python-httpx.org/advanced/timeouts/)
- [HTTPX SSL](https://www.python-httpx.org/advanced/ssl/)
