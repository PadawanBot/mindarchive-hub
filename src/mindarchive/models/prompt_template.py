"""PromptTemplate model — versioned prompt storage for pipeline steps."""

from __future__ import annotations

from typing import Optional

from sqlalchemy import Boolean, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from mindarchive.models.base import Base, TimestampMixin


class PromptTemplate(Base, TimestampMixin):
    """A versioned prompt template for a pipeline step."""

    __tablename__ = "prompt_templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    step_number: Mapped[int] = mapped_column(Integer, index=True)
    step_name: Mapped[str] = mapped_column(String(200))
    version: Mapped[int] = mapped_column(Integer, default=1)

    # Template text with {placeholder} substitution variables
    template_text: Mapped[str] = mapped_column(Text)

    # Whether this is the active version for this step
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Scope: "generic" (works for any profile) or a profile slug for overrides
    scope: Mapped[str] = mapped_column(String(200), default="generic")

    # Optional notes about what changed from previous version
    change_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
