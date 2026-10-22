package lab.components;

import io.swagger.v3.oas.annotations.Operation;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/tasks")
@RequiredArgsConstructor
public class TaskController {
    private final TaskMapper mapper;
    private final LabProperties properties;

    @GetMapping("/{id}")
    @Operation(summary = "Read an in-memory demonstration task")
    public TaskView get(@PathVariable String id) {
        return mapper.toView(item(id, properties.greeting()));
    }

    @PostMapping
    @Operation(summary = "Map an input; this example does not persist tasks")
    public TaskView create(@Valid @RequestBody CreateRequest input) {
        return mapper.toView(item("demo", input.name()));
    }

    private WorkItem item(String id, String name) {
        return WorkItem.builder().id(id).name(name).tenant("internal")
                .internalNote("do-not-return").build();
    }

    public record CreateRequest(@NotBlank String name) {}
}
