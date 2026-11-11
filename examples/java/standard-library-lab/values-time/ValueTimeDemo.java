import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;

public class ValueTimeDemo {
    public static void main(String[] args) {
        BigDecimal price = new BigDecimal("19.90");
        BigDecimal total = price.multiply(new BigDecimal("3"));
        System.out.println("total=" + total.toPlainString());
        System.out.println("third=" + BigDecimal.ONE.divide(new BigDecimal("3"), 2, RoundingMode.HALF_UP));
        System.out.println("equals=" + new BigDecimal("1.0").equals(new BigDecimal("1.00")));
        System.out.println("compare=" + new BigDecimal("1.0").compareTo(new BigDecimal("1.00")));

        Instant instant = Instant.parse("2026-01-01T00:00:00Z");
        System.out.println("shanghai=" + instant.atZone(ZoneId.of("Asia/Shanghai")));
        Clock clock = Clock.fixed(instant, ZoneOffset.UTC);
        System.out.println("fixed=" + Instant.now(clock));
        ZonedDateTime before = ZonedDateTime.of(2026, 3, 7, 12, 0, 0, 0,
                ZoneId.of("America/New_York"));
        ZonedDateTime nextDay = before.plusDays(1);
        System.out.println("calendarDayHours=" + Duration.between(before, nextDay).toHours());
        System.out.println("durationHours=" + Duration.between(before, before.plusHours(24)).toHours());
    }
}
