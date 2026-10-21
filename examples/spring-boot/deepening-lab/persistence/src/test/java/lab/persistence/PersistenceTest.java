package lab.persistence;

import jakarta.persistence.*;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.apache.ibatis.session.SqlSessionFactory;
import org.hibernate.LazyInitializationException;
import org.hibernate.SessionFactory;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class PersistenceTest {
    @Autowired TaskMapper mapper;
    @Autowired CachedMapper cached;
    @Autowired SqlCounter counter;
    @Autowired SqlSessionFactory sessions;
    @Autowired JdbcTemplate jdbc;
    @Autowired EntityManagerFactory emf;
    @Autowired PlatformTransactionManager tm;
    @PersistenceContext EntityManager em;
    TransactionTemplate tx;

    @BeforeEach void seed() {
        tx=new TransactionTemplate(tm);
        jdbc.execute("CREATE TABLE IF NOT EXISTS my_task(id VARCHAR(40) PRIMARY KEY,tenant VARCHAR(40),name VARCHAR(80),version BIGINT)");
        jdbc.update("DELETE FROM my_task");
        sessions.getConfiguration().getCache(CachedMapper.class.getName()).clear();
        mapper.insert("t1","alpha","before");
        tx.executeWithoutResult(s -> {
            em.createQuery("delete from JobEntity").executeUpdate();
            em.createQuery("delete from OwnerEntity").executeUpdate();
            for (int i=1;i<=3;i++) {
                var owner=new OwnerEntity("o"+i,"owner"+i); em.persist(owner);
                em.persist(new JobEntity("j"+i,"alpha","before",owner));
            }
        });
        counter.reset(); stats().clear();
    }
    org.hibernate.stat.Statistics stats() { return emf.unwrap(SessionFactory.class).getStatistics(); }

    @Test void boundValueIsNotSql() { assertNull(mapper.find("alpha' OR '1'='1","t1")); }
    @Test void tenantAndMissingRow() { assertNull(mapper.find("beta","t1")); assertNull(mapper.find("alpha","missing")); }
    @Test void optimisticUpdateUsesAffectedRows() {
        assertEquals(1,mapper.rename("alpha","t1",0,"after"));
        assertEquals(0,mapper.rename("alpha","t1",0,"stale"));
        assertEquals(1,mapper.find("alpha","t1").version());
    }
    @Test void mybatisParticipatesInSpringRollback() {
        tx.executeWithoutResult(s -> { mapper.rename("alpha","t1",0,"rollback"); s.setRollbackOnly(); });
        assertEquals("before",mapper.find("alpha","t1").name());
    }
    @Test void duplicateIsAnErrorNotAnUpsert() {
        assertThrows(DuplicateKeyException.class,() -> mapper.insert("t1","alpha","duplicate"));
    }
    @Test void firstLevelCacheUsesOnePrepareInOneTransaction() {
        tx.executeWithoutResult(s -> { mapper.find("alpha","t1"); mapper.find("alpha","t1"); });
        assertEquals(1,counter.count());
    }
    @Test void noSharedFirstLevelCacheOutsideTransaction() {
        mapper.find("alpha","t1"); mapper.find("alpha","t1"); assertEquals(2,counter.count());
    }
    @Test void mapperWriteClearsFirstLevelCache() {
        tx.executeWithoutResult(s -> {
            mapper.find("alpha","t1"); mapper.rename("alpha","t1",0,"after");
            assertEquals("after",mapper.find("alpha","t1").name());
        });
        assertEquals(3,counter.count());
    }
    @Test void namespaceCacheDoesNotObserveExternalWrite() {
        tx.executeWithoutResult(s -> assertEquals("before",cached.name("t1")));
        jdbc.update("UPDATE my_task SET name='external' WHERE id='t1'");
        tx.executeWithoutResult(s -> assertEquals("before",cached.name("t1")));
        assertEquals(1,counter.count());
        assertEquals("external",mapper.find("alpha","t1").name());
    }
    @Test void managedIdentityAndDirtyChecking() {
        tx.executeWithoutResult(s -> {
            var job=em.find(JobEntity.class,"j1"); assertSame(job,em.find(JobEntity.class,"j1"));
            job.rename("dirty");
        });
        assertEquals("dirty",jdbc.queryForObject("SELECT name FROM jpa_job WHERE id='j1'",String.class));
        assertEquals(1,stats().getEntityUpdateCount());
    }
    @Test void flushCanStillRollback() {
        tx.executeWithoutResult(s -> { em.find(JobEntity.class,"j1").rename("flushed"); em.flush(); s.setRollbackOnly(); });
        assertEquals(1,stats().getEntityUpdateCount());
        assertEquals("before",jdbc.queryForObject("SELECT name FROM jpa_job WHERE id='j1'",String.class));
    }
    @Test void nPlusOneVersusFetchJoin() {
        tx.executeWithoutResult(s -> em.createQuery("select j from JobEntity j",JobEntity.class)
            .getResultList().forEach(j -> assertNotNull(j.getOwner().getName())));
        assertEquals(4,stats().getPrepareStatementCount());
        stats().clear();
        tx.executeWithoutResult(s -> em.createQuery("select j from JobEntity j join fetch j.owner",JobEntity.class)
            .getResultList().forEach(j -> assertNotNull(j.getOwner().getName())));
        assertEquals(1,stats().getPrepareStatementCount());
    }
    @Test void lazyOutsideContextFails() {
        var holder=new AtomicReference<JobEntity>();
        tx.executeWithoutResult(s -> holder.set(em.find(JobEntity.class,"j1")));
        assertThrows(LazyInitializationException.class,() -> holder.get().getOwner().getName());
    }
    @Test void concurrentVersionsConflict() {
        try (var a=emf.createEntityManager(); var b=emf.createEntityManager()) {
            a.getTransaction().begin(); b.getTransaction().begin();
            var first=a.find(JobEntity.class,"j1"); var second=b.find(JobEntity.class,"j1");
            first.rename("first"); a.getTransaction().commit(); second.rename("second");
            assertThrows(OptimisticLockException.class,b::flush); b.getTransaction().rollback();
        }
    }
    @Test void bulkUpdateLeavesManagedInstanceStale() {
        tx.executeWithoutResult(s -> {
            var job=em.find(JobEntity.class,"j1");
            em.createQuery("update JobEntity j set j.name='bulk' where j.id='j1'").executeUpdate();
            assertEquals("before",job.getName()); em.clear();
            assertEquals("bulk",em.find(JobEntity.class,"j1").getName());
        });
    }
}
