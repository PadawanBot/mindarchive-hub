# MindArchive Production Hub v2 — Claude Code Instructions

## Project Overview
MindArchive Production Hub is a Next.js web application that automates end-to-end faceless YouTube video production across any niche. It supports multiple channels through channel profiles and multiple video formats through format presets.

## Tech Stack
- **Frontend**: Next.js 14, React 18, TypeScript, Tailwind CSS 4
- **UI Components**: Custom components in src/components/ui/ (Button, Card, Input, Select, Badge, Textarea)
- **Backend**: Next.js API Routes (src/app/api/)
- **Database**: Local JSON store (src/lib/store.ts) — Supabase-ready schema in supabase/schema.sql
- **AI Providers**: Anthropic Claude, OpenAI GPT + DALL-E, ElevenLabs, Pexels
- **Hosting**: Vercel (web app) + Railway (worker for ffmpeg video assembly)

## Architecture
```
src/
├── app/                    # Next.js App Router pages & API routes
│   ├── dashboard/          # Main dashboard
│   ├── projects/           # Project list, detail, new production wizard
│   ├── profiles/           # Channel profile management
│   ├── settings/           # API keys & preferences
│   └── api/                # REST API routes
│       ├── settings/       # CRUD + test API keys
│       ├── profiles/       # Channel profile CRUD
│       ├── projects/       # Project CRUD
│       ├── formats/        # Format presets (built-in)
│       └── pipeline/       # AI research + pipeline execution
├── components/
│   ├── ui/                 # Reusable UI primitives
│   └── layout/             # Sidebar, navigation
├── lib/
│   ├── store.ts            # Local JSON file store (Supabase fallback)
│   ├── utils.ts            # Utility functions (cn, maskApiKey, etc.)
│   ├── providers/          # AI provider SDKs
│   │   ├── anthropic.ts    # Claude API wrapper
│   │   ├── openai.ts       # GPT + DALL-E wrapper
│   │   ├── elevenlabs.ts   # TTS wrapper
│   │   └── pexels.ts       # Stock media wrapper
│   └── supabase/           # Supabase client (when configured)
└── types/                  # TypeScript type definitions
```

## Pipeline Steps
1. Topic Research — AI suggests topics based on niche
2. Script Writing — Full narration script with visual cues
3. Hook Generation — 3 alternative viral hooks
4. Script Refinement — Polish pacing and transitions
5. Voiceover Generation — ElevenLabs TTS
6. Visual Direction — DALL-E prompts + Pexels queries
7. Thumbnail Creation — Thumbnail concepts
8. Video Assembly — ffmpeg render (worker service)

## Critical Production Rules (Enforce Always)
1. MOTION_GRAPHIC tags are visual supplements ONLY — never replace narration
2. Voiceover MP3 is the production clock — word count drives runtime, visuals sync to audio
3. No text in DALL-E prompts — Pillow/post-production handles all text overlays
4. Format preset parameters drive content generation
5. Profile voice/brand settings are immutable during a run

## Development
```bash
npm run dev    # Start development server (http://localhost:3000)
npm run build  # Production build
npm run start  # Start production server
```

## Code Style
- TypeScript strict mode
- React Server Components by default, "use client" only when needed
- Tailwind CSS for all styling — no CSS modules
- API routes return { success: boolean, data?: T, error?: string }
