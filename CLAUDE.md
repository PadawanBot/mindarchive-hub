# MindArchive Production Hub — Claude Code Instructions
## Project Overview
You are building the MindArchive Production Hub, a Python application that automates end-to-end faceless YouTube video production across any niche. The app supports multiple channels through a channel profile system and multiple video formats through format presets.
## Architecture Document
The full architecture is in MindArchive_App_Architecture_V1.1.md in this directory. Read it before writing any code.
## Build Order
Follow the implementation plan in Section 17 of the architecture document. Start with Phase A (Foundation).
First session priority:
1. Create pyproject.toml with all dependencies
2. Set up the src/mindarchive/ package structure
3. Implement database models (all 7 models)
4. Implement the channel profile system
5. Implement format presets
6. Get the CLI skeleton working (mindarchive --help)
## Critical Production Rules (Enforce Always)
1. MOTION_GRAPHIC tags are visual supplements ONLY — never replace narration
2. Voiceover MP3 is the production clock — word count drives runtime, visuals sync to audio
3. No text in DALL-E prompts — Pillow handles all text overlays
4. Format preset parameters drive content generation
5. Profile voice/brand settings are immutable during a run
6. Steps 4 and 7 skip conditionally — only when profile already has voice/brand
7. Step 1 skips when topic is provided directly
8. Steps 14-15 run per-channel, not per-video
## Tech Stack
Python 3.11+, FastAPI, Typer, SQLAlchemy, SQLite, Jinja2 + HTMX + Tailwind CSS
Anthropic SDK, OpenAI SDK, ElevenLabs SDK, httpx, Pillow, ffmpeg (subprocess)
Fernet encryption for API key storage, TOML for profile configs
## Code Style
- Type hints on all function signatures
- Async where I/O is involved
- Pydantic models for all API request/response validation
- Clear docstrings on public methods
- No hardcoded API keys — everything through the credential store
