package demo.service;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;

@Configuration(proxyBeanMethods=false)
@EnableMethodSecurity
public class SecurityConfiguration {
    @Bean PasswordEncoder passwordEncoder() { return PasswordEncoderFactories.createDelegatingPasswordEncoder(); }
    @Bean UserDetailsService users(PasswordEncoder encoder) {
        // Loopback-only teaching accounts. Never use these credentials in a deployment.
        return new InMemoryUserDetailsManager(
                User.withUsername("alice").password(encoder.encode("lab-only-alice")).roles("USER").build(),
                User.withUsername("bob").password(encoder.encode("lab-only-bob")).roles("USER").build());
    }
    @Bean SecurityFilterChain security(HttpSecurity http) throws Exception {
        return http.authorizeHttpRequests(auth -> auth
                    .requestMatchers("/actuator/health", "/actuator/health/**").permitAll()
                    .requestMatchers("/actuator/**", "/api/admin/**").hasRole("ADMIN")
                    .anyRequest().authenticated())
                .httpBasic(Customizer.withDefaults()).build();
        // CSRF stays enabled: authentication alone does not make browser writes safe.
    }
}
