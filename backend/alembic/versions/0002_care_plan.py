"""care_plan and care_products tables

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-24
"""

from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "care_plans",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("session_number", sa.Integer, nullable=False),
        sa.Column("period_start", sa.Date),
        sa.Column("period_end", sa.Date),
        sa.Column("profile_image_url", sa.String(500)),
        sa.Column("morning_description", sa.Text),
        sa.Column("nightly_description", sa.Text),
        sa.Column("curator_tip", sa.Text),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
    )

    op.create_table(
        "care_products",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "care_plan_id",
            sa.Integer,
            sa.ForeignKey("care_plans.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "time_slot",
            sa.Enum("morning", "nightly", name="timeslotcare"),
            nullable=False,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("brand", sa.String(100)),
        sa.Column("category", sa.String(50)),
        sa.Column("image_url", sa.String(500)),
        sa.Column("order_index", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("care_products")
    op.drop_table("care_plans")
