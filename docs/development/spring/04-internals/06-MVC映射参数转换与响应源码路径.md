---
title: "MVC 映射、参数转换与响应源码路径"
sidebar_label: "06. MVC 从映射到响应的源码路径"
sidebar_position: 6
description: "从 DispatcherServlet 到 HandlerAdapter、参数解析和返回值处理，利用请求体与响应体 Advice 观察同步 JSON 与异常路径，解释 postHandle 的真实时点。"
tags: [Spring, 源码, MVC, DispatcherServlet, JSON]
---

# MVC 映射、参数转换与响应源码路径

“DispatcherServlet 调用 Controller”省略了最容易出错的部分：找到方法之后，框架还要创建参数；方法返回后，还要决定返回值是视图、响应体还是异步结果。一次 JSON 请求应沿这些阶段分别观察。

## 1. 在 DispatcherServlet 先看路由骨架

在 [DispatcherServlet.doDispatch](https://github.com/spring-projects/spring-framework/blob/v7.0.9/spring-webmvc/src/main/java/org/springframework/web/servlet/DispatcherServlet.java) 中，先取得处理链并执行前置拦截，再选择适配器调用处理者。同步正常路径继续处理返回与完成回调；异步已开始时会转入另外的生命周期。

```text
doDispatch
→ HandlerMapping 找到 HandlerExecutionChain
→ preHandle
→ HandlerAdapter.handle
    → 准备参数 → 调用方法 → 处理返回值
→ 同步正常路径的 postHandle
→ 处理视图或已处理的响应、异常与完成
```

过滤器位于 Servlet 的外层，不在这段方法内部创建。404 可能发生在映射阶段，400 可能发生在参数阶段，500 也可能发生在返回值编码阶段；需要先定位失败位置。

## 2. Adapter 怎样准备参数并调用方法

注解控制器通常由 RequestMappingHandlerAdapter 处理。它组织参数解析器、绑定与校验支持，构造 ServletInvocableHandlerMethod 等调用对象。

从 [RequestMappingHandlerAdapter](https://github.com/spring-projects/spring-framework/blob/v7.0.9/spring-webmvc/src/main/java/org/springframework/web/servlet/mvc/method/annotation/RequestMappingHandlerAdapter.java) 进入，再看 [InvocableHandlerMethod](https://github.com/spring-projects/spring-framework/blob/v7.0.9/spring-web/src/main/java/org/springframework/web/method/support/InvocableHandlerMethod.java)：形参先逐个解析，准备成功后才有业务方法调用。

这就是“控制器没有日志”不一定是没映射到的原因。请求体损坏、类型转换失败或约束不满足，都可能已经找到方法，却还没进入方法体。

## 3. JSON 从哪个地方进入和离开

`@RequestBody` 和 `@ResponseBody` 的主要协作对象之一是 RequestResponseBodyMethodProcessor。读取时选择可读消息转换器，得到对象后继续校验；返回时则选择合适的写出方式。

可以定位 [RequestResponseBodyMethodProcessor](https://github.com/spring-projects/spring-framework/blob/v7.0.9/spring-webmvc/src/main/java/org/springframework/web/servlet/mvc/method/annotation/RequestResponseBodyMethodProcessor.java) 和 [ServletInvocableHandlerMethod](https://github.com/spring-projects/spring-framework/blob/v7.0.9/spring-webmvc/src/main/java/org/springframework/web/servlet/mvc/method/annotation/ServletInvocableHandlerMethod.java)。`@RestController` 的普通返回对象通常在 Adapter 返回之前，就已进入响应体转换路径。

因此，MVC 的 `postHandle` 不是“JSON 编码之前”的通用钩子。视图渲染、ResponseEntity、ResponseBody 和异步类型走不同返回值处理器，不能用一条视图调用链解释全部端点。

## 4. 异常怎样改变后续回调

参数解析抛出的异常会被分派路径接住，再尝试异常解析。若 `@ExceptionHandler` 生成 ProblemDetail，它本身也要经过返回值处理和消息写出。

这条路径一般不再执行正常处理者的 `postHandle`。异常被解析后，`afterCompletion` 中的异常也可能为空；不能只凭完成回调的异常参数判断本次请求从未失败。

响应已提交后发生写出错误，则无法保证还能换成另一份完整 JSON。异常 Advice 不是“无论发送到哪里都能重新开始响应”的机制。

## 5. 实验：用扩展点标记转换前后

实验使用 MockMvc 调用真实 MVC 策略，不启动服务器。请求体 Advice 标记解码前后，响应体 Advice 标记写出之前，拦截器标记 MVC 边界。它们能验证相对位置，但不是所有内部栈帧的跟踪器。

<details>
<summary>同步 JSON 与损坏请求体的完整程序</summary>

```java title="src/main/java/demo/internals/mvc/MvcPathDemo.java"
package demo.internals.mvc;

import jakarta.servlet.http.*;
import org.springframework.context.annotation.*;
import org.springframework.core.MethodParameter;
import org.springframework.http.*;
import org.springframework.http.converter.*;
import org.springframework.http.server.*;
import org.springframework.mock.web.MockServletContext;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.*;
import org.springframework.web.servlet.config.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.*;
import java.lang.reflect.Type;
import java.util.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

public final class MvcPathDemo {
    public record Input(String text) {}
    public record Note(long id, String text) {}
    public static class Trace { public final List<String> events = new ArrayList<>(); }
    @RestController public static class Notes {
        private final Trace trace;
        public Notes(Trace trace) { this.trace = trace; }
        @PostMapping(value = "/notes/{id}", consumes = "application/json", produces = "application/json")
        public Note create(@PathVariable("id") long id, @RequestBody Input input) {
            trace.events.add("controller"); return new Note(id, input.text().toUpperCase(Locale.ROOT));
        }
    }
    @RestControllerAdvice public static class Bodies extends RequestBodyAdviceAdapter implements ResponseBodyAdvice<Object> {
        private final Trace trace;
        public Bodies(Trace trace) { this.trace = trace; }
        @Override public boolean supports(MethodParameter parameter, Type type, Class<? extends HttpMessageConverter<?>> converter) { return true; }
        @Override public HttpInputMessage beforeBodyRead(HttpInputMessage message, MethodParameter parameter,
                Type type, Class<? extends HttpMessageConverter<?>> converter) { trace.events.add("decode:before"); return message; }
        @Override public Object afterBodyRead(Object body, HttpInputMessage message, MethodParameter parameter,
                Type type, Class<? extends HttpMessageConverter<?>> converter) { trace.events.add("decode:after"); return body; }
        @Override public boolean supports(MethodParameter parameter, Class<? extends HttpMessageConverter<?>> converter) { return true; }
        @Override public Object beforeBodyWrite(Object body, MethodParameter parameter, MediaType mediaType,
                Class<? extends HttpMessageConverter<?>> converter, ServerHttpRequest request, ServerHttpResponse response) {
            trace.events.add("encode:before"); return body;
        }
        @ExceptionHandler(HttpMessageNotReadableException.class) public ProblemDetail unreadable() {
            trace.events.add("exception"); return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "Invalid JSON");
        }
    }
    @Configuration(proxyBeanMethods = false) @EnableWebMvc
    public static class Config {
        @Bean public Trace trace() { return new Trace(); }
        @Bean public Notes notes(Trace trace) { return new Notes(trace); }
        @Bean public Bodies bodies(Trace trace) { return new Bodies(trace); }
        @Bean public WebMvcConfigurer interceptors(Trace trace) {
            return new WebMvcConfigurer() {
                @Override public void addInterceptors(InterceptorRegistry registry) {
                    registry.addInterceptor(new HandlerInterceptor() {
                        @Override public boolean preHandle(HttpServletRequest req, HttpServletResponse res, Object handler) {
                            trace.events.add("pre"); return true;
                        }
                        @Override public void postHandle(HttpServletRequest req, HttpServletResponse res, Object handler, ModelAndView model) {
                            trace.events.add("post");
                        }
                        @Override public void afterCompletion(HttpServletRequest req, HttpServletResponse res, Object handler, Exception error) {
                            trace.events.add("complete");
                        }
                    });
                }
            };
        }
    }
    public static final class Fixture implements AutoCloseable {
        public final AnnotationConfigWebApplicationContext context = new AnnotationConfigWebApplicationContext();
        public final MockMvc mvc;
        public Fixture() {
            context.setServletContext(new MockServletContext()); context.register(Config.class);
            try { context.refresh(); mvc = MockMvcBuilders.webAppContextSetup(context).build(); }
            catch (RuntimeException error) { context.close(); throw error; }
        }
        @Override public void close() { context.close(); }
    }
    public static void main(String[] args) throws Exception {
        try (var fixture = new Fixture()) {
            var trace = fixture.context.getBean(Trace.class);
            var ok = fixture.mvc.perform(post("/notes/7").contentType(MediaType.APPLICATION_JSON)
                    .content("{\"text\":\"hello\"}")).andReturn().getResponse();
            System.out.println("status=" + ok.getStatus());
            System.out.println("success=" + String.join(",", trace.events));
            trace.events.clear();
            var invalid = fixture.mvc.perform(post("/notes/7").contentType(MediaType.APPLICATION_JSON).content("{"))
                    .andReturn().getResponse();
            System.out.println("invalid=" + invalid.getStatus());
            System.out.println("failure=" + String.join(",", trace.events));
        }
    }
}
```

</details>

运行 `demo.internals.mvc.MvcPathDemo`：

```text title="expected-output"
status=200
success=pre,decode:before,decode:after,controller,encode:before,post,complete
invalid=400
failure=pre,decode:before,exception,encode:before,complete
```

损坏 JSON 没有 decode:after 和 controller，却仍有 encode:before，因为错误响应也要编码。测试还检查成功响应中的实际 JSON 值，不能只凭回调出现就宣称正文正确。

## 6. 从模拟请求走到部署链路

MockMvc 证明的是 MVC 层，不验证真实 Connector、TLS、网络与代理。需要这些证据时，应接着运行[真实 Servlet 与 Tomcat 实验](../03-web/01-Servlet-Tomcat线程与请求生命周期.md)和[异步通信实验](../03-web/05-异步请求SSE与WebSocket.md)。

排查线上问题时，应把过滤器、DispatcherServlet、目标服务和响应发送阶段关联到同一请求 ID，再对照当前框架版本。不要因为状态码相同，就把发生在不同阶段的错误归成同一个根因。

## 7. 练习与答案

### 7.1 Controller 没有执行，是否说明 HandlerMapping 没找到方法

不一定。参数转换或请求体读取可能在已经选定方法后失败。应检查映射结果、参数处理和已解析异常。

### 7.2 postHandle 是否适合统一修改所有 JSON 响应内容

不适合。ResponseBody 通常已经在 Adapter 内进入编码处理。需要修改响应体时，应选择相应的响应体扩展点，并处理媒体类型与错误边界。

### 7.3 错误路径中出现 encode:before，是否说明业务成功

不是。它也可能正在编码 ProblemDetail 等错误响应。应结合状态码、异常解析结果和实际响应正文判断。

## 8. 继续阅读

- [TestContext、上下文缓存与测试隔离](./07-TestContext上下文缓存与测试隔离.md)
- [MVC 请求链基础](../03-web/02-DispatcherServlet映射与请求执行链.md)
