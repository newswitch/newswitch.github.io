import java.util.ArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

public class VirtualDemo {
    public static void main(String[] args) throws Exception {
        var permits = new Semaphore(2);
        var firstTwo = new CountDownLatch(2);
        var release = new CountDownLatch(1);
        var active = new AtomicInteger();
        var peak = new AtomicInteger();
        var results = new ArrayList<Future<Boolean>>();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            try {
                for (int i = 0; i < 6; i++) {
                    results.add(executor.submit(() -> {
                        if (!permits.tryAcquire(5, TimeUnit.SECONDS)) {
                            throw new IllegalStateException("permit timed out");
                        }
                        try {
                            int current = active.incrementAndGet();
                            peak.accumulateAndGet(current, Math::max);
                            firstTwo.countDown();
                            if (!release.await(5, TimeUnit.SECONDS)) {
                                throw new IllegalStateException("release timed out");
                            }
                            return Thread.currentThread().isVirtual();
                        } finally {
                            active.decrementAndGet();
                            permits.release();
                        }
                    }));
                }
                if (!firstTwo.await(5, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("tasks did not enter");
                }
            } finally {
                release.countDown();
            }
            int virtual = 0;
            for (Future<Boolean> result : results) {
                if (result.get(5, TimeUnit.SECONDS)) virtual++;
            }
            System.out.println("completed=" + results.size());
            System.out.println("virtual=" + virtual);
            System.out.println("peakActive=" + peak.get());
            System.out.println("available=" + permits.availablePermits());
        }
    }
}
