package demo.service;

import java.net.URI;
import java.util.List;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/tasks")
public class TaskController {
    public record CreateTask(@NotBlank @Size(max=80) String name) {}
    private final TaskService tasks;
    public TaskController(TaskService tasks) { this.tasks = tasks; }
    private String tenant(Authentication authentication) {
        return switch (authentication.getName()) {
            case "alice" -> "alpha";
            case "bob" -> "beta";
            default -> throw new org.springframework.security.access.AccessDeniedException("unknown tenant");
        };
    }
    @PostMapping
    ResponseEntity<TaskService.Task> create(Authentication auth,
            @RequestHeader("Idempotency-Key") String key, @Valid @RequestBody CreateTask request) {
        TaskService.Task task = tasks.create(tenant(auth), key, request.name());
        return ResponseEntity.created(URI.create("/api/tasks/" + task.id())).body(task);
    }
    @GetMapping("/{id}")
    TaskService.Task get(Authentication auth, @PathVariable String id) { return tasks.get(tenant(auth), id); }
    @GetMapping
    List<TaskService.Task> list(Authentication auth, @RequestParam(defaultValue="") String after,
            @RequestParam(defaultValue="20") int limit) { return tasks.list(tenant(auth), after, limit); }
    @PostMapping("/{id}/cancel")
    TaskService.Task cancel(Authentication auth, @PathVariable String id, @RequestParam long version) {
        return tasks.cancel(tenant(auth), id, version);
    }
}
