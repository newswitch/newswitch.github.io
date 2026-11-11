import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.util.concurrent.atomic.AtomicInteger;

public class ProxyDemo {
    @Retention(RetentionPolicy.RUNTIME)
    @Target(ElementType.METHOD)
    public @interface Measured {}

    public interface TaskApi {
        @Measured
        String submit(String title);
    }

    public static void main(String[] args) throws Exception {
        TaskApi target = title -> {
            if (title.isBlank()) throw new IllegalArgumentException("empty title");
            return "saved:" + title;
        };
        var calls = new AtomicInteger();
        TaskApi api = (TaskApi) Proxy.newProxyInstance(TaskApi.class.getClassLoader(),
                new Class<?>[]{TaskApi.class}, (proxy, method, values) -> {
                    if (method.getDeclaringClass() == Object.class) {
                        return switch (method.getName()) {
                            case "equals" -> proxy == values[0];
                            case "hashCode" -> System.identityHashCode(proxy);
                            case "toString" -> "MeasuredTaskApi";
                            default -> throw new IllegalStateException(method.getName());
                        };
                    }
                    if (method.isAnnotationPresent(Measured.class)) calls.incrementAndGet();
                    try {
                        return method.invoke(target, values);
                    } catch (InvocationTargetException failure) {
                        throw failure.getCause();
                    }
                });
        System.out.println("annotation=" + TaskApi.class.getMethod("submit", String.class)
                .isAnnotationPresent(Measured.class));
        System.out.println(api.submit("backup"));
        System.out.println("proxy=" + api);
        System.out.println("selfEqual=" + api.equals(api));
        try {
            api.submit(" ");
        } catch (IllegalArgumentException expected) {
            System.out.println("failure=" + expected.getMessage());
        }
        System.out.println("calls=" + calls.get());
    }
}
