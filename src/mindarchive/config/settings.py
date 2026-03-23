"""Application settings and credential store with Fernet encryption."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet
from pydantic import Field
from pydantic_settings import BaseSettings

from mindarchive.config.constants import (
    APP_DIR_NAME,
    CONFIG_FILE,
    CREDENTIALS_FILE,
    DEFAULT_DB_NAME,
    PROJECTS_DIR_NAME,
)


def _default_app_dir() -> Path:
    return Path.home() / APP_DIR_NAME


def _default_projects_dir() -> Path:
    return Path.home() / PROJECTS_DIR_NAME / "projects"


class AppSettings(BaseSettings):
    """Global application settings loaded from env / config.toml."""

    app_dir: Path = Field(default_factory=_default_app_dir)
    projects_dir: Path = Field(default_factory=_default_projects_dir)
    db_name: str = DEFAULT_DB_NAME
    default_model: str = "claude-sonnet-4-6"
    default_mode: str = "phase_gate"
    log_level: str = "INFO"

    # API keys — loaded from env or credential store
    anthropic_api_key: str = ""
    elevenlabs_api_key: str = ""
    openai_api_key: str = ""
    pexels_api_key: str = ""
    runway_api_key: str = ""
    youtube_oauth_path: str = ""
    vizard_api_key: str = ""
    buffer_api_key: str = ""
    gdrive_oauth_path: str = ""

    model_config = {"env_prefix": "MINDARCHIVE_", "env_file": ".env", "extra": "ignore"}

    @property
    def db_url(self) -> str:
        return f"sqlite+aiosqlite:///{self.app_dir / self.db_name}"

    @property
    def db_url_sync(self) -> str:
        return f"sqlite:///{self.app_dir / self.db_name}"

    @property
    def config_path(self) -> Path:
        return self.app_dir / CONFIG_FILE

    @property
    def credentials_path(self) -> Path:
        return self.app_dir / CREDENTIALS_FILE

    @property
    def profiles_dir(self) -> Path:
        return self.app_dir / "profiles"

    @property
    def formats_dir(self) -> Path:
        return self.app_dir / "formats"

    def ensure_dirs(self) -> None:
        """Create all required directories if they don't exist."""
        for d in [self.app_dir, self.projects_dir, self.profiles_dir, self.formats_dir]:
            d.mkdir(parents=True, exist_ok=True)


class CredentialStore:
    """Fernet-encrypted credential storage for API keys."""

    def __init__(self, credentials_path: Path, key_path: Path | None = None) -> None:
        self._path = credentials_path
        self._key_path = key_path or credentials_path.parent / ".fernet.key"
        self._fernet: Fernet | None = None

    def _get_fernet(self) -> Fernet:
        if self._fernet is not None:
            return self._fernet
        if self._key_path.exists():
            key = self._key_path.read_bytes()
        else:
            key = Fernet.generate_key()
            self._key_path.parent.mkdir(parents=True, exist_ok=True)
            self._key_path.write_bytes(key)
            os.chmod(self._key_path, 0o600)
        self._fernet = Fernet(key)
        return self._fernet

    def _load(self) -> dict[str, str]:
        if not self._path.exists():
            return {}
        f = self._get_fernet()
        encrypted = self._path.read_bytes()
        decrypted = f.decrypt(encrypted)
        return json.loads(decrypted)

    def _save(self, data: dict[str, str]) -> None:
        f = self._get_fernet()
        raw = json.dumps(data).encode()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_bytes(f.encrypt(raw))
        os.chmod(self._path, 0o600)

    def get(self, key: str) -> str | None:
        """Retrieve a credential by key name."""
        return self._load().get(key)

    def set(self, key: str, value: str) -> None:
        """Store or update a credential."""
        data = self._load()
        data[key] = value
        self._save(data)

    def delete(self, key: str) -> bool:
        """Remove a credential. Returns True if it existed."""
        data = self._load()
        if key in data:
            del data[key]
            self._save(data)
            return True
        return False

    def list_keys(self) -> list[str]:
        """List all stored credential names (not values)."""
        return list(self._load().keys())

    def validate(self) -> dict[str, bool]:
        """Check which required API keys are present (non-empty)."""
        required = [
            "ANTHROPIC_API_KEY",
            "ELEVENLABS_API_KEY",
            "OPENAI_API_KEY",
            "PEXELS_API_KEY",
        ]
        optional = [
            "RUNWAY_API_KEY",
            "VIZARD_API_KEY",
            "BUFFER_API_KEY",
        ]
        data = self._load()
        result: dict[str, bool] = {}
        for key in required + optional:
            result[key] = bool(data.get(key))
        return result


def get_settings(**overrides: Any) -> AppSettings:
    """Create settings instance, optionally with overrides for testing."""
    return AppSettings(**overrides)
