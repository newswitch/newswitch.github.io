"""Create task records; run only against an explicitly selected database."""
from alembic import op
import sqlalchemy as sa

revision = "0001_jobs"
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    op.create_table(
        "jobs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant", sa.String(80), nullable=False),
        sa.Column("idempotency_key", sa.String(64), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("state", sa.String(20), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.UniqueConstraint("tenant", "idempotency_key", name="uq_jobs_tenant_key"),
    )

def downgrade():
    op.drop_table("jobs")
