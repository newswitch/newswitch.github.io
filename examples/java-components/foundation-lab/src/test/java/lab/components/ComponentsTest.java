package lab.components;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "spring.profiles.active=docs")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ComponentsTest {
    @LocalServerPort int port;
    @Autowired TaskMapper mapper;
    @Autowired LabProperties properties;
    @Autowired JsonMapper json;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2))
            .followRedirects(HttpClient.Redirect.NORMAL).build();

    @AfterAll void close() { client.close(); }

    private HttpResponse<String> request(String path, String body) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                .timeout(Duration.ofSeconds(5));
        if (body != null) request.header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body));
        return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    @Test void lombokGeneratesMembersAndBuilderDefault() {
        var item = WorkItem.builder().id("t1").name("first").internalNote("secret").build();
        assertEquals("first", item.getName());
        assertEquals("NEW", item.getStatus());
        assertFalse(item.toString().contains("secret"));
    }
    @Test void mapstructMapsRenamedProperty() {
        assertEquals(new TaskView("t1", "first"), mapper.toView(WorkItem.builder().id("t1").name("first").build()));
    }
    @Test void nullSourceReturnsNull() { assertNull(mapper.toView(null)); }
    @Test void nullPatchPreservesExistingName() {
        var item = WorkItem.builder().id("t1").name("first").tenant("a").build();
        mapper.patchName(new TaskMapper.NamePatch(null), item);
        assertEquals("first", item.getName());
        assertEquals("a", item.getTenant());
    }
    @Test void patchChangesOnlyWhitelistedField() {
        var item = WorkItem.builder().id("t1").name("first").tenant("a").build();
        mapper.patchName(new TaskMapper.NamePatch("second"), item);
        assertEquals("second", item.getName());
        assertEquals("t1", item.getId());
        assertEquals("a", item.getTenant());
    }
    @Test void runtimeBinderConvertsDuration() {
        assertEquals("hello", properties.greeting());
        assertEquals(Duration.ofSeconds(2), properties.timeout());
    }
    @Test void metadataIsGeneratedAtCompileTime() throws Exception {
        try (var stream = getClass().getClassLoader().getResourceAsStream("META-INF/spring-configuration-metadata.json")) {
            assertNotNull(stream);
            var metadata = json.readTree(stream);
            assertTrue(metadata.toString().contains("lab.greeting"));
            assertTrue(metadata.toString().contains("java.time.Duration"));
        }
    }
    @Test void publicJsonContainsOnlyDtoProperties() throws Exception {
        var response = request("/api/tasks/t1", null);
        assertEquals(200, response.statusCode());
        var body = json.readTree(response.body());
        assertEquals(2, body.size());
        assertEquals("t1", body.get("id").asString());
        assertEquals("hello", body.get("title").asString());
    }
    @Test void invalidInputIsRejectedAtRuntime() throws Exception {
        assertEquals(400, request("/api/tasks", "{\"name\":\"\"}").statusCode());
    }
    @Test void validInputIsMappedButNotPersisted() throws Exception {
        var response = request("/api/tasks", "{\"name\":\"sample\"}");
        assertEquals(200, response.statusCode());
        assertEquals("sample", json.readTree(response.body()).get("title").asString());
    }
    @Test void openApiDescribesOnlyTaskGroup() throws Exception {
        var response = request("/v3/api-docs/tasks", null);
        assertEquals(200, response.statusCode());
        var document = json.readTree(response.body());
        assertTrue(document.get("openapi").asString().startsWith("3."));
        assertTrue(document.get("paths").has("/api/tasks/{id}"));
        assertFalse(document.get("paths").has("/internal/dev-info"));
        assertFalse(document.get("components").get("schemas").get("TaskView").get("properties").has("internalNote"));
    }
    @Test void swaggerUiHtmlIsAvailableInDocsProfile() throws Exception {
        var response = request("/swagger-ui/index.html", null);
        assertEquals(200, response.statusCode());
        assertTrue(response.body().contains("Swagger UI"));
    }
}
