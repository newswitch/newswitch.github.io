package lab.telemetry;

import com.sun.net.httpserver.HttpServer;
import io.opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest;
import io.opentelemetry.proto.trace.v1.Span;
import io.opentelemetry.sdk.trace.SdkTracerProvider;
import java.net.*;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
class TelemetryTest {
    static final List<Span> SPANS=new CopyOnWriteArrayList<>();
    static volatile boolean rejectExport;
    static final java.util.concurrent.atomic.AtomicInteger rejectedExports=new java.util.concurrent.atomic.AtomicInteger();
    static final HttpServer RECEIVER=receiver();
    static HttpServer receiver() {
        try {
            var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
            server.createContext("/v1/traces",exchange->{
                if(rejectExport) { rejectedExports.incrementAndGet(); exchange.getRequestBody().readAllBytes(); exchange.sendResponseHeaders(401,-1); exchange.close(); return; }
                var request=ExportTraceServiceRequest.parseFrom(exchange.getRequestBody());
                request.getResourceSpansList().forEach(r->r.getScopeSpansList().forEach(s->SPANS.addAll(s.getSpansList())));
                exchange.getResponseHeaders().set("Content-Type","application/x-protobuf");
                exchange.sendResponseHeaders(200,-1); exchange.close();
            }); server.start(); return server;
        } catch(Exception e) { throw new IllegalStateException(e); }
    }
    @DynamicPropertySource static void config(DynamicPropertyRegistry properties) {
        properties.add("management.opentelemetry.tracing.export.otlp.endpoint",()->"http://127.0.0.1:"+RECEIVER.getAddress().getPort()+"/v1/traces");
    }
    @LocalServerPort int port;
    @Autowired SdkTracerProvider provider;
    @AfterAll static void stop() { RECEIVER.stop(0); }
    HttpResponse<String> get(String path) throws Exception {
        try(var client=HttpClient.newHttpClient()) {
            return client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path)).timeout(Duration.ofSeconds(5)).GET().build(),HttpResponse.BodyHandlers.ofString());
        }
    }
    @Test void actualOtlpExportContainsSiblingWaitAndHoldSpans() throws Exception {
        SPANS.clear(); var response=get("/work?holdMs=10"); assertEquals(200,response.statusCode());
        provider.forceFlush().join(5,java.util.concurrent.TimeUnit.SECONDS);
        var wait=SPANS.stream().filter(s->s.getName().equals("db.acquire")).findFirst().orElseThrow();
        var hold=SPANS.stream().filter(s->s.getName().equals("db.hold")).findFirst().orElseThrow();
        assertEquals(wait.getTraceId(),hold.getTraceId()); assertEquals(wait.getParentSpanId(),hold.getParentSpanId());
        assertFalse(wait.getParentSpanId().isEmpty());
        assertTrue(hold.getEndTimeUnixNano()-hold.getStartTimeUnixNano()>=10_000_000L);
    }
    @Test void prometheusExposesRequestAndHikariMetrics() throws Exception {
        get("/work?holdMs=0"); var response=get("/actuator/prometheus");
        assertEquals(200,response.statusCode()); assertTrue(response.body().contains("hikaricp_connections_max"));
        assertTrue(response.body().contains("lab_work_attempts_total"));
    }
    @Test void invalidDelayIsRejected() throws Exception { assertEquals(400,get("/work?holdMs=999").statusCode()); }
    @Test void exporterRejectionDoesNotFailBusinessRequest() throws Exception {
        provider.forceFlush().join(3,java.util.concurrent.TimeUnit.SECONDS);
        int before=rejectedExports.get(); rejectExport=true;
        try {
            assertEquals(200,get("/work?holdMs=0").statusCode());
            provider.forceFlush().join(3,java.util.concurrent.TimeUnit.SECONDS);
            assertTrue(rejectedExports.get()>before);
        } finally { rejectExport=false; }
    }
}
