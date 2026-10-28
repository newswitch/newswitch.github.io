package lab.plus;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface TaskMapper extends BaseMapper<TaskRow> {
    // Deliberately a physical-row statistic, not a public business query.
    @Select("SELECT COUNT(*) FROM mp_task")
    long physicalRows();
}
