package lab.jdbc;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
class AggregateTest {
    @Autowired TaskRepository tasks;
    @Autowired JdbcTemplate sql;
    @Autowired PlatformTransactionManager transactionManager;

    @BeforeEach void reset() { tasks.deleteAll(); }
    @Test void insertGeneratesIdentityAndVersion() {
        var saved = tasks.save(new WorkTask("first"));
        assertNotNull(saved.getId()); assertNotNull(saved.getVersion());
        assertEquals("first", tasks.findById(saved.getId()).orElseThrow().getTitle());
    }
    @Test void mutatingAnObjectDoesNotFlushIt() {
        var saved = tasks.save(new WorkTask("first"));
        var loaded = tasks.findById(saved.getId()).orElseThrow(); loaded.setTitle("unsaved");
        assertEquals("first", tasks.findById(saved.getId()).orElseThrow().getTitle());
    }
    @Test void savingExistingAggregateRecreatesChildren() {
        var task = new WorkTask("first"); task.getSteps().add(new WorkTask.Step("a")); task.getSteps().add(new WorkTask.Step("b"));
        var saved = tasks.save(task);
        sql.execute("CREATE TRIGGER step_delete AFTER DELETE ON \"task_step\" FOR EACH ROW CALL 'lab.jdbc.StepDeleteTrigger'");
        StepDeleteTrigger.DELETES.set(0);
        try {
            var loaded = tasks.findById(saved.getId()).orElseThrow(); loaded.setTitle("second"); tasks.save(loaded);
            assertEquals(2, StepDeleteTrigger.DELETES.get());
            assertEquals(2, tasks.findById(saved.getId()).orElseThrow().getSteps().size());
        } finally { sql.execute("DROP TRIGGER step_delete"); }
    }
    @Test void oldVersionCannotOverwriteNewerAggregate() {
        var saved = tasks.save(new WorkTask("first"));
        var first = tasks.findById(saved.getId()).orElseThrow(); var stale = tasks.findById(saved.getId()).orElseThrow();
        first.setTitle("winner"); tasks.save(first); stale.setTitle("stale");
        assertThrows(OptimisticLockingFailureException.class, () -> tasks.save(stale));
        assertEquals("winner", tasks.findById(saved.getId()).orElseThrow().getTitle());
    }
    @Test void childRemovalIsPersistedThroughRoot() {
        var task = new WorkTask("first"); task.getSteps().add(new WorkTask.Step("a")); var saved = tasks.save(task);
        var loaded = tasks.findById(saved.getId()).orElseThrow(); loaded.getSteps().clear(); tasks.save(loaded);
        assertTrue(tasks.findById(saved.getId()).orElseThrow().getSteps().isEmpty());
    }
    @Test void outerTransactionRollsBackACompletedSave() {
        var saved = tasks.save(new WorkTask("first"));
        assertThrows(IllegalStateException.class, () -> new TransactionTemplate(transactionManager).execute(status -> {
            var loaded = tasks.findById(saved.getId()).orElseThrow(); loaded.setTitle("rolled-back"); tasks.save(loaded);
            throw new IllegalStateException("force rollback");
        }));
        assertEquals("first", tasks.findById(saved.getId()).orElseThrow().getTitle());
    }
    @Test void derivedQueryUsesRootProperty() {
        tasks.save(new WorkTask("needle")); tasks.save(new WorkTask("other"));
        assertEquals(1, tasks.findByTitle("needle").size());
    }
}
