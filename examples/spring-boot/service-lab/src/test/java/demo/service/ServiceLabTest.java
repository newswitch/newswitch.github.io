package demo.service;

import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
class ServiceLabTest {
    @Autowired WebApplicationContext context;
    @Autowired TaskService service;
    @Autowired JdbcTemplate jdbc;
    @Autowired JsonMapper json;
    @LocalServerPort int port;
    MockMvc mvc;
    @BeforeEach void setup() {
        mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        jdbc.update("DELETE FROM outbox"); jdbc.update("DELETE FROM task");
    }
    @Test void healthUsesRealLoopbackHttp() throws Exception {
        try (HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build()) {
            var result = client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/actuator/health"))
                    .timeout(Duration.ofSeconds(3)).GET().build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(200, result.statusCode()); assertEquals("UP", json.readTree(result.body()).path("status").asText());
        }
    }
    @Test void unauthenticatedIs401() throws Exception { mvc.perform(get("/api/tasks")).andExpect(status().isUnauthorized()); }
    @Test void normalUserCannotSeeMetrics() throws Exception { mvc.perform(get("/actuator/metrics").with(user("alice").roles("USER"))).andExpect(status().isForbidden()); }
    @Test void csrfRejectsWrite() throws Exception { mvc.perform(post("/api/tasks").with(user("alice")).header("Idempotency-Key","a").contentType("application/json").content("{\"name\":\"a\"}")).andExpect(status().isForbidden()); }
    @Test void validWriteReturnsLocation() throws Exception { mvc.perform(post("/api/tasks").with(user("alice")).with(csrf()).header("Idempotency-Key","a").contentType("application/json").content("{\"name\":\"learn\"}"))
            .andExpect(status().isCreated()).andExpect(header().exists("Location")).andExpect(jsonPath("$.status").value("NEW")); }
    @ParameterizedTest @ValueSource(strings={"", " ", "\t"}) void blankNameIs400(String name) throws Exception {
        mvc.perform(post("/api/tasks").with(user("alice")).with(csrf()).header("Idempotency-Key","a")
                .contentType("application/json").content(json.writeValueAsString(Map.of("name",name))))
                .andExpect(status().isBadRequest()).andExpect(content().contentTypeCompatibleWith("application/problem+json"));
    }
    @Test void tooLongNameIs400() throws Exception { mvc.perform(post("/api/tasks").with(user("alice")).with(csrf()).header("Idempotency-Key","a").contentType("application/json").content(json.writeValueAsString(Map.of("name","x".repeat(81)))))
            .andExpect(status().isBadRequest()); }
    @Test void malformedJsonIs400() throws Exception { mvc.perform(post("/api/tasks").with(user("alice")).with(csrf()).header("Idempotency-Key","a").contentType("application/json").content("{"))
            .andExpect(status().isBadRequest()); }
    @Test void missingKeyIs400() throws Exception { mvc.perform(post("/api/tasks").with(user("alice")).with(csrf()).contentType("application/json").content("{\"name\":\"a\"}"))
            .andExpect(status().isBadRequest()); }
    @Test void unsupportedMediaIs415() throws Exception { mvc.perform(post("/api/tasks").with(user("alice")).with(csrf()).header("Idempotency-Key","a").contentType("text/plain").content("a"))
            .andExpect(status().isUnsupportedMediaType()); }
    @Test void missingTaskIs404() throws Exception { mvc.perform(get("/api/tasks/missing").with(user("alice"))).andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("TASK_NOT_FOUND")); }
    @Test void tenantCannotReadAnotherTask() throws Exception { var task=service.create("alpha","a","a"); mvc.perform(get("/api/tasks/"+task.id()).with(user("bob"))).andExpect(status().isNotFound()); }
    @Test void tenantHeaderCannotSwitchIdentity() throws Exception { service.create("beta","a","a"); mvc.perform(get("/api/tasks").with(user("alice")).header("X-Tenant","beta")).andExpect(content().json("[]")); }
    @Test void unknownTenantIsDenied() throws Exception { mvc.perform(get("/api/tasks").with(user("mallory"))).andExpect(status().isForbidden()); }
    @Test void sameKeySameRequestReturnsSameTask() { var a=service.create("alpha","k","a"); assertEquals(a,service.create("alpha","k","a")); assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM outbox",Integer.class)); }
    @Test void sameKeyDifferentRequestConflicts() { service.create("alpha","k","a"); assertThrows(TaskService.Conflict.class,()->service.create("alpha","k","b")); }
    @Test void tenantsHaveSeparateKeys() { assertNotEquals(service.create("alpha","k","a").id(),service.create("beta","k","a").id()); }
    @Test void cancelChecksVersionAndState() { var a=service.create("alpha","k","a"); var b=service.cancel("alpha",a.id(),0); assertEquals("CANCELLED",b.status()); assertEquals(1,b.version()); assertThrows(TaskService.Conflict.class,()->service.cancel("alpha",a.id(),0)); }
    @Test void cancelOtherTenantIsMissing() { var a=service.create("alpha","k","a"); assertThrows(TaskService.Missing.class,()->service.cancel("beta",a.id(),0)); }
    @Test void cancelProducesOneEvent() { var a=service.create("alpha","k","a"); service.cancel("alpha",a.id(),0); assertEquals(2,jdbc.queryForObject("SELECT COUNT(*) FROM outbox",Integer.class)); }
    @Test void outboxFailureRollsBackTask() {
        jdbc.execute("ALTER TABLE outbox ADD CONSTRAINT reject_event CHECK (event_type <> 'TaskCreated')");
        try { assertThrows(org.springframework.dao.DataIntegrityViolationException.class,()->service.create("alpha","k","a")); assertEquals(0,jdbc.queryForObject("SELECT COUNT(*) FROM task",Integer.class)); }
        finally { jdbc.execute("ALTER TABLE outbox DROP CONSTRAINT reject_event"); }
    }
    @ParameterizedTest @ValueSource(ints={-1,0,101}) void pageLimitIsBounded(int limit) { assertThrows(IllegalArgumentException.class,()->service.list("alpha","",limit)); }
    @Test void keysetPaginationDoesNotRepeat() { for(int i=0;i<4;i++) service.create("alpha","k"+i,"a"); var first=service.list("alpha","",2); var second=service.list("alpha",first.getLast().id(),2); assertEquals(2,second.size()); assertTrue(Collections.disjoint(first,second)); }
    @Test void concurrentIdempotencyCreatesOneRow() throws Exception {
        try(var pool=Executors.newFixedThreadPool(4)) {
            List<Future<TaskService.Task>> futures=new ArrayList<>();
            for(int i=0;i<8;i++) futures.add(pool.submit(()->service.create("alpha","same","a")));
            Set<String> ids=new HashSet<>(); for(var future:futures) ids.add(future.get(5,TimeUnit.SECONDS).id());
            assertEquals(1,ids.size()); assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM task",Integer.class));
        }
    }
    @Test void jdbcParametersDoNotBecomeSql() { String name="x'); DROP TABLE task; --"; var task=service.create("alpha","k",name); assertEquals(name,service.get("alpha",task.id()).name()); }
    @Test void actualBasicPasswordWorks() throws Exception { mvc.perform(get("/api/tasks").with(httpBasic("alice","lab-only-alice"))).andExpect(status().isOk()); }
    @Test void badPasswordIs401() throws Exception { mvc.perform(get("/api/tasks").with(httpBasic("alice","wrong"))).andExpect(status().isUnauthorized()); }
}
