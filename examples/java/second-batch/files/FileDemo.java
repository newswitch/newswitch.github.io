import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.List;

public class FileDemo {
    public static void main(String[] args) throws Exception {
        Path directory = Files.createTempDirectory("java-file-demo-");
        Path file = directory.resolve("tasks.txt");
        try {
            try (var writer = Files.newBufferedWriter(file, StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
                writer.write("backup\nverify\n");
            }
            List<String> lines = Files.readAllLines(file, StandardCharsets.UTF_8);
            System.out.println("lines=" + lines);
            try (var stream = Files.lines(file, StandardCharsets.UTF_8)) {
                System.out.println("count=" + stream.count());
            }
            System.out.println("bytes=" + Files.size(file));
            try {
                Files.writeString(file, "unexpected", StandardCharsets.UTF_8,
                        StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
            } catch (java.nio.file.FileAlreadyExistsException expected) {
                System.out.println("overwrite=refused");
            }
        } finally {
            Files.deleteIfExists(file);
            Files.deleteIfExists(directory);
        }
        System.out.println("cleaned=" + Files.notExists(directory));
    }
}
