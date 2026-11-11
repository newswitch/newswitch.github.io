import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;

public class MonitorDemo {
    static final class Slot {
        private Integer value;

        synchronized void put(int next) throws InterruptedException {
            while (value != null) wait();
            value = next;
            notifyAll();
        }

        synchronized int take() throws InterruptedException {
            while (value == null) wait();
            int result = value;
            value = null;
            notifyAll();
            return result;
        }
    }

    public static void main(String[] args) throws Exception {
        var slot = new Slot();
        var received = new AtomicInteger(-1);
        Thread consumer = Thread.ofPlatform().unstarted(() -> {
            try {
                received.set(slot.take());
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
        });
        consumer.start();
        try {
            slot.put(42);
            if (!consumer.join(Duration.ofSeconds(5))) {
                throw new IllegalStateException("consumer did not finish");
            }
        } finally {
            consumer.interrupt();
            if (!consumer.join(Duration.ofSeconds(5))) {
                throw new IllegalStateException("consumer did not stop");
            }
        }
        System.out.println("received=" + received.get());
    }
}
