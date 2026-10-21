package lab.delivery;

import java.time.*;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;

// Explicit -Pbrokers only. Missing services are failures, never silent skips.
@SpringBootTest(properties="spring.profiles.active=brokers")
class BrokersIT {
    @Autowired OutboxStore store;
    @Autowired Brokers.KafkaPublisher kafka;
    @Autowired Brokers.RabbitPublisher rabbit;
    @Autowired JdbcTemplate db;
    @Autowired TaskCache cache;
    @Autowired StringRedisTemplate redis;
    @Autowired Inbox inbox;
    @Test void kafkaRelayAndDuplicateConsumer() throws Exception { roundTrip(kafka); }
    @Test void rabbitRelayAndDuplicateConsumer() throws Exception { roundTrip(rabbit); }
    void roundTrip(Relay.Publisher publisher) throws Exception {
        int duplicatesBefore=inbox.duplicates();
        var e=store.create("alpha","roundtrip");
        assertTrue(new Relay(store,publisher).once(Instant.now()));
        publisher.publish(e);
        long deadline=System.nanoTime()+Duration.ofSeconds(10).toNanos();
        while(System.nanoTime()<deadline && (db.queryForObject("SELECT COUNT(*) FROM delivery_result WHERE task_id=?",Integer.class,e.taskId())==0 || inbox.duplicates()<=duplicatesBefore))
            Thread.sleep(50);
        assertEquals(1,db.queryForObject("SELECT executions FROM delivery_result WHERE task_id=?",Integer.class,e.taskId()));
        assertEquals(1,db.queryForObject("SELECT COUNT(*) FROM delivery_inbox WHERE event_id=?",Integer.class,e.eventId()));
        assertTrue(inbox.duplicates()>duplicatesBefore,"duplicate must actually reach the consumer");
    }
    @Test void actualRedisHitAndEviction() {
        String id=UUID.randomUUID().toString(); String key=cache.key("alpha",id); var loads=new AtomicInteger();
        try {
            assertEquals("one",cache.get("alpha",id,()->{loads.incrementAndGet();return "one";}));
            assertEquals("one",cache.get("alpha",id,()->{loads.incrementAndGet();return "two";}));
            assertEquals(1,loads.get()); assertTrue(redis.getExpire(key)>0);
            cache.evict("alpha",id); assertEquals("two",cache.get("alpha",id,()->"two"));
        } finally { redis.delete(key); }
    }
}
