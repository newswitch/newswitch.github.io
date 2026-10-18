package demo.web.reactor;

import org.reactivestreams.Subscription;
import reactor.core.publisher.*;
import reactor.core.scheduler.Schedulers;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.atomic.*;

public final class ReactorDemo {
    public static void main(String[] args) {
        var received = new ArrayList<Integer>();
        var requests = new ArrayList<Long>();
        var cancelled = new AtomicBoolean();
        Flux.range(1, 5).doOnRequest(requests::add).doOnCancel(() -> cancelled.set(true))
                .subscribe(new BaseSubscriber<Integer>() {
                    @Override protected void hookOnSubscribe(Subscription subscription) { request(2); }
                    @Override protected void hookOnNext(Integer value) {
                        received.add(value); if (received.size() == 2) cancel();
                    }
                });
        System.out.println("received=" + received);
        System.out.println("requested=" + requests);
        System.out.println("cancelled=" + cancelled.get());
        var scheduler = Schedulers.newBoundedElastic(1, 4, "lab-blocking");
        try {
            var called = new AtomicBoolean();
            var onOwnedScheduler = new AtomicBoolean();
            Mono<Integer> source = Mono.fromCallable(() -> {
                called.set(true);
                onOwnedScheduler.set(Thread.currentThread().getName().startsWith("lab-blocking-"));
                return 7;
            }).subscribeOn(scheduler);
            System.out.println("beforeSubscribe=" + called.get());
            System.out.println("result=" + source.block(Duration.ofSeconds(2)));
            System.out.println("ownedScheduler=" + onOwnedScheduler.get());
            String requestId = Mono.deferContextual(context -> Mono.just(context.<String>get("requestId")))
                    .contextWrite(context -> context.put("requestId", "r-7")).block(Duration.ofSeconds(2));
            System.out.println("context=" + requestId);
        } finally {
            try { scheduler.disposeGracefully().block(Duration.ofSeconds(3)); }
            finally { scheduler.dispose(); }
        }
    }
}
