package demo.boot;

import demo.boot.conditions.AutoConfigDemo;
import demo.boot.first.FirstApplication;
import demo.boot.lifecycle.LifecycleDemo;
import demo.boot.properties.*;
import demo.boot.starter.StarterDemo;
import io.newswitch.greeting.*;
import org.junit.jupiter.api.*;
import org.springframework.boot.*;
import org.springframework.boot.autoconfigure.condition.ConditionEvaluationReport;
import org.springframework.boot.availability.*;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.context.event.*;
import org.springframework.boot.web.server.servlet.context.*;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.*;
import org.springframework.core.SpringVersion;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;

@Timeout(20)
class StartupSemanticsTest {
    @Nested @TestInstance(TestInstance.Lifecycle.PER_CLASS)
    class HttpTests {
        ConfigurableApplicationContext context; HttpClient client; int port;
        @BeforeAll void open() {
            context = SpringApplication.run(FirstApplication.class, "--server.port=0", "--server.address=127.0.0.1");
            port = ((ServletWebServerApplicationContext) context).getWebServer().getPort(); client = HttpClient.newHttpClient();
        }
        @AfterAll void close() { try { if (client != null) client.close(); } finally { if (context != null) context.close(); } }
        HttpResponse<String> get(String path) throws Exception {
            return client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).timeout(Duration.ofSeconds(3))
                    .GET().build(), HttpResponse.BodyHandlers.ofString());
        }
        @Test void realHttpGetsDefaultGreeting() throws Exception {
            var response = get("/hello"); assertEquals(200, response.statusCode()); assertEquals("hello, Spring", response.body());
        }
        @Test void realQueryParameterReachesController() throws Exception { assertEquals("hello, Java", get("/hello?name=Java").body()); }
        @Test void unmappedRouteIs404() throws Exception { assertEquals(404, get("/missing").statusCode()); }
        @Test void wrongMethodIs405() throws Exception {
            var response = client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/hello"))
                    .timeout(Duration.ofSeconds(3)).POST(HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(405, response.statusCode());
        }
        @Test void serverUsesLoopbackAndAllocatedPort() {
            assertTrue(port > 0); assertEquals("127.0.0.1", context.getEnvironment().getProperty("server.address"));
        }
    }
    @Configuration(proxyBeanMethods = false) static class FailingRunner {
        @Bean ApplicationRunner failure() { return args -> { throw new IllegalStateException("runner failed"); }; }
    }
    static final class Gate {
        final CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
    }
    @Configuration(proxyBeanMethods = false) static class BlockingRunner {
        @Bean ApplicationRunner blocking(Gate gate) {
            return args -> { gate.entered.countDown(); if (!gate.release.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("gate timeout"); };
        }
    }
    @Nested class LifecycleTests {
        @Test void recordsOrderedStartupStages() {
            var trace = new LifecycleDemo.Trace();
            try (var context = LifecycleDemo.start(trace)) {
                assertEquals(List.of("starting", "environment", "contextInitialized", "prepared", "webServer", "started",
                        "applicationRunner", "commandLineRunner", "ready"), trace.stages);
            }
        }
        @Test void runReturnsWithAcceptingReadiness() {
            try (var context = LifecycleDemo.start(new LifecycleDemo.Trace())) {
                assertEquals(ReadinessState.ACCEPTING_TRAFFIC, context.getBean(ApplicationAvailability.class).getReadinessState());
            }
        }
        @Test void runnerFailureEmitsFailedEventAndClosesContext() {
            var captured = new AtomicReference<ConfigurableApplicationContext>(); var failed = new AtomicBoolean();
            var app = new SpringApplication(LifecycleDemo.Config.class, FailingRunner.class);
            app.addInitializers(context -> context.getBeanFactory().registerSingleton("trace", new LifecycleDemo.Trace()));
            app.addListeners(event -> {
                if (event instanceof ApplicationPreparedEvent prepared) captured.set(prepared.getApplicationContext());
                if (event instanceof ApplicationFailedEvent) failed.set(true);
            });
            try {
                var error = assertThrows(RuntimeException.class, app::run);
                assertTrue(error.getMessage().contains("runner") || error.getCause() != null);
                assertTrue(failed.get()); assertNotNull(captured.get()); assertFalse(captured.get().isActive());
            } finally { if (captured.get() != null) captured.get().close(); }
        }
        @Test void listeningPortDoesNotImplyRunnerFinished() throws Exception {
            var gate = new Gate(); var bound = new AtomicReference<ServletWebServerInitializedEvent>();
            var captured = new AtomicReference<ConfigurableApplicationContext>();
            var app = new SpringApplication(LifecycleDemo.Config.class, BlockingRunner.class);
            app.addInitializers(context -> {
                context.getBeanFactory().registerSingleton("trace", new LifecycleDemo.Trace());
                context.getBeanFactory().registerSingleton("gate", gate);
            });
            app.addListeners(event -> { if (event instanceof ServletWebServerInitializedEvent server) { bound.set(server); captured.set(server.getApplicationContext()); } });
            try (var executor = Executors.newSingleThreadExecutor()) {
                Future<ConfigurableApplicationContext> started = executor.submit(() -> app.run());
                try {
                    assertTrue(gate.entered.await(4, TimeUnit.SECONDS)); assertNotNull(bound.get());
                    assertTrue(bound.get().getWebServer().getPort() > 0);
                    assertEquals(ReadinessState.REFUSING_TRAFFIC, captured.get().getBean(ApplicationAvailability.class).getReadinessState());
                    assertFalse(started.isDone());
                } finally {
                    gate.release.countDown();
                    try (var context = started.get(8, TimeUnit.SECONDS)) { assertTrue(context.isActive()); }
                    finally { if (captured.get() != null) captured.get().close(); }
                }
            }
        }
        @Test void applicationArgumentsAreParsed() {
            try (var context = LifecycleDemo.start(new LifecycleDemo.Trace(), "--mode=demo", "input.txt")) {
                var args = context.getBean(ApplicationArguments.class);
                assertEquals(List.of("demo"), args.getOptionValues("mode")); assertEquals(List.of("input.txt"), args.getNonOptionArgs());
            }
        }
    }
    @Nested class DependencyTests {
        @Test void bootRuntimeMatchesFixedBaseline() { assertEquals("4.1.1", SpringBootVersion.getVersion()); }
        @Test void frameworkComesFromBootDependencyManagement() { assertEquals("7.0.9", SpringVersion.getVersion()); }
        @Test void apiIsAvailableAtOrdinaryPackagePath() { assertNotNull(GreetingService.class.getResource("GreetingService.class")); }
        @Test void testsUseJdk25() { assertEquals(25, Runtime.version().feature()); }
    }
    @Nested class ConditionTests {
        @Test void importsResourceCreatesServiceWithoutComponentScan() {
            try (var context = AutoConfigDemo.start(null)) {
                assertEquals(1, context.getBeansOfType(GreetingService.class).size());
                assertEquals("hello, Java", context.getBean(GreetingService.class).greet("Java"));
            }
        }
        @Test void defaultConditionReportMatches() {
            try (var context = AutoConfigDemo.start(null)) { assertTrue(AutoConfigDemo.defaultMatches(context)); }
        }
        @Test void userServiceMakesDefaultDefinitionBackOff() {
            try (var context = AutoConfigDemo.start(AutoConfigDemo.Custom.class)) {
                assertEquals("custom:Java", context.getBean(GreetingService.class).greet("Java"));
                assertFalse(context.containsBean("greetingService")); assertFalse(AutoConfigDemo.defaultMatches(context));
            }
        }
        @Test void propertyDisablesService() {
            try (var context = AutoConfigDemo.start(null, "--newswitch.greeting.enabled=false")) {
                assertTrue(context.getBeansOfType(GreetingService.class).isEmpty());
            }
        }
        @Test void disabledClassConditionHasNegativeReport() {
            try (var context = AutoConfigDemo.start(null, "--newswitch.greeting.enabled=false")) {
                var outcomes = ConditionEvaluationReport.get(context.getBeanFactory()).getConditionAndOutcomesBySource()
                        .get(GreetingAutoConfiguration.class.getName());
                assertNotNull(outcomes); assertFalse(outcomes.isFullMatch());
            }
        }
    }
    @Nested class PropertyTests {
        @Test void fileOverridesCodeDefault() {
            try (var context = PropertyDemo.start()) { assertEquals(Duration.ofMillis(1500), context.getBean(ClientProperties.class).timeout()); }
        }
        @Test void devProfileOverridesBaseFile() {
            try (var context = PropertyDemo.start("--spring.profiles.active=dev")) {
                assertEquals(Duration.ofSeconds(2), context.getBean(ClientProperties.class).timeout());
                assertEquals(12, context.getBean(ClientProperties.class).maxInFlight());
            }
        }
        @Test void prodProfileHasIndependentValues() {
            try (var context = PropertyDemo.start("--spring.profiles.active=prod")) { assertEquals(32, context.getBean(ClientProperties.class).maxInFlight()); }
        }
        @Test void commandLineOverridesProfileAndKeepsSource() {
            try (var context = PropertyDemo.start("--spring.profiles.active=dev", "--lab.client.timeout=750ms")) {
                assertEquals(Duration.ofMillis(750), context.getBean(ClientProperties.class).timeout());
                assertEquals("commandLineArgs", PropertyDemo.source(context.getEnvironment(), "lab.client.timeout"));
            }
        }
        @Test void malformedDurationFailsStartup() { assertThrows(RuntimeException.class, () -> PropertyDemo.start("--lab.client.timeout=nonsense")); }
        @Test void negativeDurationFailsValidation() { assertThrows(RuntimeException.class, () -> PropertyDemo.start("--lab.client.timeout=-1s")); }
        @Test void tooMuchConcurrencyFailsValidation() { assertThrows(RuntimeException.class, () -> PropertyDemo.start("--lab.client.max-in-flight=65")); }
        @Test void endpointIsBoundToUriWithoutMakingNetworkCall() {
            try (var context = PropertyDemo.start()) { assertEquals(URI.create("https://example.invalid"), context.getBean(ClientProperties.class).baseUrl()); }
        }
    }
    private static boolean resourceContains(String resource, String value) throws Exception {
        var urls = GreetingService.class.getClassLoader().getResources(resource);
        while (urls.hasMoreElements()) {
            try (var stream = urls.nextElement().openStream()) {
                if (new String(stream.readAllBytes(), StandardCharsets.UTF_8).contains(value)) return true;
            }
        }
        return false;
    }
    @Nested class StarterTests {
        @Test void candidateResourceIsPresentForConsumer() throws Exception {
            assertTrue(resourceContains("META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports", GreetingAutoConfiguration.class.getName()));
        }
        @Test void consumerNeedsNoExplicitImportOfLibrary() {
            try (var context = new SpringApplicationBuilder(StarterDemo.Consumer.class).web(WebApplicationType.NONE)
                    .run("--newswitch.greeting.prefix=welcome")) {
                assertEquals("welcome, Java", context.getBean(GreetingService.class).greet("Java"));
                assertEquals(1, context.getBeansOfType(GreetingService.class).size());
            }
        }
        @Test void annotationProcessorGeneratedPropertyMetadata() throws Exception {
            assertTrue(resourceContains("META-INF/spring-configuration-metadata.json", "newswitch.greeting.prefix"));
        }
    }
}
