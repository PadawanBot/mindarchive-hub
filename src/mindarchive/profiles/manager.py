"""Channel profile manager — TOML read/write, CRUD, profile inheritance."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

try:
    import tomli
except ImportError:
    import tomllib as tomli  # type: ignore[no-redef]

import tomli_w
from slugify import slugify


@dataclass
class ProfileData:
    """In-memory representation of a channel profile loaded from TOML."""

    slug: str
    name: str
    niche: str
    description: str = ""

    # Inheritance
    inherits: str | None = None

    # Voice settings
    voice_locked: bool = False
    voice_name: str | None = None
    voice_id: str | None = None
    voice_model: str | None = None
    voice_stability: float | None = None
    voice_similarity: float | None = None
    voice_style: float | None = None
    voice_base_wpm: int | None = None
    voice_slow_wpm: int | None = None

    # Brand settings
    brand_locked: bool = False
    brand_intro_path: str | None = None
    brand_icon_path: str | None = None

    # Production defaults
    default_format: str = "documentary"
    default_model: str = "claude-sonnet-4-6"
    runway_max_scenes: int = 4

    # Visual style
    dalle_style_suffix: str = "cinematic, photorealistic, 4K documentary style, no text in frame"
    visual_style: str = "cinematic, documentary, stylized realism"
    tone_instruction: str = ""
    style_model: str = ""

    # Counters
    published_count: int = 0
    avg_views: int | None = None

    # Upload settings
    upload_frequency: int | None = None
    upload_timezone: str | None = None

    # Notification preferences
    notification_config: dict[str, Any] = field(default_factory=dict)


class ProfileManager:
    """Manages channel profiles stored as TOML files on disk."""

    def __init__(self, profiles_dir: Path) -> None:
        self._dir = profiles_dir
        self._dir.mkdir(parents=True, exist_ok=True)

    def _profile_path(self, slug: str) -> Path:
        return self._dir / slug / "profile.toml"

    def _prompts_dir(self, slug: str) -> Path:
        return self._dir / slug / "prompts"

    def _overrides_dir(self, slug: str) -> Path:
        return self._dir / slug / "prompts" / "overrides"

    def exists(self, slug: str) -> bool:
        return self._profile_path(slug).exists()

    def load(self, slug: str) -> ProfileData:
        """Load a profile from TOML, applying inheritance if configured."""
        path = self._profile_path(slug)
        if not path.exists():
            raise FileNotFoundError(f"Profile not found: {slug}")

        with open(path, "rb") as f:
            raw = tomli.load(f)

        profile_data = raw.get("profile", raw)

        # Apply inheritance: load parent first, then overlay child values
        inherits = profile_data.get("inherits")
        if inherits and self.exists(inherits):
            parent = self.load(inherits)
            parent_dict = _profile_to_dict(parent)
            parent_dict.update({k: v for k, v in profile_data.items() if v is not None})
            return ProfileData(**parent_dict)

        return ProfileData(**profile_data)

    def save(self, profile: ProfileData) -> Path:
        """Save a profile to TOML on disk."""
        profile_dir = self._dir / profile.slug
        profile_dir.mkdir(parents=True, exist_ok=True)
        self._prompts_dir(profile.slug).mkdir(parents=True, exist_ok=True)
        self._overrides_dir(profile.slug).mkdir(parents=True, exist_ok=True)

        data = {"profile": _profile_to_dict(profile)}
        path = self._profile_path(profile.slug)
        with open(path, "wb") as f:
            tomli_w.dump(data, f)
        return path

    def delete(self, slug: str) -> bool:
        """Delete a profile directory. Returns True if it existed."""
        import shutil

        profile_dir = self._dir / slug
        if profile_dir.exists():
            shutil.rmtree(profile_dir)
            return True
        return False

    def list_profiles(self) -> list[ProfileData]:
        """List all profiles found in the profiles directory."""
        profiles: list[ProfileData] = []
        if not self._dir.exists():
            return profiles
        for sub in sorted(self._dir.iterdir()):
            if sub.is_dir() and (sub / "profile.toml").exists():
                try:
                    profiles.append(self.load(sub.name))
                except Exception:
                    continue
        return profiles

    def create_profile(
        self,
        name: str,
        niche: str,
        slug: str | None = None,
        **kwargs: Any,
    ) -> ProfileData:
        """Create a new profile with given parameters."""
        slug = slug or slugify(name, separator="-")
        if self.exists(slug):
            raise ValueError(f"Profile already exists: {slug}")

        profile = ProfileData(slug=slug, name=name, niche=niche, **kwargs)
        self.save(profile)
        return profile

    def export_profile(self, slug: str, output_path: Path) -> Path:
        """Export a profile as a tar.gz archive for portability."""
        import tarfile

        profile_dir = self._dir / slug
        if not profile_dir.exists():
            raise FileNotFoundError(f"Profile not found: {slug}")

        output_path.parent.mkdir(parents=True, exist_ok=True)
        with tarfile.open(output_path, "w:gz") as tar:
            tar.add(profile_dir, arcname=slug)
        return output_path

    def import_profile(self, archive_path: Path) -> str:
        """Import a profile from a tar.gz archive. Returns the profile slug."""
        import tarfile

        with tarfile.open(archive_path, "r:gz") as tar:
            # Security: check for path traversal
            for member in tar.getmembers():
                if member.name.startswith("/") or ".." in member.name:
                    raise ValueError(f"Unsafe path in archive: {member.name}")
            top_level = {m.name.split("/")[0] for m in tar.getmembers()}
            if len(top_level) != 1:
                raise ValueError("Archive must contain exactly one profile directory")
            slug = top_level.pop()
            tar.extractall(path=self._dir)
        return slug


def _profile_to_dict(profile: ProfileData) -> dict[str, Any]:
    """Convert a ProfileData to dict, excluding None values for clean TOML."""
    from dataclasses import asdict

    data = asdict(profile)
    return {k: v for k, v in data.items() if v is not None}
