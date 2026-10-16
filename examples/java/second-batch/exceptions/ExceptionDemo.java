import java.io.IOException;

public class ExceptionDemo {
    static final class Resource implements AutoCloseable {
        private final String name;

        Resource(String name) {
            this.name = name;
            System.out.println("open=" + name);
        }

        @Override
        public void close() throws IOException {
            System.out.println("close=" + name);
            throw new IOException("close-" + name);
        }
    }

    static void save() throws IOException {
        try (var first = new Resource("first");
             var second = new Resource("second")) {
            throw new IOException("write");
        }
    }

    public static void main(String[] args) {
        try {
            save();
        } catch (IOException failure) {
            System.out.println("primary=" + failure.getMessage());
            for (Throwable suppressed : failure.getSuppressed()) {
                System.out.println("suppressed=" + suppressed.getMessage());
            }
        }
    }
}
