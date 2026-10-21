package lab.identity;

import jakarta.servlet.http.*;
import java.util.Map;
import org.springframework.core.env.Environment;
import org.springframework.context.annotation.Profile;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestClient;

@RestController @Profile("oidc")
public class Browser {
    private final OAuth2AuthorizedClientManager clients;
    private final RestClient http;
    private final Environment environment;
    public Browser(OAuth2AuthorizedClientManager clients,RestClient apiRestClient,Environment environment) {
        this.clients=clients; this.http=apiRestClient; this.environment=environment;
    }
    @GetMapping("/") String home() { return "Open /oauth2/authorization/keycloak to sign in; then GET /call-api. POST /logout requires CSRF."; }
    @GetMapping("/call-api")
    public Map<?,?> call(Authentication authentication,HttpServletRequest request,HttpServletResponse response) {
        var authorization=OAuth2AuthorizeRequest.withClientRegistrationId("keycloak").principal(authentication)
            .attribute(HttpServletRequest.class.getName(),request).attribute(HttpServletResponse.class.getName(),response).build();
        var client=clients.authorize(authorization);
        if (client==null) throw new IllegalStateException("authorization required");
        // Access and refresh tokens stay server-side, never returned to the browser or logged.
        return http.get().uri(environment.getRequiredProperty("lab.resource-uri")+"/api/me").headers(h->h.setBearerAuth(client.getAccessToken().getTokenValue()))
            .retrieve().body(Map.class);
    }
}
