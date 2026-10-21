package lab.persistence;

import jakarta.persistence.*;

@Entity @Table(name="jpa_job")
public class JobEntity {
    @Id private String id;
    @Column(nullable=false) private String tenant;
    private String name;
    @Version private long version;
    @ManyToOne(fetch=FetchType.LAZY, optional=false) private OwnerEntity owner;
    protected JobEntity() {}
    public JobEntity(String id, String tenant, String name, OwnerEntity owner) {
        this.id=id; this.tenant=tenant; this.name=name; this.owner=owner;
    }
    public String getName() { return name; }
    public long getVersion() { return version; }
    public OwnerEntity getOwner() { return owner; }
    public void rename(String value) { name=value; }
}
