"""Database session management — async and sync session factories."""

from __future__ import annotations

from contextlib import asynccontextmanager, contextmanager
from typing import AsyncGenerator, Generator

from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session, sessionmaker

from mindarchive.config.settings import AppSettings


class Database:
    """Manages SQLAlchemy engine and session factories."""

    def __init__(self, settings: AppSettings) -> None:
        self._settings = settings
        self._sync_engine = create_engine(settings.db_url_sync, echo=False)
        self._sync_session_factory = sessionmaker(
            bind=self._sync_engine, expire_on_commit=False
        )

        # Async engine (requires aiosqlite)
        self._async_engine = create_async_engine(settings.db_url, echo=False)
        self._async_session_factory = async_sessionmaker(
            bind=self._async_engine, expire_on_commit=False, class_=AsyncSession
        )

    @contextmanager
    def session(self) -> Generator[Session, None, None]:
        """Synchronous session context manager."""
        session = self._sync_session_factory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    @asynccontextmanager
    async def async_session(self) -> AsyncGenerator[AsyncSession, None]:
        """Async session context manager."""
        session = self._async_session_factory()
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()

    def create_all(self) -> None:
        """Create all tables."""
        from mindarchive.models.base import Base

        Base.metadata.create_all(self._sync_engine)

    async def close(self) -> None:
        """Dispose engines."""
        self._sync_engine.dispose()
        await self._async_engine.dispose()


# Singleton instance (initialized lazily)
_db: Database | None = None


def get_database(settings: AppSettings | None = None) -> Database:
    """Get or create the database singleton."""
    global _db
    if _db is None:
        if settings is None:
            from mindarchive.config.settings import get_settings

            settings = get_settings()
        settings.ensure_dirs()
        _db = Database(settings)
    return _db


def reset_database() -> None:
    """Reset the singleton (for testing)."""
    global _db
    _db = None
