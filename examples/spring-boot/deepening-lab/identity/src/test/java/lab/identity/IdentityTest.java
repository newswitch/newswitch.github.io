package lab.identity;

import com.nimbusds.jose.*;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.*;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.*;
import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.security.oauth2.core.*;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
class IdentityTest {
    static final RSAKey OLD=key("old"), NEW=key("new"), WRONG=key("old");
    static volatile String keys=new JWKSet(OLD.toPublicJWK()).toString();
    static final HttpServer JWKS=server();
    static RSAKey key(String id) { try { return new RSAKeyGenerator(2048).keyID(id).generate(); } catch(Exception e) { throw new IllegalStateException(e); } }
    static HttpServer server() {
        try {
            var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
            server.createContext("/jwks",exchange->{
                byte[] bytes=keys.getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type","application/json");
                exchange.sendResponseHeaders(200,bytes.length);
                try(var output=exchange.getResponseBody()) { output.write(bytes); }
            }); server.start(); return server;
        } catch(Exception e) { throw new IllegalStateException(e); }
    }
    static String issuer() { return "http://127.0.0.1:"+JWKS.getAddress().getPort(); }
    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.security.oauth2.resourceserver.jwt.issuer-uri",IdentityTest::issuer);
        registry.add("spring.security.oauth2.resourceserver.jwt.jwk-set-uri",()->issuer()+"/jwks");
    }
    @LocalServerPort int port;
    @AfterAll static void stop() { JWKS.stop(0); }
    @BeforeEach void resetKeys() { keys=new JWKSet(OLD.toPublicJWK()).toString(); }
    static String token(RSAKey signer,String iss,String audience,String scope,Instant expires,Instant notBefore,String tenant) throws Exception {
        var claims=new JWTClaimsSet.Builder().issuer(iss).subject("alice").audience(audience).issueTime(Date.from(Instant.now()))
            .expirationTime(Date.from(expires)).notBeforeTime(Date.from(notBefore)).claim("scope",scope).claim("tenant",tenant).build();
        var jwt=new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(signer.getKeyID()).build(),claims);
        jwt.sign(new RSASSASigner(signer)); return jwt.serialize();
    }
    static String valid(RSAKey signer) throws Exception { return token(signer,issuer(),"task-api","task:read",Instant.now().plusSeconds(300),Instant.now().minusSeconds(1),"alpha"); }
    NimbusJwtDecoder decoder() {
        var decoder=NimbusJwtDecoder.withJwkSetUri(issuer()+"/jwks").build();
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(JwtValidators.createDefaultWithIssuer(issuer()),
            new JwtClaimValidator<List<String>>("aud",aud->aud!=null && aud.contains("task-api"))));
        return decoder;
    }
    int get(String token) throws Exception {
        try(var client=HttpClient.newHttpClient()) {
            var request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api/me"));
            if(token!=null) request.header("Authorization","Bearer "+token);
            return client.send(request.GET().build(),HttpResponse.BodyHandlers.discarding()).statusCode();
        }
    }
    @Test void realHttpValidBearer() throws Exception { assertEquals(200,get(valid(OLD))); }
    @Test void missingBearerIs401() throws Exception { assertEquals(401,get(null)); }
    @Test void wrongScopeIs403() throws Exception { assertEquals(403,get(token(OLD,issuer(),"task-api","other",Instant.now().plusSeconds(300),Instant.now().minusSeconds(1),"alpha"))); }
    @Test void wrongAudienceIs401() throws Exception { assertEquals(401,get(token(OLD,issuer(),"different-api","task:read",Instant.now().plusSeconds(300),Instant.now().minusSeconds(1),"alpha"))); }
    @Test void missingTenantIs403() throws Exception { assertEquals(403,get(token(OLD,issuer(),"task-api","task:read",Instant.now().plusSeconds(300),Instant.now().minusSeconds(1),null))); }
    @Test void wrongIssuerRejected() throws Exception { var jwt=token(OLD,"https://wrong.invalid","task-api","task:read",Instant.now().plusSeconds(300),Instant.now().minusSeconds(1),"alpha"); assertThrows(JwtException.class,()->decoder().decode(jwt)); }
    @Test void expiredRejected() throws Exception { var jwt=token(OLD,issuer(),"task-api","task:read",Instant.now().minusSeconds(300),Instant.now().minusSeconds(600),"alpha"); assertThrows(JwtException.class,()->decoder().decode(jwt)); }
    @Test void futureRejected() throws Exception { var jwt=token(OLD,issuer(),"task-api","task:read",Instant.now().plusSeconds(600),Instant.now().plusSeconds(300),"alpha"); assertThrows(JwtException.class,()->decoder().decode(jwt)); }
    @Test void wrongSignatureRejected() throws Exception { String jwt=valid(WRONG); assertThrows(JwtException.class,()->decoder().decode(jwt)); }
    @Test void unknownKidRejected() throws Exception { String jwt=valid(key("unknown")); assertThrows(JwtException.class,()->decoder().decode(jwt)); }
    @Test void unexpectedAlgorithmRejected() throws Exception {
        var jwt=new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS512).keyID("old").build(),JWTParser.parse(valid(OLD)).getJWTClaimsSet());
        jwt.sign(new RSASSASigner(OLD)); assertThrows(JwtException.class,()->decoder().decode(jwt.serialize()));
    }
    @Test void newKidTriggersJwksRefreshWithOverlap() throws Exception {
        var decoder=decoder(); assertEquals("alice",decoder.decode(valid(OLD)).getSubject());
        keys=new JWKSet(List.of(OLD.toPublicJWK(),NEW.toPublicJWK())).toString();
        assertEquals("alice",decoder.decode(valid(NEW)).getSubject()); assertEquals("alice",decoder.decode(valid(OLD)).getSubject());
    }
}
