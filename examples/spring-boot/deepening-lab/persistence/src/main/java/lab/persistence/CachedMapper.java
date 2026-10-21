package lab.persistence;

import org.apache.ibatis.annotations.*;

// Deliberately enable a namespace cache to demonstrate stale external writes.
@Mapper
@CacheNamespace(readWrite = false)
public interface CachedMapper {
    @Select("SELECT name FROM my_task WHERE id=#{id}")
    String name(@Param("id") String id);
}
