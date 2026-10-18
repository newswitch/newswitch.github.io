---
title: "Filter、Interceptor、ControllerAdvice 与 AOP 的边界"
sidebar_label: "04. Filter、Interceptor、Advice 与 AOP"
sidebar_position: 4
description: "通过成功、已处理异常和提前拒绝三条路径，验证 Servlet Filter、MVC Interceptor、ControllerAdvice 与方法代理的调用顺序和覆盖范围。"
tags: [Spring, MVC, Filter, Interceptor, AOP]
---

# Filter、Interceptor、ControllerAdvice 与 AOP 的边界

日志、鉴权、追踪和异常处理都像是在“业务前后执行代码”，但不同扩展点位于不同位置。选错位置，可能漏掉错误、读空请求体，或者把同一个请求记录多次。

## 1. 先看它们包住什么

```text
Servlet Filter
  → DispatcherServlet
    → MVC Interceptor.preHandle
      → 参数解析与 Controller
        → Service 代理的 AOP
          → Service 方法
        ← AOP 返回或抛异常
      ← 返回值处理 / MVC 异常解析
    ← Interceptor 完成回调
  ← Servlet Filter finally
```

这是同步实验的主路径。参数失败、`preHandle` 拒绝、异步分派或响应已提交时，回调路径会变化，不能把图当成所有请求的固定九步。

| 扩展点 | 所属边界 | 典型用途 | 重要限制 |
| --- | --- | --- | --- |
| Filter | Servlet 请求/响应 | 编码、追踪上下文、通用安全过滤链 | 不天然知道最终 Controller 方法 |
| Interceptor | MVC 处理链 | 观察 HandlerMethod、MVC 专属上下文 | 不覆盖全部 Servlet 与前置失败 |
| ControllerAdvice | MVC 参数、返回值或异常扩展 | 异常响应、绑定配置等 | 不是整个进程的全局异常捕获器 |
| AOP | 被代理对象的方法调用 | 事务、业务方法度量 | 自调用与非代理调用可能绕过增强 |

安全功能应使用适合的安全框架与统一策略，不能只靠一个 Interceptor 假定覆盖全部入口。CORS 允许浏览器读取跨域响应，不等于用户身份校验。

## 2. 三个拦截器回调不能混为“前后通知”

`preHandle` 决定是否继续。返回 false 时，当前处理者不会执行；已经成功通过前置回调的拦截器会按规则获得清理机会，而当前拒绝者不能依赖自己的 `afterCompletion` 来补清理。

同步正常路径会经过 `postHandle`；抛异常后通常不会调用它。`afterCompletion` 用于处理完成后的收尾，但传入的异常不必然等于业务最初抛出的异常：如果异常已由解析器处理，完成回调看到的异常可以为空。

另外，`@ResponseBody` 返回值通常在 HandlerAdapter 返回前就完成写出。不要假设 `postHandle` 一定早于序列化，更不要在响应已提交后才尝试修改响应头。

## 3. Advice 处理了异常，不代表 Filter 也能靠它兜底

Controller 或其调用的 Service 抛异常，DispatcherServlet 可以交给异常解析器，其中包括处理 `@ExceptionHandler` 的解析器。

Filter 在调用 `chain.doFilter()` 之前抛出的异常，则尚未进入这条 MVC 处理链。容器错误分派、安全框架入口处理器或 Filter 自己的错误策略才可能处理它。不能把一个 `@RestControllerAdvice` 当成所有入口的保险。

`OncePerRequestFilter` 的“Once”也有边界。REQUEST、ASYNC、ERROR 是不同分派，是否参与由注册与覆写策略共同决定；它不是“整个逻辑请求无论如何只执行一次”的无条件保证。

## 4. 用调用轨迹验证顺序

本实验使用[上一篇](./03-参数绑定消息转换校验与异常处理.md)的 MockMvcFixture，不启动网络端口。日志列表仅由串行实验访问，不能直接复制成多请求共享的生产日志容器。

<details>
<summary>三条路径的完整程序</summary>

