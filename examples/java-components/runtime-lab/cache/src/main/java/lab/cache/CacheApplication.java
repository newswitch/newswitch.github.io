package lab.cache;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class CacheApplication {
    public static void main(String[] args) {
        try (var context = SpringApplication.run(CacheApplication.class, args)) {
            var store = context.getBean(TaskStore.class); var reader = context.getBean(TaskReader.class);
            store.put(1L, "first"); reader.read(1L); reader.read(1L);
            System.out.println("loads-after-two-reads=" + store.loads());
            reader.rename(1L, "second"); System.out.println("after-evict=" + reader.read(1L).title());
        }
    }
}
