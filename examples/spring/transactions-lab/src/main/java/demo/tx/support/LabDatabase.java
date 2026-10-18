package demo.tx.support;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.List;
import java.util.UUID;
import javax.sql.DataSource;
import org.h2.jdbcx.JdbcDataSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.JdbcTransactionManager;

public final class LabDatabase implements AutoCloseable {
    private final JdbcDataSource dataSource = new JdbcDataSource();
    private final Connection keeper;
    private final JdbcTemplate jdbc;
    private final JdbcTransactionManager manager;
    public LabDatabase() throws SQLException {
        dataSource.setURL("jdbc:h2:mem:lab_" + UUID.randomUUID() + ";LOCK_TIMEOUT=1000");
        keeper = dataSource.getConnection();
        jdbc = new JdbcTemplate(dataSource);
        manager = new JdbcTransactionManager(dataSource);
        jdbc.execute("create table entries(id int primary key, label varchar(64))");
    }
    public DataSource dataSource() { return dataSource; }
    public JdbcTemplate jdbc() { return jdbc; }
    public JdbcTransactionManager manager() { return manager; }
    public void insert(int id, String label) { jdbc.update("insert into entries values(?, ?)", id, label); }
    public int count() { return jdbc.queryForObject("select count(*) from entries", Integer.class); }
    public List<String> labels() { return jdbc.queryForList("select label from entries order by id", String.class); }
    public void clear() { jdbc.update("delete from entries"); }
    public void close() throws SQLException { keeper.close(); }
}
