package lab.components;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.ToString;

// Plain demonstration object, not a JPA entity or an HTTP response model.
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@ToString(onlyExplicitlyIncluded = true)
public class WorkItem {
    @ToString.Include
    private String id;
    private String name;
    private String tenant;
    private String internalNote;
    @Builder.Default
    private String status = "NEW";
}
