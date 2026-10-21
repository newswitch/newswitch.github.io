package lab.identity;

import com.nimbusds.jose.*;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.*;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.*;
import com.sun.net.httpserver.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.*;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

// Controlled protocol peer, NOT a real Keycloak deployment or an authentication system.
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties="spring.profiles.active=oidc")
class BrowserFlowTest {
    static final JsonMapper JSON=JsonMapper.builder().build();
    static final RSAKey KEY=key();
    static final HttpServer IDP=server();
    static final AtomicInteger exchanges=new AtomicInteger(), refreshes=new AtomicInteger();
    static volatile String nonce, challenge;
    static RSAKey key() { try {return new RSAKeyGenerator(2048).keyID("fixture").generate();} catch(Exception e) {throw new IllegalStateException(e);} }
    static String issuer() { return "http://127.0.0.1:"+IDP.getAddress().getPort(); }
    static Map<String,String> form(String value) {
        var fields=new HashMap<String,String>();
        for(String part:value.split("&")) {var pair=part.split("=",2);fields.put(URLDecoder.decode(pair[0],StandardCharsets.UTF_8),pair.length>1?URLDecoder.decode(pair[1],StandardCharsets.UTF_8):"");}
        return fields;
    }
    static HttpServer server() {
        try {
            var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
            server.createContext("/.well-known/openid-configuration",e->reply(e,200,Map.of(
                "issuer",issuer(),"authorization_endpoint",issuer()+"/authorize","token_endpoint",issuer()+"/token",
                "jwks_uri",issuer()+"/jwks","userinfo_endpoint",issuer()+"/userinfo","response_types_supported",List.of("code"),
                "subject_types_supported",List.of("public"),"id_token_signing_alg_values_supported",List.of("RS256"))));
            server.createContext("/jwks",e->reply(e,200,new JWKSet(KEY.toPublicJWK()).toJSONObject()));
            server.createContext("/userinfo",e->reply(e,200,Map.of("sub","alice","preferred_username","alice","tenant","alpha")));
            server.createContext("/token",e->{
                try {
                    var fields=form(new String(e.getRequestBody().readAllBytes(),StandardCharsets.UTF_8));
                    boolean refresh="refresh_token".equals(fields.get("grant_type"));
                    if(refresh) {
                        if(!"refresh-1".equals(fields.get("refresh_token"))) {reply(e,400,Map.of("error","invalid_grant"));return;}
                        refreshes.incrementAndGet();
                    } else {
                        String verifier=fields.get("code_verifier");
                        if(verifier==null || !"fixture-code".equals(fields.get("code")) ||
                            !Objects.equals(challenge,Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII))))) {
                            reply(e,400,Map.of("error","invalid_grant"));return;
                        }
                        exchanges.incrementAndGet();
                    }
                    var body=new HashMap<String,Object>();
                    body.put("access_token",signed(false));body.put("token_type","Bearer");body.put("scope","openid profile task:read");
                    // A one-second authorization lifetime triggers the framework's refresh skew without long sleeps.
                    body.put("expires_in",refresh?300:1);body.put("refresh_token",refresh?"refresh-2":"refresh-1");
                    if(!refresh) body.put("id_token",signed(true));
                    reply(e,200,body);
                } catch(Exception error) {reply(e,500,Map.of("error","fixture_failure"));}
            }); server.start(); return server;
        } catch(Exception e) {throw new IllegalStateException(e);}
    }
    static String signed(boolean identity) throws Exception {
        var builder=new JWTClaimsSet.Builder().issuer(issuer()).subject("alice").audience(identity?"task-web":"task-api")
            .issueTime(new Date()).expirationTime(Date.from(Instant.now().plusSeconds(300))).claim("tenant","alpha");
        if(identity) builder.claim("nonce",nonce);else builder.claim("scope","task:read");
        var token=new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID("fixture").build(),builder.build());
        token.sign(new RSASSASigner(KEY));return token.serialize();
    }
    static void reply(HttpExchange e,int status,Object body) throws java.io.IOException {
        var bytes=JSON.writeValueAsBytes(body);e.getResponseHeaders().set("Content-Type","application/json");
        e.sendResponseHeaders(status,bytes.length);try(var output=e.getResponseBody()) {output.write(bytes);}
    }
    @DynamicPropertySource static void properties(DynamicPropertyRegistry p) {
        p.add("spring.security.oauth2.client.provider.keycloak.issuer-uri",BrowserFlowTest::issuer);
        p.add("spring.security.oauth2.client.registration.keycloak.redirect-uri",()->"{baseUrl}/login/oauth2/code/{registrationId}");
        p.add("spring.security.oauth2.resourceserver.jwt.issuer-uri",BrowserFlowTest::issuer);
        p.add("spring.security.oauth2.resourceserver.jwt.jwk-set-uri",()->issuer()+"/jwks");
        p.add("lab.resource-uri",()->"http://localhost:${local.server.port}");
    }
    @LocalServerPort int port;
    @BeforeEach void reset() {exchanges.set(0);refreshes.set(0);}
    @AfterAll static void close() {IDP.stop(0);}
    HttpClient browser() {return HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).followRedirects(HttpClient.Redirect.NEVER).build();}
    HttpResponse<String> get(HttpClient client,String path) throws Exception {
        return client.send(HttpRequest.newBuilder(URI.create("http://localhost:"+port+path)).timeout(Duration.ofSeconds(5)).GET().build(),HttpResponse.BodyHandlers.ofString());
    }
    String begin(HttpClient client) throws Exception {
        var start=get(client,"/oauth2/authorization/keycloak");assertEquals(302,start.statusCode());
        var fields=form(URI.create(start.headers().firstValue("Location").orElseThrow()).getRawQuery());
        nonce=fields.get("nonce");challenge=fields.get("code_challenge");assertEquals("S256",fields.get("code_challenge_method"));
        return fields.get("state");
    }
    void login(HttpClient client) throws Exception {
        String state=begin(client);
        assertEquals(302,get(client,"/login/oauth2/code/keycloak?code=fixture-code&state="+URLEncoder.encode(state,StandardCharsets.UTF_8)).statusCode());
        assertEquals(1,exchanges.get());
    }
    @Test void codeExchangeRefreshAndServerSideApiCall() throws Exception {
        try(var client=browser()) {
            login(client);
            // Point the resource URI at this random-port application, not the manual fixed port.
            var response=get(client,"/call-api");
            assertEquals(200,response.statusCode());assertTrue(response.body().contains("alpha"));
            assertFalse(response.body().contains("access_token"));assertEquals(1,refreshes.get());
        }
    }
    @Test void wrongStateDoesNotExchangeCode() throws Exception {
        try(var client=browser()) {begin(client);get(client,"/login/oauth2/code/keycloak?code=fixture-code&state=wrong");assertEquals(0,exchanges.get());assertEquals(302,get(client,"/call-api").statusCode());}
    }
    @Test void sessionCookieDoesNotAuthenticateBearerApi() throws Exception {
        try(var client=browser()) {login(client);assertEquals(401,get(client,"/api/me").statusCode());}
    }
}
