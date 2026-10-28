package lab.jdbc;

import java.sql.Connection;
import java.util.concurrent.atomic.AtomicInteger;
import org.h2.api.Trigger;

/** H2-only observation fixture: counts physical child-row deletions. */
public class StepDeleteTrigger implements Trigger {
    static final AtomicInteger DELETES = new AtomicInteger();
    @Override public void fire(Connection connection, Object[] oldRow, Object[] newRow) { DELETES.incrementAndGet(); }
}
