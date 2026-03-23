"""YouTube Data API v3 uploader — uploads video, sets metadata, and manages thumbnails."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# YouTube API endpoints
YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3"
YOUTUBE_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos"

# Category IDs (common faceless YouTube niches)
CATEGORY_IDS = {
    "education": "27",
    "science_technology": "28",
    "entertainment": "24",
    "howto_style": "26",
    "people_blogs": "22",
    "news_politics": "25",
    "film_animation": "1",
}

# Max description length
MAX_DESCRIPTION_LENGTH = 5000
MAX_TAGS_COUNT = 500


class YouTubeUploader:
    """Uploads videos to YouTube via the Data API v3 with OAuth2 credentials."""

    def __init__(
        self,
        oauth_credentials_path: Path,
    ) -> None:
        self._creds_path = oauth_credentials_path
        self._access_token: str | None = None
        self._refresh_token: str | None = None
        self._client_id: str = ""
        self._client_secret: str = ""
        self._load_credentials()

    def _load_credentials(self) -> None:
        """Load OAuth2 credentials from the JSON file."""
        if not self._creds_path.exists():
            raise FileNotFoundError(
                f"YouTube OAuth credentials not found: {self._creds_path}\n"
                "Run 'mindarchive config set youtube_oauth_path <path>' to configure."
            )

        data = json.loads(self._creds_path.read_text())

        # Support both direct token format and Google OAuth client format
        if "installed" in data:
            client = data["installed"]
            self._client_id = client["client_id"]
            self._client_secret = client["client_secret"]
        elif "web" in data:
            client = data["web"]
            self._client_id = client["client_id"]
            self._client_secret = client["client_secret"]

        # Load saved tokens if present
        token_path = self._creds_path.parent / "youtube_token.json"
        if token_path.exists():
            tokens = json.loads(token_path.read_text())
            self._access_token = tokens.get("access_token")
            self._refresh_token = tokens.get("refresh_token")

    async def _ensure_access_token(self) -> str:
        """Refresh the access token if needed."""
        if self._access_token:
            return self._access_token

        if not self._refresh_token:
            raise RuntimeError(
                "No YouTube access token available. "
                "Run 'mindarchive config youtube-auth' to authenticate."
            )

        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                    "refresh_token": self._refresh_token,
                    "grant_type": "refresh_token",
                },
                timeout=15.0,
            )
            response.raise_for_status()
            data = response.json()

        self._access_token = data["access_token"]

        # Persist refreshed token
        token_path = self._creds_path.parent / "youtube_token.json"
        token_data = {"access_token": self._access_token, "refresh_token": self._refresh_token}
        token_path.write_text(json.dumps(token_data))

        return self._access_token

    async def upload_video(
        self,
        video_path: Path,
        title: str,
        description: str,
        tags: list[str],
        category: str = "education",
        privacy: str = "private",
        scheduled_publish_at: str | None = None,
        default_language: str = "en",
        made_for_kids: bool = False,
    ) -> dict[str, Any]:
        """Upload a video to YouTube.

        Args:
            video_path: Path to the MP4 file.
            title: Video title (max 100 chars).
            description: Video description (max 5000 chars).
            tags: Video tags.
            category: Category key from CATEGORY_IDS.
            privacy: private, unlisted, or public.
            scheduled_publish_at: ISO 8601 datetime for scheduled publish.
            default_language: Default language code.
            made_for_kids: Whether the video is made for kids.

        Returns:
            Dict with 'video_id', 'url', 'status', and YouTube response data.
        """
        if not video_path.exists():
            raise FileNotFoundError(f"Video file not found: {video_path}")

        token = await self._ensure_access_token()

        # Truncate description if needed
        if len(description) > MAX_DESCRIPTION_LENGTH:
            description = description[:MAX_DESCRIPTION_LENGTH - 3] + "..."

        # Build video metadata
        category_id = CATEGORY_IDS.get(category, CATEGORY_IDS["education"])

        status_body: dict[str, Any] = {
            "privacyStatus": privacy,
            "selfDeclaredMadeForKids": made_for_kids,
        }
        if scheduled_publish_at and privacy == "private":
            status_body["privacyStatus"] = "private"
            status_body["publishAt"] = scheduled_publish_at

        metadata = {
            "snippet": {
                "title": title[:100],
                "description": description,
                "tags": tags[:MAX_TAGS_COUNT],
                "categoryId": category_id,
                "defaultLanguage": default_language,
            },
            "status": status_body,
        }

        logger.info("Uploading video: %s (%s)", title, video_path.name)

        # Resumable upload
        file_size = video_path.stat().st_size
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8",
            "X-Upload-Content-Type": "video/mp4",
            "X-Upload-Content-Length": str(file_size),
        }

        async with httpx.AsyncClient() as client:
            # Step 1: Initiate resumable upload
            init_response = await client.post(
                f"{YOUTUBE_UPLOAD_URL}?uploadType=resumable&part=snippet,status",
                headers=headers,
                json=metadata,
                timeout=30.0,
            )
            init_response.raise_for_status()

            upload_url = init_response.headers.get("Location")
            if not upload_url:
                raise RuntimeError("YouTube did not return upload URL")

            # Step 2: Upload the video file
            with open(video_path, "rb") as f:
                upload_response = await client.put(
                    upload_url,
                    content=f.read(),
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "video/mp4",
                        "Content-Length": str(file_size),
                    },
                    timeout=600.0,  # 10 min for large files
                )
                upload_response.raise_for_status()

        result = upload_response.json()
        video_id = result.get("id", "")

        logger.info("Upload complete: video_id=%s", video_id)

        return {
            "video_id": video_id,
            "url": f"https://youtu.be/{video_id}",
            "status": result.get("status", {}).get("uploadStatus", "unknown"),
            "privacy": result.get("status", {}).get("privacyStatus", privacy),
            "raw_response": result,
        }

    async def set_thumbnail(
        self,
        video_id: str,
        thumbnail_path: Path,
    ) -> dict[str, Any]:
        """Set a custom thumbnail for an uploaded video.

        Requires YouTube Partner Program or verified account.
        """
        if not thumbnail_path.exists():
            raise FileNotFoundError(f"Thumbnail not found: {thumbnail_path}")

        token = await self._ensure_access_token()

        mime = "image/jpeg" if thumbnail_path.suffix in (".jpg", ".jpeg") else "image/png"

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{YOUTUBE_API_BASE}/thumbnails/set?videoId={video_id}",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": mime,
                },
                content=thumbnail_path.read_bytes(),
                timeout=30.0,
            )
            response.raise_for_status()

        logger.info("Thumbnail set for video %s", video_id)
        return response.json()

    async def update_video_metadata(
        self,
        video_id: str,
        title: str | None = None,
        description: str | None = None,
        tags: list[str] | None = None,
    ) -> dict[str, Any]:
        """Update metadata for an existing video."""
        token = await self._ensure_access_token()

        # First, get current snippet
        async with httpx.AsyncClient() as client:
            get_resp = await client.get(
                f"{YOUTUBE_API_BASE}/videos?part=snippet&id={video_id}",
                headers={"Authorization": f"Bearer {token}"},
                timeout=15.0,
            )
            get_resp.raise_for_status()
            current = get_resp.json()

        if not current.get("items"):
            raise ValueError(f"Video not found: {video_id}")

        snippet = current["items"][0]["snippet"]
        if title:
            snippet["title"] = title[:100]
        if description:
            snippet["description"] = description[:MAX_DESCRIPTION_LENGTH]
        if tags:
            snippet["tags"] = tags[:MAX_TAGS_COUNT]

        async with httpx.AsyncClient() as client:
            response = await client.put(
                f"{YOUTUBE_API_BASE}/videos?part=snippet",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={"id": video_id, "snippet": snippet},
                timeout=15.0,
            )
            response.raise_for_status()

        logger.info("Metadata updated for video %s", video_id)
        return response.json()

    async def get_video_status(self, video_id: str) -> dict[str, Any]:
        """Check the processing status of an uploaded video."""
        token = await self._ensure_access_token()

        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{YOUTUBE_API_BASE}/videos?part=status,processingDetails&id={video_id}",
                headers={"Authorization": f"Bearer {token}"},
                timeout=15.0,
            )
            response.raise_for_status()

        data = response.json()
        if not data.get("items"):
            return {"video_id": video_id, "status": "not_found"}

        item = data["items"][0]
        return {
            "video_id": video_id,
            "upload_status": item.get("status", {}).get("uploadStatus"),
            "privacy": item.get("status", {}).get("privacyStatus"),
            "processing": item.get("processingDetails", {}),
        }
