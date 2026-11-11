package demo.tasks;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AppIT {
    @TempDir
    Path directory;

    @Test
    void packagedApplicationRuns() throws Exception {
        String executable = System.getProperty("os.name").startsWith("Windows") ? "java.exe" : "java";
        Path java = Path.of(System.getProperty("java.home"), "bin", executable);
        Path jar = Path.of(System.getProperty("app.jar")).toAbsolutePath();
        Path output = directory.resolve("output.txt");
        Process process = new ProcessBuilder(java.toString(), "-jar", jar.toString(), "10", "3")
                .redirectErrorStream(true).redirectOutput(output.toFile()).start();
        try {
            assertTrue(process.waitFor(10, TimeUnit.SECONDS), "application timed out");
            assertEquals(0, process.exitValue());
            String expected = System.getProperty("app.expectedOutput", "remaining=7");
            assertEquals(expected, Files.readString(output, StandardCharsets.UTF_8).strip());
        } finally {
            process.destroyForcibly();
            assertTrue(process.waitFor(5, TimeUnit.SECONDS), "application did not stop");
        }
    }
}
