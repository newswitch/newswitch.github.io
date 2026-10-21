package lab.delivery;

import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class OutboxStore {
    public record Claim(TaskEvent event, String token) {}
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    public OutboxStore(JdbcTemplate db, TransactionTemplate tx) { this.db=db; this.tx=tx; }

    public TaskEvent create(String tenant, String name) {
        var event=new TaskEvent(UUID.randomUUID().toString(),UUID.randomUUID().toString(),tenant,"TaskCreated",1);
        if (name==null || name.isBlank() || name.length()>80) throw new IllegalArgumentException("invalid name");
        tx.executeWithoutResult(s -> {
            db.update("INSERT INTO delivery_task(id,tenant,name) VALUES(?,?,?)",event.taskId(),tenant,name);
            db.update("INSERT INTO delivery_outbox(event_id,body,sent,attempts,retry_at) VALUES(?,?,FALSE,0,0)",event.eventId(),event.json());
        });
        return event;
    }

    public Optional<Claim> claim(Instant now, Duration lease) {
        if (lease.isNegative() || lease.isZero()) throw new IllegalArgumentException("positive lease required");
        return tx.execute(s -> {
            var ids=db.queryForList("SELECT event_id FROM delivery_outbox WHERE sent=FALSE AND retry_at<=? "
                +"AND (claim_token IS NULL OR lease_until<=?) ORDER BY event_id LIMIT 10",String.class,now.toEpochMilli(),now.toEpochMilli());
            for (String id:ids) {
                String token=UUID.randomUUID().toString();
                int rows=db.update("UPDATE delivery_outbox SET claim_token=?,lease_until=?,attempts=attempts+1 "
                    +"WHERE event_id=? AND sent=FALSE AND retry_at<=? AND (claim_token IS NULL OR lease_until<=?)",
                    token,now.plus(lease).toEpochMilli(),id,now.toEpochMilli(),now.toEpochMilli());
                if (rows==1) return Optional.of(new Claim(TaskEvent.parse(db.queryForObject(
                    "SELECT body FROM delivery_outbox WHERE event_id=?",String.class,id)),token));
            }
            return Optional.empty();
        });
    }
    public boolean markSent(Claim claim) {
        return db.update("UPDATE delivery_outbox SET sent=TRUE,claim_token=NULL,last_error=NULL WHERE event_id=? AND claim_token=? AND sent=FALSE",
            claim.event().eventId(),claim.token())==1;
    }
    public void retry(Claim claim, Instant nextAttempt, Exception error) {
        db.update("UPDATE delivery_outbox SET claim_token=NULL,retry_at=?,last_error=? WHERE event_id=? AND claim_token=? AND sent=FALSE",
            nextAttempt.toEpochMilli(),error.getClass().getSimpleName(),claim.event().eventId(),claim.token());
    }
}
