package lab.jdbc;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.net.URI;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/tasks")
public class TaskController {
    private final TaskRepository tasks;
    public TaskController(TaskRepository tasks) { this.tasks = tasks; }

    @PostMapping
    public ResponseEntity<View> create(@Valid @RequestBody Create input) {
        var saved = tasks.save(new WorkTask(input.title()));
        return ResponseEntity.created(URI.create("/api/tasks/" + saved.getId())).body(view(saved));
    }
    @GetMapping("/{id}")
    public View get(@PathVariable Long id) {
        return tasks.findById(id).map(this::view).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }
    private View view(WorkTask task) {
        return new View(task.getId(), task.getTitle(), task.getVersion(), task.getSteps().stream().map(WorkTask.Step::getLabel).sorted().toList());
    }
    public record Create(@NotBlank String title) {}
    public record View(Long id, String title, Long version, List<String> steps) {}
}
