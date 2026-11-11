import com.sun.net.httpserver.HttpServer;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public class HttpDemo {
    public static void main(String[] args) throws Exception {
        var address = new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0);
        HttpServer server = HttpServer.create(address, 0);
        var executor = Executors.newFixedThreadPool(1);
        server.setExecutor(executor);
        server.createContext("/health", exchange -> {
            try {
                byte[] response = "ready".getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "text/plain; charset=utf-8");
                exchange.sendResponseHeaders(200, response.length);
                try (var output = exchange.getResponseBody()) {
                    output.write(response);
                }
            } finally {
                exchange.close();
            }
        });
        try {
            server.start();
            URI base = URI.create("http://127.0.0.1:" + server.getAddress().getPort());
            try (HttpClient client = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofSeconds(2))
                    .version(HttpClient.Version.HTTP_1_1)
                    .followRedirects(HttpClient.Redirect.NEVER).build()) {
                HttpRequest request = HttpRequest.newBuilder(base.resolve("/health"))
                        .timeout(Duration.ofSeconds(3)).GET().build();
                var response = client.send(request,
                        HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
                System.out.println("status=" + response.statusCode());
                System.out.println("body=" + response.body());
                var missing = HttpRequest.newBuilder(base.resolve("/missing"))
                        .timeout(Duration.ofSeconds(3)).GET().build();
                var failure = client.send(missing, HttpResponse.BodyHandlers.discarding());
                System.out.println("missingStatus=" + failure.statusCode());
            }
        } finally {
            server.stop(0);
            executor.shutdownNow();
            if (!executor.awaitTermination(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("server executor did not stop");
            }
        }
    }
}
