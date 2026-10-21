package lab.identity;

import org.springframework.context.annotation.*;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;

@Configuration(proxyBeanMethods=false)
public class ApiSecurity {
    @Bean @Order(1)
    SecurityFilterChain apiChain(HttpSecurity http) throws Exception {
        return http.securityMatcher("/api/**")
            .sessionManagement(s->s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            // Only Bearer authentication is accepted by this chain; browser session routes keep CSRF protection.
            .csrf(c->c.disable())
            .authorizeHttpRequests(a->a.requestMatchers(HttpMethod.GET,"/api/me").hasAuthority("SCOPE_task:read")
                .anyRequest().denyAll())
            .oauth2ResourceServer(o->o.jwt(Customizer.withDefaults())).build();
    }
    @Bean @Order(3) @Profile("!oidc")
    SecurityFilterChain denyOtherRoutes(HttpSecurity http) throws Exception {
        return http.authorizeHttpRequests(a->a.anyRequest().denyAll()).build();
    }
}