```java title="src/main/java/demo/web/boundaries/WebBoundaryDemo.java"
package demo.web.boundaries;

import demo.web.support.MockMvcFixture;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.*;
import org.springframework.context.annotation.*;
import org.springframework.http.ResponseEntity;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.servlet.*;
import org.springframework.web.servlet.config.annotation.*;
import java.io.IOException;
import java.util.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

public final class WebBoundaryDemo {
    public static class Conflict extends RuntimeException {}
    public static class Trace { public final List<String> events = new ArrayList<>(); }
    public static class Work {
        private final Trace trace;
        public Work(Trace trace) { this.trace = trace; }
        public String run(boolean fail) {
            trace.events.add("service");
            if (fail) throw new Conflict();
            return "ok";
        }
    }
    @Aspect public static class Timing {
        private final Trace trace;
        public Timing(Trace trace) { this.trace = trace; }
        @Around("execution(* demo.web.boundaries.WebBoundaryDemo.Work.run(..))")
        public Object around(ProceedingJoinPoint call) throws Throwable {
            trace.events.add("aspect:before");
            try { return call.proceed(); } finally { trace.events.add("aspect:after"); }
        }
    }
    @RestController public static class Controller {
        private final Work work; private final Trace trace;
        public Controller(Work work, Trace trace) { this.work = work; this.trace = trace; }
        @GetMapping("/work") public String get(@RequestParam(defaultValue = "false") boolean fail) {
            trace.events.add("controller"); return work.run(fail);
        }
    }
    @RestControllerAdvice public static class Errors {
        private final Trace trace;
        public Errors(Trace trace) { this.trace = trace; }
        @ExceptionHandler(Conflict.class) public ResponseEntity<String> conflict() {
            trace.events.add("advice:exception"); return ResponseEntity.status(409).body("conflict");
        }
    }
    public static class TraceFilter extends OncePerRequestFilter {
        private final Trace trace;
        public TraceFilter(Trace trace) { this.trace = trace; }
        @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                FilterChain chain) throws ServletException, IOException {
            trace.events.add("filter:before");
            try {
                if (request.getRequestURI().equals("/blocked")) { response.setStatus(403); return; }
                chain.doFilter(request, response);
            } finally { trace.events.add("filter:after"); }
        }
    }
    @Configuration(proxyBeanMethods = false) @EnableWebMvc @EnableAspectJAutoProxy
    public static class Config {
        @Bean public Trace trace() { return new Trace(); }
        @Bean public Work work(Trace trace) { return new Work(trace); }
        @Bean public Timing timing(Trace trace) { return new Timing(trace); }
        @Bean public Controller controller(Work work, Trace trace) { return new Controller(work, trace); }
        @Bean public Errors errors(Trace trace) { return new Errors(trace); }
        @Bean public WebMvcConfigurer interceptors(Trace trace) {
            return new WebMvcConfigurer() {
                @Override public void addInterceptors(InterceptorRegistry registry) {
                    registry.addInterceptor(new HandlerInterceptor() {
                        @Override public boolean preHandle(HttpServletRequest req, HttpServletResponse res, Object handler) {
                            trace.events.add("interceptor:pre"); return true;
                        }
                        @Override public void postHandle(HttpServletRequest req, HttpServletResponse res,
                                Object handler, ModelAndView model) { trace.events.add("interceptor:post"); }
                        @Override public void afterCompletion(HttpServletRequest req, HttpServletResponse res,
                                Object handler, Exception error) { trace.events.add("interceptor:after"); }
                    });
                }
            };
        }
    }
    public static void main(String[] args) throws Exception {
        try (var fixture = new MockMvcFixture(Config.class)) {
            var trace = fixture.context().getBean(Trace.class);
            var mvc = MockMvcBuilders.webAppContextSetup(fixture.context()).addFilters(new TraceFilter(trace)).build();
            mvc.perform(get("/work")).andReturn();
            System.out.println("success=" + String.join(",", trace.events));
            trace.events.clear();
            mvc.perform(get("/work").param("fail", "true")).andReturn();
            System.out.println("handled=" + String.join(",", trace.events));
            trace.events.clear();
            var blocked = mvc.perform(get("/blocked")).andReturn().getResponse();
            System.out.println("blocked=" + blocked.getStatus() + ":" + String.join(",", trace.events));
        }
    }
}
```

</details>

运行 `demo.web.boundaries.WebBoundaryDemo`：

```text title="expected-output"
success=filter:before,interceptor:pre,controller,aspect:before,service,aspect:after,interceptor:post,interceptor:after,filter:after
handled=filter:before,interceptor:pre,controller,aspect:before,service,aspect:after,advice:exception,interceptor:after,filter:after
blocked=403:filter:before,filter:after
```

第二条路径没有 `postHandle`，但异常响应仍完成了；第三条连 DispatcherServlet 都没有进入。过滤器内设置 403 是为了观察截断边界，不是一套生产鉴权实现。

## 5. 追踪与清理该放在哪里

需要覆盖大多数 Servlet 请求的请求 ID，可以在 Filter 中建立并在 `finally` 清理。需要知道最终处理方法，可以在 MVC 拦截器中补充维度。需要测业务服务耗时，可以在明确的方法代理边界上处理。

三者测到的时长不是同一个指标：Filter 可能包含绑定、序列化与写回；Service AOP 通常只覆盖服务方法。异步请求还必须用逻辑请求完成事件收尾，不能把原线程退出 Filter 当成响应已经发送完成。

## 6. 练习与答案

### 6.1 为什么 Service 自调用可能没有 AOP 日志

自调用通常发生在目标对象内部，没有再次经过外层代理。与 Filter、Interceptor 是否执行无关。需要回到[代理调用边界](../02-aop-transactions/01-JDK动态代理CGLIB与调用边界.md)检查实际对象与调用路径。

### 6.2 Filter 拒绝请求后，Advice 为什么没有格式化响应

请求没有进入 MVC 异常解析流程，而且示例是直接设置状态而不是抛出 Controller 异常。过滤器应按自身安全与错误契约生成必要响应，不能依赖 MVC Advice 自动接管。

### 6.3 afterCompletion 的异常为空，是否说明业务没出错

不说明。异常可能已经由 HandlerExceptionResolver 处理并转为响应。应结合已解析异常、状态码和业务日志判断，不能只用这个回调参数统计所有失败。

## 7. 继续阅读与资料

- 下一篇：[异步请求、SSE 与 WebSocket](./05-异步请求SSE与WebSocket.md)。
- [MVC Interception](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-servlet/handlermapping-interceptor.html)
- [MVC Exceptions](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-servlet/exceptionhandlers.html)
- [OncePerRequestFilter API](https://docs.spring.io/spring-framework/docs/7.0.9/javadoc-api/org/springframework/web/filter/OncePerRequestFilter.html)
