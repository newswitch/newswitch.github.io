package lab.delivery;

import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class DeliveryTest {
    @Autowired OutboxStore store;
    @Autowired Inbox inbox;
    @Autowired JdbcTemplate db;
    final Instant now=Instant.parse("2026-01-01T00:00:00Z");
    @BeforeEach void clear() {
        for (String table:List.of("delivery_result","delivery_inbox","delivery_outbox","delivery_task")) db.update("DELETE FROM "+table);
    }
    @Test void taskAndIntentCommitTogether() {
        store.create("alpha","one"); assertEquals(1,count("delivery_task")); assertEquals(1,count("delivery_outbox"));
    }
    @Test void outboxFailureRollsBackTask() {
        db.execute("ALTER TABLE delivery_outbox ADD CONSTRAINT reject_event CHECK(sent=TRUE)");
        try { assertThrows(RuntimeException.class,()->store.create("alpha","rollback")); assertEquals(0,count("delivery_task")); }
        finally { db.execute("ALTER TABLE delivery_outbox DROP CONSTRAINT reject_event"); }
    }
    @Test void onlyOneActiveClaim() {
        store.create("alpha","one"); assertTrue(store.claim(now,Duration.ofSeconds(30)).isPresent());
        assertTrue(store.claim(now,Duration.ofSeconds(30)).isEmpty());
    }
    @Test void expiredClaimIsFenced() {
        store.create("alpha","one"); var old=store.claim(now,Duration.ofSeconds(1)).orElseThrow();
        var fresh=store.claim(now.plusSeconds(2),Duration.ofSeconds(30)).orElseThrow();
        assertFalse(store.markSent(old)); assertTrue(store.markSent(fresh));
    }
    @Test void brokerFailureLeavesRetryableIntent() {
        store.create("alpha","one");
        assertFalse(new Relay(store,e->{throw new java.io.IOException("unavailable");}).once(now));
        assertEquals(0,db.queryForObject("SELECT COUNT(*) FROM delivery_outbox WHERE sent=TRUE",Integer.class));
        assertTrue(store.claim(now.plusSeconds(2),Duration.ofSeconds(30)).isPresent());
    }
    @Test void crashAfterBrokerAcceptanceProducesDuplicateNotLostEvent() {
        var event=store.create("alpha","one"); var sent=new ArrayList<TaskEvent>();
        var abandoned=store.claim(now,Duration.ofSeconds(1)).orElseThrow(); sent.add(abandoned.event());
        // Process disappears before markSent; another process reclaims after expiry.
        assertTrue(new Relay(store,sent::add).once(now.plusSeconds(2)));
        assertEquals(2,sent.size()); assertTrue(inbox.apply(sent.get(0))); assertFalse(inbox.apply(sent.get(1)));
        assertEquals(1,count("delivery_result")); assertEquals(event.eventId(),sent.get(1).eventId());
    }
    @Test void consumerFailureRollsBackDedupRecord() {
        var event=store.create("alpha","one");
        db.update("INSERT INTO delivery_result VALUES(?,?,1)",event.taskId(),event.tenant());
        assertThrows(IllegalStateException.class,()->inbox.apply(event)); assertEquals(0,count("delivery_inbox"));
        db.update("DELETE FROM delivery_result"); assertTrue(inbox.apply(event));
    }
    @Test void duplicateWithChangedBodyIsNotSilentlyIgnored() {
        var e=store.create("alpha","one"); inbox.apply(e);
        var forged=new TaskEvent(e.eventId(),UUID.randomUUID().toString(),"beta","TaskCreated",1);
        assertThrows(IllegalStateException.class,()->inbox.apply(forged));
    }
    @Test void concurrentDuplicateHasOneEffect() throws Exception {
        var event=store.create("alpha","one");
        try(var pool=Executors.newFixedThreadPool(4)) {
            var calls=new ArrayList<Callable<Boolean>>(); for(int i=0;i<8;i++) calls.add(()->inbox.apply(event));
            int applied=0; for(var result:pool.invokeAll(calls,5,TimeUnit.SECONDS)) if(result.get()) applied++;
            assertEquals(1,applied); assertEquals(1,count("delivery_result"));
        }
    }
    @Test void eventProtocolRejectsUnknownSchema() {
        assertThrows(IllegalArgumentException.class,()->TaskEvent.parse("{}"));
        var e=store.create("alpha","one"); assertEquals(e,TaskEvent.parse(e.json()));
        assertThrows(IllegalArgumentException.class,()->TaskEvent.parse(e.json().replace("TaskCreated","Unknown")));
    }
    int count(String table) { return db.queryForObject("SELECT COUNT(*) FROM "+table,Integer.class); }
}
