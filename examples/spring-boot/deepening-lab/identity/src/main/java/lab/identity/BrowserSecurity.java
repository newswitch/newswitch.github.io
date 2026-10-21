package lab.identity;

import org.springframework.context.annotation.*;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.oauth2.client.*;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.web.*;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.client.RestClient;
import org.springframework.http.client.JdkClientHttpRequestFactory;

@Configuration(proxyBeanMethods=false) @Profile("oidc")
public class BrowserSecurity {
    @Bean(destroyMethod="close") java.net.http.HttpClient apiHttpClient() {
        return java.net.http.HttpClient.newBuilder().connectTimeout(java.time.Duration.ofSeconds(2)).build();
    }
    @Bean RestClient apiRestClient(RestClient.Builder builder,java.net.http.HttpClient apiHttpClient) {
        var factory=new JdkClientHttpRequestFactory(apiHttpClient);
        factory.setReadTimeout(java.time.Duration.ofSeconds(3));
        return builder.requestFactory(factory).build();
    }
    @Bean @Order(2)
    SecurityFilterChain browserChain(HttpSecurity http,ClientRegistrationRepository registrations) throws Exception {
        var resolver=new DefaultOAuth2AuthorizationRequestResolver(registrations,"/oauth2/authorization");
        resolver.setAuthorizationRequestCustomizer(OAuth2AuthorizationRequestCustomizers.withPkce());
        return http.authorizeHttpRequests(a->a.requestMatchers("/","/error","/login/**","/oauth2/**").permitAll().anyRequest().authenticated())
            .oauth2Login(o->o.authorizationEndpoint(e->e.authorizationRequestResolver(resolver)))
            .oauth2Client(Customizer.withDefaults()).build();
    }
    @Bean OAuth2AuthorizedClientManager clients(ClientRegistrationRepository registrations,OAuth2AuthorizedClientRepository repository) {
        var manager=new DefaultOAuth2AuthorizedClientManager(registrations,repository);
        manager.setAuthorizedClientProvider(OAuth2AuthorizedClientProviderBuilder.builder().authorizationCode().refreshToken().build());
        return manager;
    }
}
