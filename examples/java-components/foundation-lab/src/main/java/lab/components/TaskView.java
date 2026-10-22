package lab.components;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "Public task representation; internal fields are not part of this DTO")
public record TaskView(String id, String title) {}
