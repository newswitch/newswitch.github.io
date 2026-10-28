package lab.jdbc;

import java.util.LinkedHashSet;
import java.util.Set;
import org.springframework.data.annotation.Id;
import org.springframework.data.annotation.Version;
import org.springframework.data.relational.core.mapping.Column;
import org.springframework.data.relational.core.mapping.MappedCollection;
import org.springframework.data.relational.core.mapping.Table;

@Table("work_task")
public class WorkTask {
    @Id @Column("id") private Long id;
    @Version @Column("version") private Long version;
    @Column("title") private String title;
    @MappedCollection(idColumn = "task_id") private Set<Step> steps = new LinkedHashSet<>();

    public WorkTask(String title) { this.title = title; }
    public Long getId() { return id; }
    public Long getVersion() { return version; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public Set<Step> getSteps() { return steps; }

    @Table("task_step")
    public static class Step {
        @Column("label") private String label;
        public Step(String label) { this.label = label; }
        public String getLabel() { return label; }
    }
}
