"""initial schema: assets, routines, outfit_plans

Revision ID: 0001
Revises:
Create Date: 2026-04-24
"""

from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "assets",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column(
            "category",
            sa.Enum("clothing", "cosmetic", "accessory", name="assetcategory"),
            nullable=False,
        ),
        sa.Column("brand", sa.String(100)),
        sa.Column("color", sa.String(50)),
        sa.Column("season", sa.String(20)),
        sa.Column("purchase_price", sa.Float, nullable=False, server_default="0"),
        sa.Column("purchase_date", sa.Date),
        sa.Column("usage_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("last_used_at", sa.DateTime),
        sa.Column("image_url", sa.String(500)),
        sa.Column("tags", sa.JSON),
        sa.Column("notes", sa.Text),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
    )

    op.create_table(
        "routines",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column(
            "time_slot",
            sa.Enum(
                "morning", "midday", "afternoon", "evening", "night", name="timeslot"
            ),
            nullable=False,
        ),
        sa.Column("duration_minutes", sa.Integer, nullable=False, server_default="5"),
        sa.Column(
            "category",
            sa.Enum("body", "style", "mind", "productivity", name="routinecategory"),
            nullable=False,
            server_default="body",
        ),
        sa.Column("is_forced", sa.Boolean, nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="1"),
        sa.Column("source_url", sa.String(500)),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )

    op.create_table(
        "outfit_plans",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("plan_date", sa.Date, nullable=False, index=True),
        sa.Column("asset_ids", sa.JSON, nullable=False),
        sa.Column("notes", sa.Text),
        sa.Column("is_confirmed", sa.Boolean, nullable=False, server_default="0"),
        sa.Column("confirmed_at", sa.DateTime),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
    )

    # 기본 강제 루틴 시드 데이터
    op.execute(
        """
        INSERT INTO routines (title, description, time_slot, duration_minutes, category, is_forced, is_active, created_at)
        VALUES
            ('내일 옷 미리 고르기', '아침의 의사결정 비용을 제로로. 지금 내일 입을 옷을 고르세요.', 'evening', 3, 'style', 1, 1, datetime('now')),
            ('림프 순환 운동', '목/어깨 5분 마사지로 하루 피로 해소', 'morning', 5, 'body', 0, 1, datetime('now')),
            ('스킨케어 루틴', '세럼 → 에센스 → 크림 순서 지키기', 'morning', 7, 'style', 0, 1, datetime('now')),
            ('저녁 림프 드레이닝', '저녁 림프 순환 마사지 10분', 'evening', 10, 'body', 0, 1, datetime('now'))
        """
    )


def downgrade() -> None:
    op.drop_table("outfit_plans")
    op.drop_table("routines")
    op.drop_table("assets")
