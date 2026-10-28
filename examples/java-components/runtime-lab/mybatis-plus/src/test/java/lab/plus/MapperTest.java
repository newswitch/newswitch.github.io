package lab.plus;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class MapperTest {
    @Autowired TaskMapper tasks;
    @Autowired JdbcTemplate sql;
    @Autowired PlatformTransactionManager transactionManager;
    @BeforeEach void reset() { sql.update("DELETE FROM mp_task"); }
    @Test void insertGeneratesIdentity() {
        var task = new TaskRow("first"); assertEquals(1, tasks.insert(task)); assertNotNull(task.getId());
        assertEquals("first", tasks.selectById(task.getId()).getTitle());
    }
    @Test void lambdaQuerySelectsMatchingRows() {
        tasks.insert(new TaskRow("needle")); tasks.insert(new TaskRow("other"));
        assertEquals(1, tasks.selectList(Wrappers.<TaskRow>lambdaQuery().eq(TaskRow::getTitle, "needle")).size());
    }
    @Test void paginationReturnsTotalAndBoundedRecords() {
        for (int i = 0; i < 5; i++) tasks.insert(new TaskRow("task-" + i));
        var page = tasks.selectPage(new Page<TaskRow>(1, 2), Wrappers.<TaskRow>lambdaQuery().orderByAsc(TaskRow::getId));
        assertEquals(5, page.getTotal()); assertEquals(2, page.getRecords().size());
    }
    @Test void staleVersionReturnsZeroRows() {
        var task = new TaskRow("first"); tasks.insert(task);
        var winner = tasks.selectById(task.getId()); var stale = tasks.selectById(task.getId());
        winner.setTitle("winner"); assertEquals(1, tasks.updateById(winner));
        stale.setTitle("stale"); assertEquals(0, tasks.updateById(stale));
        assertEquals("winner", tasks.selectById(task.getId()).getTitle());
    }
    @Test void logicalDeleteHidesButDoesNotRemovePhysicalRow() {
        var task = new TaskRow("first"); tasks.insert(task); tasks.deleteById(task.getId());
        assertNull(tasks.selectById(task.getId())); assertEquals(1, tasks.physicalRows());
        assertEquals(1, sql.queryForObject("SELECT deleted FROM mp_task WHERE id=?", Integer.class, task.getId()));
    }
    @Test void wrapperUpdateReturnsAffectedRows() {
        var task = new TaskRow("first"); tasks.insert(task);
        assertEquals(1, tasks.update(null, Wrappers.<TaskRow>lambdaUpdate().eq(TaskRow::getId, task.getId()).set(TaskRow::getTitle, "second")));
        assertEquals("second", tasks.selectById(task.getId()).getTitle());
    }
    @Test void transactionRollsBackBothInserts() {
        assertThrows(IllegalStateException.class, () -> new TransactionTemplate(transactionManager).execute(status -> {
            tasks.insert(new TaskRow("a")); tasks.insert(new TaskRow("b")); throw new IllegalStateException("rollback");
        }));
        assertEquals(0, tasks.physicalRows());
    }
}
