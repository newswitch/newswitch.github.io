package demo.boot.first;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.web.server.servlet.context.ServletWebServerApplicationContext;
import org.springframework.web.bind.annotation.*;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;

@SpringBootApplication
public class FirstApplication {
    @RestController public static class HelloController {
        @GetMapping(value = "/hello", produces = "text/plain")
        public String hello(@RequestParam(name = "name", defaultValue = "Spring") String name) {
            return "hello, " + name;
        }
    }
    public static void main(String[] args) throws Exception {
        var context = SpringApplication.run(FirstApplication.class, args);
        if (!context.getEnvironment().getProperty("lab.once", Boolean.class, false)) return;
        try (context; var client = HttpClient.newHttpClient()) {
            int port = ((ServletWebServerApplicationContext) context).getWebServer().getPort();
            var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/hello"))
                    .timeout(Duration.ofSeconds(3)).GET().build();
            var response = client.send(request, HttpResponse.BodyHandlers.ofString());
            System.out.println("status=" + response.statusCode());
            System.out.println("body=" + response.body());
        }
    }
}
