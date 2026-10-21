package lab.persistence;

import org.apache.ibatis.annotations.*;

@Mapper
public interface TaskMapper {
    record Row(String id, String tenant, String name, long version) {}

    @Insert("INSERT INTO my_task(id,tenant,name,version) VALUES(#{id},#{tenant},#{name},0)")
    int insert(@Param("id") String id, @Param("tenant") String tenant, @Param("name") String name);

    @Select("SELECT id,tenant,name,version FROM my_task WHERE tenant=#{tenant} AND id=#{id}")
    Row find(@Param("tenant") String tenant, @Param("id") String id);

    @Update("UPDATE my_task SET name=#{name},version=version+1 WHERE tenant=#{tenant} AND id=#{id} AND version=#{version}")
    int rename(@Param("tenant") String tenant, @Param("id") String id,
               @Param("version") long version, @Param("name") String name);
}
