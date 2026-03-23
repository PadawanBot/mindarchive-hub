"""Google Drive backup service — uploads project assets to a structured Drive folder."""

from __future__ import annotations

import json
import logging
import mimetypes
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)

GDRIVE_API_BASE = "https://www.googleapis.com/drive/v3"
GDRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files"

# Folder structure for each project backup
BACKUP_FOLDERS = ["scripts", "visuals", "audio", "video", "thumbnails", "metadata"]


class GoogleDriveBackup:
    """Backs up project assets to Google Drive with organized folder structure."""

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
                f"Google Drive OAuth credentials not found: {self._creds_path}\n"
                "Run 'mindarchive config set gdrive_oauth_path <path>' to configure."
            )

        data = json.loads(self._creds_path.read_text())

        if "installed" in data:
            client = data["installed"]
        elif "web" in data:
            client = data["web"]
        else:
            client = data

        self._client_id = client.get("client_id", "")
        self._client_secret = client.get("client_secret", "")

        # Load saved tokens
        token_path = self._creds_path.parent / "gdrive_token.json"
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
                "No Google Drive access token. "
                "Run 'mindarchive config gdrive-auth' to authenticate."
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

        token_path = self._creds_path.parent / "gdrive_token.json"
        token_data = {"access_token": self._access_token, "refresh_token": self._refresh_token}
        token_path.write_text(json.dumps(token_data))

        return self._access_token

    async def backup_project(
        self,
        project_dir: Path,
        project_slug: str,
        parent_folder_id: str | None = None,
    ) -> dict[str, Any]:
        """Upload an entire project directory to Google Drive.

        Creates the following structure on Drive:
            MindArchive/
              <project-slug>/
                scripts/
                visuals/
                audio/
                video/
                thumbnails/
                metadata/

        Args:
            project_dir: Local project directory path.
            project_slug: Project identifier.
            parent_folder_id: Optional Drive folder ID for the MindArchive root.

        Returns:
            Dict with folder IDs, uploaded file count, and total bytes.
        """
        token = await self._ensure_access_token()

        # Find or create root MindArchive folder
        root_id = parent_folder_id or await self._find_or_create_folder(
            "MindArchive", parent_id=None, token=token
        )

        # Create project folder
        project_folder_id = await self._find_or_create_folder(
            project_slug, parent_id=root_id, token=token
        )

        uploaded_files: list[dict[str, Any]] = []
        total_bytes = 0

        for subfolder in BACKUP_FOLDERS:
            local_dir = project_dir / subfolder
            if not local_dir.exists():
                continue

            # Create subfolder on Drive
            sub_folder_id = await self._find_or_create_folder(
                subfolder, parent_id=project_folder_id, token=token
            )

            # Upload all files in this subfolder
            for file_path in local_dir.iterdir():
                if file_path.is_file():
                    result = await self._upload_file(
                        file_path, parent_id=sub_folder_id, token=token
                    )
                    uploaded_files.append(result)
                    total_bytes += file_path.stat().st_size

        logger.info(
            "Backup complete: %s — %d files, %.1f MB",
            project_slug,
            len(uploaded_files),
            total_bytes / 1_000_000,
        )

        return {
            "project_slug": project_slug,
            "drive_folder_id": project_folder_id,
            "files_uploaded": len(uploaded_files),
            "total_bytes": total_bytes,
            "files": uploaded_files,
        }

    async def upload_single_file(
        self,
        file_path: Path,
        folder_id: str,
    ) -> dict[str, Any]:
        """Upload a single file to a specific Drive folder."""
        token = await self._ensure_access_token()
        return await self._upload_file(file_path, parent_id=folder_id, token=token)

    async def _find_or_create_folder(
        self,
        name: str,
        parent_id: str | None,
        token: str,
    ) -> str:
        """Find an existing folder or create a new one."""
        query = f"name='{name}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
        if parent_id:
            query += f" and '{parent_id}' in parents"

        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{GDRIVE_API_BASE}/files",
                headers={"Authorization": f"Bearer {token}"},
                params={"q": query, "fields": "files(id,name)"},
                timeout=15.0,
            )
            response.raise_for_status()
            data = response.json()

        files = data.get("files", [])
        if files:
            return files[0]["id"]

        # Create the folder
        metadata: dict[str, Any] = {
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
        }
        if parent_id:
            metadata["parents"] = [parent_id]

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{GDRIVE_API_BASE}/files",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json=metadata,
                timeout=15.0,
            )
            response.raise_for_status()

        folder_id = response.json()["id"]
        logger.info("Created Drive folder: %s (id=%s)", name, folder_id)
        return folder_id

    async def _upload_file(
        self,
        file_path: Path,
        parent_id: str,
        token: str,
    ) -> dict[str, Any]:
        """Upload a single file using multipart upload."""
        mime_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        file_size = file_path.stat().st_size

        logger.info("Uploading to Drive: %s (%d bytes)", file_path.name, file_size)

        metadata = {
            "name": file_path.name,
            "parents": [parent_id],
        }

        # Use resumable upload for large files (>5MB)
        if file_size > 5 * 1024 * 1024:
            return await self._resumable_upload(file_path, metadata, mime_type, token)

        # Simple multipart upload for small files
        import io

        boundary = "mindarchive_boundary"
        body = io.BytesIO()

        # Part 1: metadata
        body.write(f"--{boundary}\r\n".encode())
        body.write(b"Content-Type: application/json; charset=UTF-8\r\n\r\n")
        body.write(json.dumps(metadata).encode())
        body.write(b"\r\n")

        # Part 2: file content
        body.write(f"--{boundary}\r\n".encode())
        body.write(f"Content-Type: {mime_type}\r\n\r\n".encode())
        body.write(file_path.read_bytes())
        body.write(f"\r\n--{boundary}--".encode())

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{GDRIVE_UPLOAD_URL}?uploadType=multipart",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": f"multipart/related; boundary={boundary}",
                },
                content=body.getvalue(),
                timeout=120.0,
            )
            response.raise_for_status()

        result = response.json()
        return {
            "file_id": result.get("id"),
            "name": file_path.name,
            "size": file_size,
            "mime_type": mime_type,
        }

    async def _resumable_upload(
        self,
        file_path: Path,
        metadata: dict[str, Any],
        mime_type: str,
        token: str,
    ) -> dict[str, Any]:
        """Resumable upload for large files."""
        file_size = file_path.stat().st_size

        async with httpx.AsyncClient() as client:
            # Initiate upload
            init_resp = await client.post(
                f"{GDRIVE_UPLOAD_URL}?uploadType=resumable",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json; charset=UTF-8",
                    "X-Upload-Content-Type": mime_type,
                    "X-Upload-Content-Length": str(file_size),
                },
                json=metadata,
                timeout=15.0,
            )
            init_resp.raise_for_status()

            upload_url = init_resp.headers.get("Location")
            if not upload_url:
                raise RuntimeError("Drive did not return resumable upload URL")

            # Upload file content
            with open(file_path, "rb") as f:
                upload_resp = await client.put(
                    upload_url,
                    content=f.read(),
                    headers={
                        "Content-Type": mime_type,
                        "Content-Length": str(file_size),
                    },
                    timeout=600.0,
                )
                upload_resp.raise_for_status()

        result = upload_resp.json()
        return {
            "file_id": result.get("id"),
            "name": file_path.name,
            "size": file_size,
            "mime_type": mime_type,
        }
