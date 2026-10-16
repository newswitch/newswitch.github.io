package demo.tasks;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class TaskQuotaTest {
    @ParameterizedTest
    @CsvSource({"10,3,7", "0,0,0", "10,10,0", "2147483647,0,2147483647"})
    void computesRemaining(int capacity, int active, int expected) {
        assertEquals(expected, TaskQuota.remaining(capacity, active));
    }

    @ParameterizedTest
    @CsvSource({"-1,0", "1,-1", "2,3"})
    void rejectsInvalidState(int capacity, int active) {
        assertThrows(IllegalArgumentException.class,
                () -> TaskQuota.remaining(capacity, active));
    }

    @Test
    void entryUsesArguments() {
        assertEquals("remaining=7", App.render(new String[]{"10", "3"}));
    }

    @Test
    void entryRejectsWrongArgumentCount() {
        assertThrows(IllegalArgumentException.class, () -> App.render(new String[0]));
    }

    @ParameterizedTest
    @ValueSource(strings = {"not-a-number", "2147483648"})
    void entryRejectsNonIntegerOrOverflow(String capacity) {
        assertThrows(NumberFormatException.class, () -> App.render(new String[]{capacity, "0"}));
    }
}
