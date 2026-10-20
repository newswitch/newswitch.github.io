package demo.service;

import java.util.List;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class TaskService {
    public record Task(String id, String name, String status, long version) {}
    public static final class Missing extends RuntimeException {}
    public static final class Conflict extends RuntimeException {}
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;

    public TaskService(JdbcTemplate jdbc, PlatformTransactionManager manager) {
        this.jdbc = jdbc;
        this.transaction = new TransactionTemplate(manager);
    }

    public Task create(String tenant, String key, String name) {
        if (key == null || key.isBlank() || key.length() > 80) throw new IllegalArgumentException("invalid key");
        if (name == null || name.isBlank() || name.length() > 80) throw new IllegalArgumentException("invalid name");
        try {
            return transaction.execute(status -> {
                String id = UUID.randomUUID().toString();
                jdbc.update("INSERT INTO task VALUES (?, ?, ?, ?, 'NEW', 0)", id, tenant, key, name);
                jdbc.update("INSERT INTO outbox(event_id,task_id,tenant,event_type) VALUES (?,?,?,?)",
                        UUID.randomUUID().toString(), id, tenant, "TaskCreated");
                return new Task(id, name, "NEW", 0);
            });
        } catch (DuplicateKeyException duplicate) {
            // The failed transaction has already rolled back. Read in a new JDBC operation.
            List<Task> rows = jdbc.query("SELECT id,name,status,version FROM task WHERE tenant=? AND request_key=?",
                    (rs, row) -> new Task(rs.getString(1), rs.getString(2), rs.getString(3), rs.getLong(4)), tenant, key);
            if (rows.isEmpty()) throw duplicate;
            if (!rows.getFirst().name().equals(name)) throw new Conflict();
            return rows.getFirst();
        }
    }

    public Task get(String tenant, String id) {
        return jdbc.query("SELECT id,name,status,version FROM task WHERE tenant=? AND id=?",
                (rs, row) -> new Task(rs.getString(1), rs.getString(2), rs.getString(3), rs.getLong(4)), tenant, id)
                .stream().findFirst().orElseThrow(Missing::new);
    }

    public List<Task> list(String tenant, String after, int limit) {
        if (limit < 1 || limit > 100) throw new IllegalArgumentException("invalid limit");
        return jdbc.query("SELECT id,name,status,version FROM task WHERE tenant=? AND id>? ORDER BY id LIMIT ?",
                (rs, row) -> new Task(rs.getString(1), rs.getString(2), rs.getString(3), rs.getLong(4)), tenant, after, limit);
    }

    public Task cancel(String tenant, String id, long version) {
        return transaction.execute(status -> {
            int changed = jdbc.update("UPDATE task SET status='CANCELLED',version=version+1 WHERE tenant=? AND id=? AND version=? AND status='NEW'",
                    tenant, id, version);
            if (changed == 0) { get(tenant, id); throw new Conflict(); }
            jdbc.update("INSERT INTO outbox(event_id,task_id,tenant,event_type) VALUES (?,?,?,?)",
                    UUID.randomUUID().toString(), id, tenant, "TaskCancelled");
            return get(tenant, id);
        });
    }
}
