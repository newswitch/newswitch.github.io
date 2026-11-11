import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;

public class PublicationDemo {
    static final class Message {
        int data;
        volatile boolean ready;
    }

    public static void main(String[] args) throws Exception {
        var message = new Message();
        var result = new AtomicInteger(-1);
        Thread reader = Thread.ofPlatform().unstarted(() -> {
            while (!message.ready) {
                if (Thread.currentThread().isInterrupted()) return;
                Thread.onSpinWait();
            }
            result.set(message.data);
        });
        Thread writer = Thread.ofPlatform().unstarted(() -> {
            message.data = 42;
            message.ready = true;
        });
        reader.start();
        writer.start();
        try {
            if (!writer.join(Duration.ofSeconds(5)) || !reader.join(Duration.ofSeconds(5))) {
                throw new IllegalStateException("publication timed out");
            }
        } finally {
            reader.interrupt();
            writer.interrupt();
            if (!reader.join(Duration.ofSeconds(5)) || !writer.join(Duration.ofSeconds(5))) {
                throw new IllegalStateException("threads did not stop");
            }
        }
        System.out.println("published=" + result.get());
    }
}
