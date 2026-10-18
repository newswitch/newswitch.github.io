package demo.tx.isolation;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import demo.tx.support.LabDatabase;

public class IsolationDemo {
    public static String label(Connection connection) throws SQLException {
        try (Statement statement = connection.createStatement();
             ResultSet result = statement.executeQuery("select label from entries where id=1")) {
            if (!result.next()) throw new IllegalStateException("entry missing");
            return result.getString(1);
        }
    }
    public static String readTwice(LabDatabase database, int isolation) throws SQLException {
        database.jdbc().update("update entries set label='v1' where id=1");
        try (Connection reader = database.dataSource().getConnection();
             Connection writer = database.dataSource().getConnection()) {
            reader.setTransactionIsolation(isolation);
            reader.setAutoCommit(false);
            try {
                String first = label(reader);
                try (Statement statement = writer.createStatement()) {
                    statement.executeUpdate("update entries set label='v2' where id=1");
                }
                return first + "->" + label(reader);
            } finally { reader.rollback(); }
        }
    }
    public static boolean lockTimesOut(LabDatabase database) throws SQLException {
        try (Connection owner = database.dataSource().getConnection();
             Connection contender = database.dataSource().getConnection()) {
            owner.setAutoCommit(false);
            contender.setAutoCommit(false);
            try (Statement first = owner.createStatement(); Statement second = contender.createStatement()) {
                first.executeUpdate("update entries set label='locked' where id=1");
                second.execute("set lock_timeout 200");
                second.setQueryTimeout(2);
                try {
                    second.executeUpdate("update entries set label='contender' where id=1");
                    return false;
                } catch (SQLException error) {
                    if (error.getErrorCode() != 50200) throw error;
                    return true;
                }
            } finally {
                try { contender.rollback(); } finally { owner.rollback(); }
            }
        }
    }
    public static void main(String[] args) throws Exception {
        try (LabDatabase database = new LabDatabase()) {
            database.insert(1, "v1");
            System.out.println("readCommitted=" + readTwice(database, Connection.TRANSACTION_READ_COMMITTED));
            System.out.println("repeatableRead=" + readTwice(database, Connection.TRANSACTION_REPEATABLE_READ));
            System.out.println("lockTimeout=" + lockTimesOut(database));
            database.jdbc().execute("create table stock(id int primary key, available int, version int)");
            database.jdbc().update("insert into stock values(1, 2, 0)");
            String sql = "update stock set available=available-1, version=version+1 where id=1 and version=? and available>0";
            int first = database.jdbc().update(sql, 0);
            int stale = database.jdbc().update(sql, 0);
            System.out.println("optimisticUpdates=" + first + "," + stale);
        }
    }
}
