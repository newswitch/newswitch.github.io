package lab.components;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springdoc.core.models.GroupedOpenApi;

@SpringBootApplication
@EnableConfigurationProperties(LabProperties.class)
public class ComponentsApplication {
    public static void main(String[] args) {
        SpringApplication.run(ComponentsApplication.class, args);
    }

    @Bean
    GroupedOpenApi taskApi() {
        return GroupedOpenApi.builder().group("tasks").pathsToMatch("/api/tasks/**").build();
    }
}
