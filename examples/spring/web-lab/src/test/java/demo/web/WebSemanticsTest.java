package demo.web;

import demo.web.async.AsyncDemo;
import demo.web.binding.BindingDemo;
import demo.web.boundaries.WebBoundaryDemo;
import demo.web.mvc.DispatchDemo;
import demo.web.reactive.WebFluxDemo;
import demo.web.support.*;
import jakarta.servlet.http.*;
import org.junit.jupiter.api.*;
import org.reactivestreams.Subscription;
import org.springframework.core.io.buffer.DataBufferLimitException;
import org.springframework.http.MediaType;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import reactor.core.publisher.*;
import reactor.test.StepVerifier;
import tools.jackson.databind.json.JsonMapper;
import java.io.IOException;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

@Timeout(15)
class WebSemanticsTest {
    private static HttpResponse<String> send(HttpClient client, URI uri) throws Exception {
        return client.send(HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(3)).GET().build(),
                HttpResponse.BodyHandlers.ofString());
    }
    private static boolean causedBy(Throwable error, Class<? extends Throwable> type) {
        for (Throwable current = error; current != null; current = current.getCause())
            if (type.isInstance(current)) return true;
        return false;
    }

    @Nested @TestInstance(TestInstance.Lifecycle.PER_CLASS)
    class ServletTests {
        EmbeddedTomcat server; HttpClient client;
        final AtomicReference<Thread> thread = new AtomicReference<>();
        final AtomicInteger calls = new AtomicInteger();
        @BeforeAll void open() throws Exception {
            server = new EmbeddedTomcat(); client = HttpClient.newHttpClient();
            server.servlet("hello", "/hello", new HttpServlet() {
                @Override protected void doGet(HttpServletRequest req, HttpServletResponse res) throws IOException {
                    thread.set(Thread.currentThread()); calls.incrementAndGet();
                    res.setContentType("text/plain;charset=UTF-8"); res.getWriter().write("hello");
                }
            });
            server.start();
        }
        @AfterAll void close() throws Exception {
            try { if (client != null) client.close(); } finally { if (server != null) server.close(); }
        }
        @Test void realHttpReturnsBodyAndCharset() throws Exception {
            var response = send(client, server.baseUri().resolve("/hello"));
            assertEquals(200, response.statusCode()); assertEquals("hello", response.body());
            assertTrue(response.headers().firstValue("content-type").orElseThrow().toLowerCase(Locale.ROOT).contains("utf-8"));
        }
        @Test void servletRunsOnServerThread() throws Exception {
            send(client, server.baseUri().resolve("/hello")); assertNotNull(thread.get());
            assertNotSame(Thread.currentThread(), thread.get());
        }
        @Test void unsupportedMethodDoesNotExecuteGet() throws Exception {
            int before = calls.get();
            var response = client.send(HttpRequest.newBuilder(server.baseUri().resolve("/hello"))
                    .timeout(Duration.ofSeconds(3)).POST(HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(405, response.statusCode()); assertEquals(before, calls.get());
        }
        @Test void unmappedServletIs404() throws Exception {
            assertEquals(404, send(client, server.baseUri().resolve("/absent")).statusCode());
        }
    }

    @Nested @TestInstance(TestInstance.Lifecycle.PER_CLASS)
    class DispatchTests {
        RunningMvc server; HttpClient client;
        @BeforeAll void open() throws Exception { server = new RunningMvc(DispatchDemo.Config.class); client = HttpClient.newHttpClient(); }
        @AfterAll void close() throws Exception {
            try { if (client != null) client.close(); } finally { if (server != null) server.close(); }
        }
        @Test void dispatchesPathVariable() throws Exception {
            var response = send(client, server.baseUri().resolve("/tasks/7"));
            assertEquals(200, response.statusCode()); assertEquals("task:7", response.body());
        }
        @Test void methodMismatchIs405() throws Exception {
            var response = client.send(HttpRequest.newBuilder(server.baseUri().resolve("/tasks/7"))
                    .timeout(Duration.ofSeconds(3)).POST(HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(405, response.statusCode());
        }
        @Test void pathConversionFailureIs400() throws Exception {
            assertEquals(400, send(client, server.baseUri().resolve("/tasks/not-a-number")).statusCode());
        }
        @Test void unmappedMvcPathIs404() throws Exception {
            assertEquals(404, send(client, server.baseUri().resolve("/missing")).statusCode());
        }
        @Test void controllerIsRegisteredAtStartup() {
            var mapping = server.context().getBean(RequestMappingHandlerMapping.class);
            assertEquals(1, mapping.getHandlerMethods().values().stream()
                    .filter(method -> method.getBeanType().equals(DispatchDemo.Tasks.class)).count());
        }
    }

    @Nested @TestInstance(TestInstance.Lifecycle.PER_CLASS)
    class BindingTests {
        MockMvcFixture fixture; MockMvc mvc;
        final JsonMapper json = JsonMapper.builder().build();
        @BeforeAll void open() { fixture = new MockMvcFixture(BindingDemo.Config.class); mvc = fixture.mvc(); }
        @AfterAll void close() { if (fixture != null) fixture.close(); }
        @Test void createdResponseHasLocationAndJson() throws Exception {
            var response = mvc.perform(post("/tasks").contentType(MediaType.APPLICATION_JSON)
                    .content("{\"title\":\"report\",\"priority\":1}")).andReturn().getResponse();
            assertEquals(201, response.getStatus()); assertEquals("/tasks/42", response.getHeader("Location"));
            assertEquals(42, json.readTree(response.getContentAsString()).get("id").asInt());
            assertEquals("report", json.readTree(response.getContentAsString()).get("title").asText());
        }
        @Test void blankTitleIsProblem400() throws Exception {
            var response = mvc.perform(post("/tasks").contentType(MediaType.APPLICATION_JSON)
                    .content("{\"title\":\"\",\"priority\":1}")).andReturn().getResponse();
            assertEquals(400, response.getStatus());
            assertTrue(response.getContentType().startsWith("application/problem+json"));
            assertEquals("INVALID_REQUEST", json.readTree(response.getContentAsString()).get("code").asText());
        }
        @Test void priorityConstraintIsChecked() throws Exception {
            assertEquals(400, mvc.perform(post("/tasks").contentType(MediaType.APPLICATION_JSON)
                    .content("{\"title\":\"report\",\"priority\":0}")).andReturn().getResponse().getStatus());
        }
        @Test void malformedJsonIs400() throws Exception {
            assertEquals(400, mvc.perform(post("/tasks").contentType(MediaType.APPLICATION_JSON)
                    .content("{")).andReturn().getResponse().getStatus());
        }
        @Test void absentResourceIs404() throws Exception {
            var response = mvc.perform(get("/tasks/404")).andReturn().getResponse();
            assertEquals(404, response.getStatus());
            assertEquals("TASK_NOT_FOUND", json.readTree(response.getContentAsString()).get("code").asText());
        }
        @Test void pathTypeMismatchIs400() throws Exception {
            assertEquals(400, mvc.perform(get("/tasks/abc")).andReturn().getResponse().getStatus());
        }
        @Test void methodParameterConstraintIs400() throws Exception {
            assertEquals(400, mvc.perform(get("/search").param("limit", "0")).andReturn().getResponse().getStatus());
        }
        @Test void validQueryRunsController() throws Exception {
            var response = mvc.perform(get("/search").param("limit", "2")).andReturn().getResponse();
            assertEquals(200, response.getStatus()); assertEquals("limit:2", response.getContentAsString());
        }
        @Test void wrongInputMediaTypeIs415() throws Exception {
            assertEquals(415, mvc.perform(post("/tasks").contentType(MediaType.TEXT_PLAIN)
                    .content("report")).andReturn().getResponse().getStatus());
        }
    }

    @Nested @TestInstance(TestInstance.Lifecycle.PER_CLASS)
    class BoundaryTests {
        MockMvcFixture fixture; MockMvc mvc; WebBoundaryDemo.Trace trace;
        @BeforeAll void open() {
            fixture = new MockMvcFixture(WebBoundaryDemo.Config.class);
            trace = fixture.context().getBean(WebBoundaryDemo.Trace.class);
            mvc = MockMvcBuilders.webAppContextSetup(fixture.context()).addFilters(new WebBoundaryDemo.TraceFilter(trace)).build();
        }
        @BeforeEach void clear() { trace.events.clear(); }
        @AfterAll void close() { if (fixture != null) fixture.close(); }
        @Test void successHasPostHandle() throws Exception {
            assertEquals(200, mvc.perform(get("/work")).andReturn().getResponse().getStatus());
            assertEquals(List.of("filter:before", "interceptor:pre", "controller", "aspect:before", "service",
                    "aspect:after", "interceptor:post", "interceptor:after", "filter:after"), trace.events);
        }
        @Test void handledExceptionSkipsPostHandle() throws Exception {
            assertEquals(409, mvc.perform(get("/work").param("fail", "true")).andReturn().getResponse().getStatus());
            assertEquals(List.of("filter:before", "interceptor:pre", "controller", "aspect:before", "service",
                    "aspect:after", "advice:exception", "interceptor:after", "filter:after"), trace.events);
        }
        @Test void filterCanStopBeforeMvc() throws Exception {
            assertEquals(403, mvc.perform(get("/blocked")).andReturn().getResponse().getStatus());
            assertEquals(List.of("filter:before", "filter:after"), trace.events);
        }
        @Test void filterExceptionDoesNotAutomaticallyReachAdvice() {
            var failing = MockMvcBuilders.webAppContextSetup(fixture.context()).addFilters((request, response, chain) -> {
                throw new WebBoundaryDemo.Conflict();
            }).build();
            assertThrows(WebBoundaryDemo.Conflict.class, () -> failing.perform(get("/work")));
            assertTrue(trace.events.isEmpty());
        }
    }

    @Nested @TestInstance(TestInstance.Lifecycle.PER_CLASS)
    class AsyncTests {
        RunningMvc server; HttpClient client;
        @BeforeAll void open() throws Exception { server = new RunningMvc(AsyncDemo.Config.class, true); client = HttpClient.newHttpClient(); }
        @AfterAll void close() throws Exception {
            try { if (client != null) client.close(); } finally { if (server != null) server.close(); }
        }
        @Test void callableCompletesOverHttp() throws Exception {
            var response = send(client, server.baseUri().resolve("/callable"));
            assertEquals(200, response.statusCode()); assertEquals("async", response.body());
        }
        @Test void sseHasEventStreamMediaType() throws Exception {
            var response = send(client, server.baseUri().resolve("/events"));
            assertEquals(200, response.statusCode());
            assertTrue(response.headers().firstValue("content-type").orElseThrow().startsWith("text/event-stream"));
        }
        @Test void sseFramesContainTwoValues() throws Exception {
            var response = send(client, server.baseUri().resolve("/events"));
            assertEquals(List.of("data:one", "data:two"), response.body().lines().filter(line -> line.startsWith("data:")).toList());
            assertEquals(2, response.body().lines().filter(line -> line.equals("event:task")).count());
        }
        @Test void realWebSocketEchoWorks() throws Exception {
            assertEquals("echo:hello", AsyncDemo.echo(client, URI.create(server.baseUri().toString().replace("http:", "ws:") + "/ws")));
        }
        @Test void asyncExecutorHasFiniteLimits() {
            var executor = server.context().getBean(ThreadPoolTaskExecutor.class);
            assertEquals(2, executor.getCorePoolSize()); assertEquals(2, executor.getMaxPoolSize());
            assertEquals(4, executor.getQueueCapacity());
        }
    }

    @Nested
    class ReactorTests {
        @Test void callableIsLazy() {
            var count = new AtomicInteger(); var mono = Mono.fromCallable(count::incrementAndGet);
            assertEquals(0, count.get()); StepVerifier.create(mono).expectNext(1).verifyComplete();
        }
        @Test void coldSourceRunsForEachSubscription() {
            var count = new AtomicInteger(); var mono = Mono.fromCallable(count::incrementAndGet);
            StepVerifier.create(mono).expectNext(1).verifyComplete();
            StepVerifier.create(mono).expectNext(2).verifyComplete();
        }
        @Test void demandAndCancelAreObserved() {
            var cancelled = new AtomicBoolean(); var requests = new ArrayList<Long>();
            StepVerifier.create(Flux.range(1, 5).doOnRequest(requests::add).doOnCancel(() -> cancelled.set(true)), 0)
                    .thenRequest(2).expectNext(1, 2).thenCancel().verify(Duration.ofSeconds(2));
            assertEquals(List.of(2L), requests); assertTrue(cancelled.get());
        }
        @Test void timeoutUsesVirtualTimeAndCancelsSource() {
            var cancelled = new AtomicBoolean();
            StepVerifier.withVirtualTime(() -> Mono.never().doOnCancel(() -> cancelled.set(true)).timeout(Duration.ofSeconds(5)))
                    .expectSubscription().thenAwait(Duration.ofSeconds(5)).expectError(java.util.concurrent.TimeoutException.class)
                    .verify(Duration.ofSeconds(2));
            assertTrue(cancelled.get());
        }
        @Test void errorRecoverySwitchesSource() {
            StepVerifier.create(Mono.error(new IllegalStateException("failed")).onErrorResume(error -> Mono.just("fallback")))
                    .expectNext("fallback").verifyComplete();
        }
        @Test void contextBelongsToSubscription() {
            var source = Mono.deferContextual(context -> Mono.just(context.<String>get("id")));
            StepVerifier.create(source.contextWrite(context -> context.put("id", "one"))).expectNext("one").verifyComplete();
            StepVerifier.create(source.contextWrite(context -> context.put("id", "two"))).expectNext("two").verifyComplete();
        }
    }

    @Nested @TestInstance(TestInstance.Lifecycle.PER_CLASS)
    class ReactiveHttpTests {
        WebFluxDemo.Network network;
        @BeforeAll void open() { network = new WebFluxDemo.Network(); }
        @AfterAll void close() { if (network != null) network.close(); }
        @Test void realJsonDecodesIntoRecord() {
            var task = network.client().get().uri("/tasks/7").retrieve().bodyToMono(WebFluxDemo.Task.class).block(Duration.ofSeconds(4));
            assertEquals(new WebFluxDemo.Task(7, "ready"), task);
        }
        @Test void invalidPathIs400() {
            var status = network.client().get().uri("/tasks/abc").exchangeToMono(response ->
                    response.releaseBody().thenReturn(response.statusCode().value())).block(Duration.ofSeconds(4));
            assertEquals(400, status);
        }
        @Test void missingRouteIs404() {
            var status = network.client().get().uri("/missing").exchangeToMono(response ->
                    response.releaseBody().thenReturn(response.statusCode().value())).block(Duration.ofSeconds(4));
            assertEquals(404, status);
        }
        @Test void sseDeliversOneThenCancels() {
            var first = network.client().get().uri("/events").accept(MediaType.TEXT_EVENT_STREAM).retrieve()
                    .bodyToFlux(String.class).take(1).collectList().block(Duration.ofSeconds(4));
            assertEquals(List.of("one"), first);
        }
        @Test void aggregatedBodyHasFiniteLimit() {
            var error = assertThrows(RuntimeException.class, () -> network.client().get().uri("/large")
                    .retrieve().bodyToMono(String.class).block(Duration.ofSeconds(4)));
            assertTrue(causedBy(error, DataBufferLimitException.class), error.toString());
        }
        @Test void totalDeadlineFailsNeverEndingResponse() {
            var error = assertThrows(RuntimeException.class, () -> network.client().get().uri("/slow").retrieve()
                    .bodyToMono(String.class).timeout(Duration.ofMillis(150)).block(Duration.ofSeconds(3)));
            assertTrue(causedBy(error, java.util.concurrent.TimeoutException.class), error.toString());
        }
        @Test void repeatedReleasedResponsesDoNotExhaustTwoConnectionPool() {
            for (int i = 0; i < 8; i++) {
                var status = network.client().get().uri("/missing").exchangeToMono(response ->
                        response.releaseBody().thenReturn(response.statusCode().value())).block(Duration.ofSeconds(4));
                assertEquals(404, status);
            }
        }
    }
}
