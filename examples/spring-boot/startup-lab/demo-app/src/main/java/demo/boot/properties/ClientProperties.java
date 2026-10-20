package demo.boot.properties;

import jakarta.validation.constraints.*;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;
import java.net.URI;
import java.time.Duration;

@Validated @ConfigurationProperties("lab.client")
public record ClientProperties(@NotNull Duration timeout, @Min(1) @Max(64) int maxInFlight,
                               @NotNull URI baseUrl) {
    @AssertTrue(message = "timeout must be positive")
    public boolean isTimeoutPositive() { return timeout != null && !timeout.isNegative() && !timeout.isZero(); }
}
