package io.newswitch.greeting;

import jakarta.validation.constraints.NotBlank;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

@Validated @ConfigurationProperties("newswitch.greeting")
public record GreetingProperties(@DefaultValue("hello") @NotBlank String prefix) {}
