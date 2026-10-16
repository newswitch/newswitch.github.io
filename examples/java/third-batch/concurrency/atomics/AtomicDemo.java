import java.time.Duration;
import java.util.ArrayList;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.LongAdder;

public class AtomicDemo {
    public static void main(String[] args) throws Exception {
        var exact = new AtomicInteger();
        var statistics = new LongAdder();
        var counts = new ConcurrentHashMap<String, Integer>();
        var workers = new ArrayList<Thread>();
        try {
            for (int i = 0; i < 4; i++) {
                workers.add(Thread.ofPlatform().start(() -> {
                    for (int j = 0; j < 1000; j++) {
                        exact.incrementAndGet();
                        statistics.increment();
                        counts.merge("jobs", 1, Integer::sum);
                    }
                }));
            }
            for (Thread worker : workers) {
                if (!worker.join(Duration.ofSeconds(5))) {
                    throw new IllegalStateException("counter timed out");
                }
            }
        } finally {
            for (Thread worker : workers) worker.interrupt();
            for (Thread worker : workers) {
                if (!worker.join(Duration.ofSeconds(5))) {
                    throw new IllegalStateException("worker did not stop");
                }
            }
        }
        System.out.println("exact=" + exact.get());
        System.out.println("statistics=" + statistics.sum());
        System.out.println("mapped=" + counts.get("jobs"));
        System.out.println("staleCas=" + exact.compareAndSet(0, 1));
        System.out.println("currentCas=" + exact.compareAndSet(4000, 4001));
    }
}
