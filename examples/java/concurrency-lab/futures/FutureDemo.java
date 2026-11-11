import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

public class FutureDemo {
    public static void main(String[] args) throws Exception {
        var entered = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        var exited = new CountDownLatch(1);
        var pool = Executors.newFixedThreadPool(2);
        try {
            var combined = CompletableFuture.supplyAsync(() -> 21, pool)
                    .thenApply(value -> value * 2);
            System.out.println("combined=" + combined.get(5, TimeUnit.SECONDS));
            var blocked = pool.submit(() -> {
                entered.countDown();
                try {
                    release.await();
                    return 7;
                } finally {
                    exited.countDown();
                }
            });
            if (!entered.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("task did not enter");
            }
            try {
                blocked.get(0, TimeUnit.MILLISECONDS);
                throw new IllegalStateException("expected timeout");
            } catch (TimeoutException expected) {
                System.out.println("wait=timeout");
            }
            System.out.println("doneAfterTimeout=" + blocked.isDone());
            System.out.println("cancelAccepted=" + blocked.cancel(true));
            if (!exited.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("task did not exit");
            }
            System.out.println("cancelled=" + blocked.isCancelled());
        } finally {
            release.countDown();
            pool.shutdownNow();
            if (!pool.awaitTermination(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("pool did not terminate");
            }
        }
    }
}
