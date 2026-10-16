import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public class ConcurrencyChecks {
    public static void main(String[] args) throws Exception {
        var gate = new LockDemo.Gate();
        gate.open();
        gate.awaitOpen();
        var slot = new MonitorDemo.Slot();
        var pool = Executors.newFixedThreadPool(2);
        try {
            var producer = pool.submit(() -> {
                for (int i = 0; i < 1000; i++) slot.put(i);
                return null;
            });
            var consumer = pool.submit(() -> {
                long sum = 0;
                for (int i = 0; i < 1000; i++) sum += slot.take();
                return sum;
            });
            if (consumer.get(10, TimeUnit.SECONDS) != 499500L) {
                throw new AssertionError("monitor lost or duplicated data");
            }
            producer.get(10, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
            if (!pool.awaitTermination(5, TimeUnit.SECONDS)) {
                throw new AssertionError("workers did not terminate");
            }
        }
        System.out.println("coordination checks passed");
    }
}
