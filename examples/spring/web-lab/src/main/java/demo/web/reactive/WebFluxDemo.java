package demo.web.reactive;

import io.netty.channel.ChannelOption;
import org.springframework.http.MediaType;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.http.server.reactive.ReactorHttpHandlerAdapter;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.server.*;
import reactor.core.publisher.*;
import reactor.netty.DisposableServer;
import reactor.netty.http.client.HttpClient;
import reactor.netty.http.server.HttpServer;
import reactor.netty.resources.*;
import java.time.Duration;
import static org.springframework.web.reactive.function.server.RequestPredicates.GET;

public final class WebFluxDemo {
    public record Task(long id, String state) {}
    public static final class Network implements AutoCloseable {
        private final LoopResources serverLoops = LoopResources.create("lab-server", 1, true);
        private final LoopResources clientLoops = LoopResources.create("lab-client", 1, true);
        private final ConnectionProvider pool = ConnectionProvider.builder("lab-pool").maxConnections(2)
                .pendingAcquireMaxCount(4).pendingAcquireTimeout(Duration.ofSeconds(2)).build();
        private DisposableServer server;
        private final WebClient client;
        public Network() {
            try {
                var routes = RouterFunctions.route(GET("/tasks/{id}"), request -> {
                    try {
                        long id = Long.parseLong(request.pathVariable("id"));
                        return ServerResponse.ok().contentType(MediaType.APPLICATION_JSON).bodyValue(new Task(id, "ready"));
                    } catch (NumberFormatException error) { return ServerResponse.badRequest().build(); }
                }).andRoute(GET("/events"), request -> ServerResponse.ok().contentType(MediaType.TEXT_EVENT_STREAM)
                        .body(Flux.just("one", "two"), String.class))
                  .andRoute(GET("/large"), request -> ServerResponse.ok().bodyValue("x".repeat(32 * 1024)))
                  .andRoute(GET("/slow"), request -> Mono.never());
                var adapter = new ReactorHttpHandlerAdapter(RouterFunctions.toHttpHandler(routes));
                server = HttpServer.create().host("127.0.0.1").port(0).runOn(serverLoops)
                        .handle(adapter).bindNow(Duration.ofSeconds(5));
                var http = HttpClient.create(pool).runOn(clientLoops).option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 1000)
                        .responseTimeout(Duration.ofSeconds(2));
                client = WebClient.builder().baseUrl("http://127.0.0.1:" + server.port())
                        .clientConnector(new ReactorClientHttpConnector(http))
                        .codecs(codecs -> codecs.defaultCodecs().maxInMemorySize(16 * 1024)).build();
            } catch (RuntimeException error) {
                try { close(); } catch (RuntimeException cleanup) { error.addSuppressed(cleanup); }
                throw error;
            }
        }
        public WebClient client() { return client; }
        @Override public void close() {
            try { pool.disposeLater().block(Duration.ofSeconds(4)); }
            finally {
                try { if (server != null) server.disposeNow(Duration.ofSeconds(4)); }
                finally {
                    try { clientLoops.disposeLater(Duration.ZERO, Duration.ofSeconds(2)).block(Duration.ofSeconds(4)); }
                    finally { serverLoops.disposeLater(Duration.ZERO, Duration.ofSeconds(2)).block(Duration.ofSeconds(4)); }
                }
            }
        }
    }
    public static void main(String[] args) {
        try (var network = new Network()) {
            var client = network.client();
            Task task = client.get().uri("/tasks/7").retrieve().bodyToMono(Task.class)
                    .timeout(Duration.ofSeconds(3)).block(Duration.ofSeconds(4));
            System.out.println("task=" + task.id() + ":" + task.state());
            Integer missing = client.get().uri("/missing").exchangeToMono(response ->
                    response.releaseBody().thenReturn(response.statusCode().value())).block(Duration.ofSeconds(4));
            System.out.println("missing=" + missing);
            var first = client.get().uri("/events").accept(MediaType.TEXT_EVENT_STREAM).retrieve()
                    .bodyToFlux(String.class).take(1).collectList().block(Duration.ofSeconds(4));
            System.out.println("firstEvent=" + first);
        }
    }
}
