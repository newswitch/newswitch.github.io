import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public class ContextDemo {
    private static final ThreadLocal<String> REQUEST = new ThreadLocal<>();
    private static final ScopedValue<String> SCOPED = ScopedValue.newInstance();

    public static void main(String[] args) throws Exception {
        try (var pool = Executors.newSingleThreadExecutor()) {
            pool.submit(() -> {
                REQUEST.set("request-A"); // 故意遗漏，展示旧代码的错误。
            }).get(5, TimeUnit.SECONDS);
            String leaked = pool.submit(REQUEST::get).get(5, TimeUnit.SECONDS);
            System.out.println("leaked=" + leaked);
            pool.submit(() -> {
                REQUEST.remove();
                try {
                    REQUEST.set("request-B");
                    System.out.println("during=" + REQUEST.get());
                } finally {
                    REQUEST.remove();
                }
            }).get(5, TimeUnit.SECONDS);
            String after = pool.submit(REQUEST::get).get(5, TimeUnit.SECONDS);
            System.out.println("after=" + after);
            pool.submit(REQUEST::remove).get(5, TimeUnit.SECONDS);
        }
        ScopedValue.where(SCOPED, "request-C").run(() -> {
            System.out.println("scoped=" + SCOPED.get());
        });
        System.out.println("boundAfter=" + SCOPED.isBound());
    }
}
