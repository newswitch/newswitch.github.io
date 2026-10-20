from sqlalchemy import create_engine, insert, select, update, func
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

class Base(DeclarativeBase):
    pass

class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[int] = mapped_column(primary_key=True)
    revision: Mapped[int] = mapped_column(default=0)

def change(session, expected):
    result = session.execute(
        update(Job).where(Job.id == 1, Job.revision == expected)
        .values(revision=Job.revision + 1))
    return result.rowcount

def main():
    engine = create_engine("sqlite://")
    try:
        Base.metadata.create_all(engine)
        with Session(engine) as db, db.begin():
            db.add(Job(id=1))
        with Session(engine) as db, db.begin():
            print("first:", change(db, 0))
        with Session(engine) as db, db.begin():
            print("stale:", change(db, 0))
        try:
            with Session(engine) as db, db.begin():
                db.add(Job(id=2))
                db.flush()
                raise RuntimeError("abort")
        except RuntimeError:
            pass
        with Session(engine) as db:
            print("rows:", db.scalar(select(func.count()).select_from(Job)))
    finally:
        engine.dispose()

if __name__ == "__main__":
    main()
