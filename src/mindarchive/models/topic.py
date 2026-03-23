"""Topic model — topic bank for channel profiles."""

from __future__ import annotations

from typing import Optional

from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from mindarchive.models.base import Base, TimestampMixin


class Topic(Base, TimestampMixin):
    """A topic in a channel's topic bank."""

    __tablename__ = "topics"

    id: Mapped[int] = mapped_column(primary_key=True)
    profile_slug: Mapped[str] = mapped_column(String(200), index=True)
    title: Mapped[str] = mapped_column(String(500))
    keyword: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    search_volume: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    viral_score: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    emotional_intensity: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    storytelling_strength: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    keyword_potential: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    angle: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    why_it_works: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Status: available, in_production, published
    status: Mapped[str] = mapped_column(String(50), default="available")

    # Link to project if in production or published
    project_slug: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
