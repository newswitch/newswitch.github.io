package lab.telemetry;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.observation.*;
import java.sql.*;
import java.util.Map;
import java.util.concurrent.Semaphore;
import javax.sql.DataSource;
import org.slf4j.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
public class Work {
    private static final Logger LOG=LoggerFactory.getLogger(Work.class);
    private final DataSource data;
    private final ObservationRegistry observations;
    private final MeterRegistry meters;
    private final boolean admission;
    private final Semaphore permits;
    public Work(DataSource data,ObservationRegistry observations,MeterRegistry meters,
                @Value("${lab.admission:false}") boolean admission,@Value("${lab.permits:2}") int count) {
        if(count<1 || count>32) throw new IllegalArgumentException("invalid permits");
        this.data=data; this.observations=observations; this.meters=meters; this.admission=admission; this.permits=new Semaphore(count);
    }
    @GetMapping("/work")
    public Map<String,Object> work(@RequestParam(defaultValue="50") int holdMs) {
        if(holdMs<0 || holdMs>200) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"holdMs must be 0..200");
        meters.counter("lab.work.attempts").increment();
        boolean acquired=!admission || permits.tryAcquire();
        if(!acquired) { meters.counter("lab.work.rejected").increment(); throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"admission limit"); }
        try {
            var wait=Observation.start("db.acquire",observations);
            Connection connection;
            try(var scope=wait.openScope()) { connection=data.getConnection(); }
            catch(SQLException error) { wait.error(error); throw error; }
            finally { wait.stop(); }
            try(connection) {
                var hold=Observation.start("db.hold",observations);
                try(var scope=hold.openScope(); var statement=connection.createStatement()) {
                    // Controlled connection occupancy, NOT a simulated measurement of real SQL execution speed.
                    Thread.sleep(holdMs);
                    try(var result=statement.executeQuery("SELECT 1")) { if(!result.next()) throw new SQLException("missing row"); }
                    LOG.info("lab_work_complete hold_ms={}",holdMs);
                    return Map.of("ok",true,"holdMs",holdMs,"traceId",String.valueOf(MDC.get("traceId")));
                } catch(SQLException | InterruptedException error) { hold.error(error); throw error; }
                finally { hold.stop(); }
            }
        } catch(InterruptedException error) {
            Thread.currentThread().interrupt(); throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"interrupted");
        } catch(SQLException error) {
            meters.counter("lab.work.db_errors").increment(); throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"database wait failed");
        } finally { if(admission) permits.release(); }
    }
}
