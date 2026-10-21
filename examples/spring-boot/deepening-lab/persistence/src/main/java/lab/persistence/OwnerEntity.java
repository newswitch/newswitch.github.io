package lab.persistence;

import jakarta.persistence.*;

@Entity @Table(name="jpa_owner")
public class OwnerEntity {
    @Id private String id;
    private String name;
    protected OwnerEntity() {}
    public OwnerEntity(String id, String name) { this.id=id; this.name=name; }
    public String getName() { return name; }
}
