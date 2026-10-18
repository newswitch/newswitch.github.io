package demo.web.binding;

import demo.web.support.MockMvcFixture;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.context.annotation.*;
import org.springframework.http.*;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.method.annotation.*;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import tools.jackson.databind.json.JsonMapper;
import java.net.URI;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

public final class BindingDemo {
    public record CreateTask(@NotBlank @Size(max = 40) String title, @Min(1) int priority) {}
    public record Task(long id, String title) {}
    public static class MissingTask extends RuntimeException {}
    @Configuration(proxyBeanMethods = false) @EnableWebMvc
    public static class Config {
        @Bean public Tasks tasks() { return new Tasks(); }
        @Bean public Errors errors() { return new Errors(); }
        @Bean public LocalValidatorFactoryBean validator() {
            return new LocalValidatorFactoryBean();
        }
        @Bean public WebMvcConfigurer validation(LocalValidatorFactoryBean validator) {
            return new WebMvcConfigurer() {
                @Override public org.springframework.validation.Validator getValidator() { return validator; }
            };
        }
    }
    @RestController
    public static class Tasks {
        @PostMapping(value = "/tasks", consumes = "application/json")
        public ResponseEntity<Task> create(@Valid @RequestBody CreateTask input) {
            return ResponseEntity.created(URI.create("/tasks/42")).body(new Task(42, input.title()));
        }
        @GetMapping("/tasks/{id}") public Task get(@PathVariable("id") long id) {
            if (id != 42) throw new MissingTask();
            return new Task(42, "report");
        }
        @GetMapping("/search") public String search(@RequestParam("limit") @Min(1) int limit) {
            return "limit:" + limit;
        }
    }
    @RestControllerAdvice
    public static class Errors {
        @ExceptionHandler({MethodArgumentNotValidException.class, HttpMessageNotReadableException.class,
                MethodArgumentTypeMismatchException.class})
        public ProblemDetail invalid(Exception error) {
            return problem(400, "INVALID_REQUEST", "Request fields are invalid");
        }
        @ExceptionHandler(HandlerMethodValidationException.class)
        public ProblemDetail methodValidation(HandlerMethodValidationException error) {
            return error.isForReturnValue() ? problem(500, "INVALID_RESPONSE", "Response contract failed")
                    : problem(400, "INVALID_REQUEST", "Request fields are invalid");
        }
        @ExceptionHandler(MissingTask.class) public ProblemDetail missing() {
            return problem(404, "TASK_NOT_FOUND", "Task does not exist");
        }
        private static ProblemDetail problem(int status, String code, String detail) {
            var problem = ProblemDetail.forStatusAndDetail(HttpStatusCode.valueOf(status), detail);
            problem.setProperty("code", code);
            return problem;
        }
    }
    public static void main(String[] args) throws Exception {
        var json = JsonMapper.builder().build();
        try (var fixture = new MockMvcFixture(Config.class)) {
            var mvc = fixture.mvc();
            var created = mvc.perform(post("/tasks").contentType(MediaType.APPLICATION_JSON)
                    .content("{\"title\":\"report\",\"priority\":1}")).andReturn().getResponse();
            System.out.println("created=" + created.getStatus() + ", title=" + json.readTree(created.getContentAsString()).get("title").asText());
            var invalid = mvc.perform(post("/tasks").contentType(MediaType.APPLICATION_JSON)
                    .content("{\"title\":\"\",\"priority\":0}")).andReturn().getResponse();
            System.out.println("invalid=" + invalid.getStatus() + ", code=" + json.readTree(invalid.getContentAsString()).get("code").asText());
            System.out.println("malformed=" + mvc.perform(post("/tasks").contentType(MediaType.APPLICATION_JSON)
                    .content("{")).andReturn().getResponse().getStatus());
            System.out.println("missing=" + mvc.perform(get("/tasks/404")).andReturn().getResponse().getStatus());
            System.out.println("query=" + mvc.perform(get("/search").param("limit", "0")).andReturn().getResponse().getStatus());
            System.out.println("unsupported=" + mvc.perform(post("/tasks").contentType(MediaType.TEXT_PLAIN)
                    .content("report")).andReturn().getResponse().getStatus());
        }
    }
}
