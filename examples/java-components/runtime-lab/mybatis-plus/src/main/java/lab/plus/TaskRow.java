package lab.plus;

import com.baomidou.mybatisplus.annotation.*;

@TableName("mp_task")
public class TaskRow {
    @TableId(type = IdType.AUTO) private Long id;
    private String title;
    @Version private Long version = 0L;
    @TableLogic(value = "0", delval = "1") private Integer deleted = 0;
    public TaskRow() {}
    public TaskRow(String title) { this.title = title; }
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public Long getVersion() { return version; }
    public void setVersion(Long version) { this.version = version; }
    public Integer getDeleted() { return deleted; }
    public void setDeleted(Integer deleted) { this.deleted = deleted; }
}
