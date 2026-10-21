package lab.identity;

import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
public class Api {
    @GetMapping("/api/me")
    public Map<String,String> me(@AuthenticationPrincipal Jwt jwt) {
        String tenant=jwt.getClaimAsString("tenant");
        if (tenant==null || !tenant.matches("[a-z0-9_-]{1,40}"))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,"tenant mapping required");
        return Map.of("subject",jwt.getSubject(),"tenant",tenant);
    }
}
