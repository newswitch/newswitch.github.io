package demo.web.mvc;

import demo.web.support.RunningMvc;
import org.springframework.context.annotation.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;
import org.springframework.web.servlet.mvc.method.annotation.*;
import java.net.http.*;
import java.time.Duration;

public final class DispatchDemo {
    @Configuration(proxyBeanMethods = false) @EnableWebMvc
    public static class Config {
        @Bean public Tasks tasks() { return new Tasks(); }
    }
    @RestController @RequestMapping("/tasks")
    public static class Tasks {
        @GetMapping(value = "/{id}", produces = "text/plain")
        public String get(@PathVariable("id") long id) { return "task:" + id; }
    }
    public static void main(String[] args) throws Exception {
        try (var server = new RunningMvc(Config.class); var client = HttpClient.newHttpClient()) {
            System.out.println("mapping=" + server.context().getBean(RequestMappingHandlerMapping.class).getClass().getSimpleName());
            System.out.println("adapter=" + server.context().getBean(RequestMappingHandlerAdapter.class).getClass().getSimpleName());
            var uri = server.baseUri().resolve("/tasks/7");
            var get = client.send(HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(3)).GET().build(),
                    HttpResponse.BodyHandlers.ofString());
            System.out.println("status=" + get.statusCode());
            System.out.println("body=" + get.body());
            var post = client.send(HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(3))
                    .POST(HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.discarding());
            System.out.println("wrongMethod=" + post.statusCode());
        }
    }
}
