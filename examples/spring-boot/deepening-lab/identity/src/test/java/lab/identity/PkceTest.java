package lab.identity;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.oauth2.client.registration.*;
import org.springframework.security.oauth2.client.web.*;
import org.springframework.security.oauth2.core.*;
import static org.junit.jupiter.api.Assertions.*;

class PkceTest {
    @Test void confidentialClientExplicitlyUsesS256AndKeepsVerifierOutOfUrl() {
        var registration=ClientRegistration.withRegistrationId("keycloak").clientId("task-web").clientSecret("isolated-secret")
            .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE).redirectUri("http://localhost:8082/login/oauth2/code/keycloak")
            .scope("openid","task:read").authorizationUri("http://localhost:18080/authorize").tokenUri("http://localhost:18080/token")
            .jwkSetUri("http://localhost:18080/jwks").userNameAttributeName("sub").build();
        var resolver=new DefaultOAuth2AuthorizationRequestResolver(new InMemoryClientRegistrationRepository(registration),"/oauth2/authorization");
        resolver.setAuthorizationRequestCustomizer(OAuth2AuthorizationRequestCustomizers.withPkce());
        var request=new MockHttpServletRequest("GET","/oauth2/authorization/keycloak"); request.setServletPath("/oauth2/authorization/keycloak");
        var authorization=resolver.resolve(request);
        assertNotNull(authorization); assertNotNull(authorization.getState());
        assertEquals("S256",authorization.getAdditionalParameters().get("code_challenge_method"));
        assertNotNull(authorization.getAdditionalParameters().get("nonce"));
        assertNotNull(authorization.getAttribute("code_verifier"));
        assertFalse(authorization.getAuthorizationRequestUri().contains("code_verifier"));
    }
}
