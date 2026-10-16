package demo.tasks;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class TaskQuotaTest {
    @Test
    void computesRemainingCapacity() {
        assertEquals(7, TaskQuota.remaining(10, 3));
    }

    @Test
    void acceptsZeroAndFullCapacity() {
        assertEquals(0, TaskQuota.remaining(0, 0));
        assertEquals(0, TaskQuota.remaining(10, 10));
    }

    @Test
    void rejectsNegativeValues() {
        assertThrows(IllegalArgumentException.class, () -> TaskQuota.remaining(-1, 0));
        assertThrows(IllegalArgumentException.class, () -> TaskQuota.remaining(1, -1));
    }

    @Test
    void rejectsActiveAboveCapacity() {
        assertThrows(IllegalArgumentException.class, () -> TaskQuota.remaining(2, 3));
    }
}
