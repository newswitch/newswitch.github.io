package lab.delivery;

import java.time.*;

// One bounded iteration. A scheduler must not create an unbounded backlog of iterations.
public class Relay {
    @FunctionalInterface public interface Publisher { void publish(TaskEvent event) throws Exception; }
    private final OutboxStore store;
    private final Publisher publisher;
    public Relay(OutboxStore store, Publisher publisher) { this.store=store; this.publisher=publisher; }
    public boolean once(Instant now) {
        var found=store.claim(now,Duration.ofSeconds(30));
        if (found.isEmpty()) return false;
        var claim=found.get();
        try { publisher.publish(claim.event()); return store.markSent(claim); }
        catch (Exception e) {
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            store.retry(claim,now.plusSeconds(1),e);
            return false;
        }
    }
}
