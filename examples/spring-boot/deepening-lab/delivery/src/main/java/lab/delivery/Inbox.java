package lab.delivery;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class Inbox {
    private final java.util.concurrent.atomic.AtomicInteger duplicates=new java.util.concurrent.atomic.AtomicInteger();
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    public Inbox(JdbcTemplate db, TransactionTemplate tx) { this.db=db; this.tx=tx; }
    public boolean apply(TaskEvent event) {
        try {
            return Boolean.TRUE.equals(tx.execute(s -> {
                db.update("INSERT INTO delivery_inbox(event_id,body) VALUES(?,?)",event.eventId(),event.json());
                // This projection is a database side effect, not a remote HTTP action.
                db.update("INSERT INTO delivery_result(task_id,tenant,executions) VALUES(?,?,1)",event.taskId(),event.tenant());
                return true;
            }));
        } catch (DuplicateKeyException e) {
            // Outside the failed transaction: also valid for databases that abort a transaction on constraint failure.
            var bodies=db.queryForList("SELECT body FROM delivery_inbox WHERE event_id=?",String.class,event.eventId());
            if (bodies.size()==1 && bodies.getFirst().equals(event.json())) { duplicates.incrementAndGet(); return false; }
            throw new IllegalStateException("event identity collision or projection conflict",e);
        }
    }
    public int duplicates() { return duplicates.get(); }
}
