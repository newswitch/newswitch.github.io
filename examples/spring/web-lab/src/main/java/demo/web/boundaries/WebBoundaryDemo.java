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
