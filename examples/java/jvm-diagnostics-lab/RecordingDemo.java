import java.nio.file.Path;
import java.time.Duration;
import jdk.jfr.Event;
import jdk.jfr.Label;
import jdk.jfr.Name;
import jdk.jfr.Recording;
import jdk.jfr.consumer.RecordingFile;

public class RecordingDemo {
    @Name("learning.Task")
    @Label("Learning task")
    static class TaskEvent extends Event {
        @Label("Task number")
        int number;
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 1) throw new IllegalArgumentException("recording path required");
        Path destination = Path.of(args[0]);
        try (Recording recording = new Recording()) {
            recording.enable(TaskEvent.class).withThreshold(Duration.ZERO);
            recording.start();
            for (int i = 1; i <= 2; i++) {
                TaskEvent event = new TaskEvent();
                event.number = i;
                event.begin();
                event.end();
                event.commit();
            }
            recording.stop();
            recording.dump(destination);
        }
        var events = RecordingFile.readAllEvents(destination).stream()
                .filter(e -> e.getEventType().getName().equals("learning.Task")).toList();
        System.out.println("tasks=" + events.size());
        System.out.println("numberSum=" + events.stream().mapToInt(e -> e.getInt("number")).sum());
    }
}
