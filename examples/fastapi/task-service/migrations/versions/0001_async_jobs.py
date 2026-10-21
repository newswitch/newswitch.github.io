"""Initial task, result, event and per-tenant stream tables."""
from alembic import op
import sqlalchemy as sa

revision = "0001_async_jobs"
down_revision = None


def upgrade():
    op.create_table("async_jobs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant", sa.String(80), nullable=False),
        sa.Column("idempotency_key", sa.String(64), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("state", sa.String(20), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("available_at", sa.Float(), nullable=False),
        sa.Column("lease_until", sa.Float(), nullable=False),
        sa.Column("lease_token", sa.String(32)),
        sa.UniqueConstraint("tenant", "idempotency_key", name="uq_async_jobs_tenant_key"))
    op.create_index("ix_async_jobs_tenant", "async_jobs", ["tenant"])
    op.create_index("ix_async_jobs_claim", "async_jobs", ["state", "available_at", "lease_until"])
    op.create_table("async_results",
        sa.Column("job_id", sa.Integer(), sa.ForeignKey("async_jobs.id"), primary_key=True),
        sa.Column("value", sa.String(320), nullable=False))
    op.create_table("async_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant", sa.String(80), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("job_id", sa.Integer(), sa.ForeignKey("async_jobs.id"), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.UniqueConstraint("tenant", "sequence", name="uq_async_events_sequence"))
    op.create_table("async_streams",
        sa.Column("tenant", sa.String(80), primary_key=True),
        sa.Column("sequence", sa.Integer(), nullable=False))


def downgrade():
    raise RuntimeError("No destructive downgrade: use a disposable database to restart the lab")
