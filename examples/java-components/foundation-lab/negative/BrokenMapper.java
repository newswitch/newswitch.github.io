import lab.components.TaskView;
import lab.components.WorkItem;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

@Mapper
interface BrokenMapper {
    @Mapping(target = "absent", source = "name")
    TaskView map(WorkItem item);
}
