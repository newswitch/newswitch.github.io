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
