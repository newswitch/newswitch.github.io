package lab.delivery;

import java.util.UUID;
import tools.jackson.databind.json.JsonMapper;

public record TaskEvent(String eventId, String taskId, String tenant, String type, int schemaVersion) {
    private static final JsonMapper JSON=JsonMapper.builder().build();
    public TaskEvent {
        UUID.fromString(eventId); UUID.fromString(taskId);
        if (tenant==null || !tenant.matches("[a-z0-9_-]{1,40}") || !"TaskCreated".equals(type) || schemaVersion!=1)
            throw new IllegalArgumentException("unsupported event");
    }
    public String json() { return JSON.writeValueAsString(this); }
    public static TaskEvent parse(String body) {
        if (body==null || body.length()>4096) throw new IllegalArgumentException("invalid event length");
        try { return JSON.readValue(body,TaskEvent.class); }
        catch (RuntimeException e) { throw new IllegalArgumentException("invalid event schema",e); }
    }
}
