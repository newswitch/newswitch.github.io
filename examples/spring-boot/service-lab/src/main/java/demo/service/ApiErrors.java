package demo.service;

import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiErrors {
    @ExceptionHandler(TaskService.Missing.class)
    ProblemDetail missing() { return problem(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND"); }
    @ExceptionHandler(TaskService.Conflict.class)
    ProblemDetail conflict() { return problem(HttpStatus.CONFLICT, "TASK_CONFLICT"); }
    @ExceptionHandler(IllegalArgumentException.class)
    ProblemDetail badInput() { return problem(HttpStatus.BAD_REQUEST, "INVALID_ARGUMENT"); }
    private ProblemDetail problem(HttpStatus status, String code) {
        ProblemDetail detail = ProblemDetail.forStatusAndDetail(status, code);
        detail.setProperty("code", code);
        return detail;
    }
}
