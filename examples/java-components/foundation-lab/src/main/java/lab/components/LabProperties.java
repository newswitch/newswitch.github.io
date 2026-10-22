package lab.components;

import java.time.Duration;
import jakarta.validation.constraints.NotBlank;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

/**
 * Component demonstration configuration.
 * @param greeting text returned as a task title
 * @param timeout example duration; does not configure an HTTP timeout
 */
@ConfigurationProperties("lab")
@Validated
public record LabProperties(@NotBlank @DefaultValue("hello") String greeting,
                            @DefaultValue("PT2S") Duration timeout) {}
