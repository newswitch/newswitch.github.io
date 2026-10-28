package lab.jdbc;

import java.util.List;
import org.springframework.data.repository.CrudRepository;

public interface TaskRepository extends CrudRepository<WorkTask, Long> {
    List<WorkTask> findByTitle(String title);
}
