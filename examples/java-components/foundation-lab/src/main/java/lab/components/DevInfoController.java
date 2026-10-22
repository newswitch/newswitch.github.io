package lab.components;

import java.util.Map;
import java.util.UUID;
import org.springframework.boot.SpringApplication;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@Profile("dev")
@RestController
public class DevInfoController {
    private final String instance = UUID.randomUUID().toString();

    @GetMapping("/internal/dev-info")
    public Map<String, Object> info() {
        return Map.of("pid", ProcessHandle.current().pid(), "instance", instance,
                "appLoader", getClass().getClassLoader().getClass().getName(),
                "libraryLoader", SpringApplication.class.getClassLoader().getClass().getName());
    }
}
