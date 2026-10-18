package demo.web.async;

import demo.web.support.RunningMvc;
import org.springframework.context.annotation.*;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.config.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import org.springframework.web.socket.*;
import org.springframework.web.socket.config.annotation.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

public final class AsyncDemo {
    @Configuration(proxyBeanMethods = false) @EnableWebMvc @EnableWebSocket
    public static class Config {
        @Bean public ThreadPoolTaskExecutor webTasks() {
            var executor = new ThreadPoolTaskExecutor();
            executor.setCorePoolSize(2); executor.setMaxPoolSize(2); executor.setQueueCapacity(4);
            executor.setThreadNamePrefix("web-task-"); executor.setAwaitTerminationSeconds(2);
            return executor;
        }
        @Bean public Tasks tasks(ThreadPoolTaskExecutor webTasks) { return new Tasks(webTasks); }
        @Bean public WebMvcConfigurer async(ThreadPoolTaskExecutor webTasks) {
            return new WebMvcConfigurer() {
                @Override public void configureAsyncSupport(AsyncSupportConfigurer config) {
                    config.setTaskExecutor(webTasks); config.setDefaultTimeout(2000);
                }
            };
        }
        @Bean public WebSocketConfigurer sockets() {
            return registry -> registry.addHandler(new TextWebSocketHandler() {
                @Override protected void handleTextMessage(WebSocketSession session, TextMessage message)
                        throws Exception { session.sendMessage(new TextMessage("echo:" + message.getPayload())); }
            }, "/ws");
        }
    }
    @RestController public static class Tasks {
        private final ThreadPoolTaskExecutor executor;
        public Tasks(ThreadPoolTaskExecutor executor) { this.executor = executor; }
        @GetMapping("/callable") public Callable<String> callable() { return () -> "async"; }
        @GetMapping(value = "/events", produces = "text/event-stream") public SseEmitter events() {
            var emitter = new SseEmitter(2000L);
            var future = new AtomicReference<Future<?>>();
            var stopped = new AtomicBoolean();
            Runnable cancel = () -> {
                stopped.set(true); var task = future.get(); if (task != null) task.cancel(true);
            };
            emitter.onTimeout(cancel); emitter.onCompletion(cancel); emitter.onError(error -> cancel.run());
            future.set(executor.submit(() -> {
                try {
                    emitter.send(SseEmitter.event().name("task").data("one"));
                    emitter.send(SseEmitter.event().name("task").data("two"));
                    emitter.complete();
                } catch (Exception error) { emitter.completeWithError(error); }
            }));
            if (stopped.get()) future.get().cancel(true);
            return emitter;
        }
    }
    public static String echo(HttpClient client, URI uri) throws Exception {
        var reply = new CompletableFuture<String>();
        var socket = client.newWebSocketBuilder().connectTimeout(Duration.ofSeconds(3))
                .buildAsync(uri, new java.net.http.WebSocket.Listener() {
                    private final StringBuilder text = new StringBuilder();
                    @Override public void onOpen(java.net.http.WebSocket ws) { ws.request(1); }
                    @Override public CompletionStage<?> onText(java.net.http.WebSocket ws, CharSequence data, boolean last) {
                        text.append(data);
                        if (last) reply.complete(text.toString());
                        ws.request(1); return CompletableFuture.completedFuture(null);
                    }
                    @Override public void onError(java.net.http.WebSocket ws, Throwable error) { reply.completeExceptionally(error); }
                }).get(3, TimeUnit.SECONDS);
        try {
            socket.sendText("hello", true).get(3, TimeUnit.SECONDS);
            return reply.get(3, TimeUnit.SECONDS);
        } finally { socket.abort(); }
    }
    public static void main(String[] args) throws Exception {
        try (var server = new RunningMvc(Config.class, true); var client = HttpClient.newHttpClient()) {
            var callable = client.send(HttpRequest.newBuilder(server.baseUri().resolve("/callable"))
                    .timeout(Duration.ofSeconds(3)).GET().build(), HttpResponse.BodyHandlers.ofString());
            System.out.println("callable=" + callable.body());
            var events = client.send(HttpRequest.newBuilder(server.baseUri().resolve("/events"))
                    .timeout(Duration.ofSeconds(3)).GET().build(), HttpResponse.BodyHandlers.ofString());
            System.out.println("sseEvents=" + events.body().lines().filter(line -> line.startsWith("data:")).count());
            System.out.println("websocket=" + echo(client, URI.create(server.baseUri().toString().replace("http:", "ws:") + "/ws")));
        }
    }
}
