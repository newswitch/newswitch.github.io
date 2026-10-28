package lab.plus;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class PlusApplication {
    public static void main(String[] args) {
        try (var context = SpringApplication.run(PlusApplication.class, args)) {
            var tasks = context.getBean(TaskMapper.class); var task = new TaskRow("first"); tasks.insert(task);
            System.out.println("inserted=" + tasks.selectById(task.getId()).getTitle());
        }
    }
}
