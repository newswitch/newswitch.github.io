package demo.web.servlet;

import demo.web.support.EmbeddedTomcat;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.net.http.*;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicReference;

public final class ServletDemo {
    public static void main(String[] args) throws Exception {
        var worker = new AtomicReference<Thread>();
        try (var server = new EmbeddedTomcat(); var client = HttpClient.newHttpClient()) {
            server.servlet("hello", "/hello", new HttpServlet() {
                @Override protected void doGet(HttpServletRequest request, HttpServletResponse response)
                        throws IOException {
                    worker.set(Thread.currentThread());
                    response.setContentType("text/plain;charset=UTF-8");
                    response.getWriter().write("hello");
                }
            });
            server.start();
            var request = HttpRequest.newBuilder(server.baseUri().resolve("/hello"))
                    .timeout(Duration.ofSeconds(3)).GET().build();
            var response = client.send(request, HttpResponse.BodyHandlers.ofString());
            System.out.println("status=" + response.statusCode());
            System.out.println("body=" + response.body());
            System.out.println("separateThread=" + (worker.get() != Thread.currentThread()));
        }
    }
}
