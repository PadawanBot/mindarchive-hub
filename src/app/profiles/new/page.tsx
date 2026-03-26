"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Save, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function NewProfilePage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    niche: "",
    description: "",
    voice_style: "professional",
    target_audience: "",
    llm_provider: "anthropic",
    llm_model: "claude-sonnet-4-6",
    image_provider: "dalle",
    voice_provider: "elevenlabs",
    voice_id: "",
    asset_sources: {
      dalle_images: true,
      stock_footage: true,
      hero_scenes: true,
    },
  });

  const updateField = (key: string, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) {
        router.push("/profiles");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/profiles">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">New Channel Profile</h1>
          <p className="text-muted-foreground mt-1">
            Define your channel&apos;s identity and production preferences
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info */}
        <Card>
          <CardTitle>Channel Identity</CardTitle>
          <CardContent className="mt-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Channel Name *</label>
                <Input
                  required
                  placeholder="e.g., MindArchive"
                  value={form.name}
                  onChange={(e) => updateField("name", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Niche *</label>
                <Input
                  required
                  placeholder="e.g., Psychology & Human Behavior"
                  value={form.niche}
                  onChange={(e) => updateField("niche", e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Textarea
                placeholder="Brief description of what this channel covers..."
                value={form.description}
                onChange={(e) => updateField("description", e.target.value)}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Voice Style</label>
                <Select
                  value={form.voice_style}
                  onChange={(e) => updateField("voice_style", e.target.value)}
                >
                  <option value="professional">Professional</option>
                  <option value="conversational">Conversational</option>
                  <option value="dramatic">Dramatic</option>
                  <option value="educational">Educational</option>
                  <option value="storyteller">Storyteller</option>
                  <option value="energetic">Energetic</option>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Target Audience</label>
                <Input
                  placeholder="e.g., Adults 25-45 interested in self-improvement"
                  value={form.target_audience}
                  onChange={(e) => updateField("target_audience", e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Provider Settings */}
        <Card>
          <CardTitle>Production Preferences</CardTitle>
          <CardContent className="mt-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">LLM Provider</label>
                <Select
                  value={form.llm_provider}
                  onChange={(e) => updateField("llm_provider", e.target.value)}
                >
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="openai">OpenAI (GPT)</option>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Model</label>
                <Select
                  value={form.llm_model}
                  onChange={(e) => updateField("llm_model", e.target.value)}
                >
                  <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                  <option value="claude-opus-4-6">Claude Opus 4.6</option>
                  <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
                  <option value="gpt-4o">GPT-4o</option>
                  <option value="gpt-4o-mini">GPT-4o Mini</option>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Image Provider</label>
                <Select
                  value={form.image_provider}
                  onChange={(e) => updateField("image_provider", e.target.value)}
                >
                  <option value="dalle">DALL-E 3</option>
                  <option value="pexels">Pexels Stock</option>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Voice Provider</label>
                <Select
                  value={form.voice_provider}
                  onChange={(e) => updateField("voice_provider", e.target.value)}
                >
                  <option value="elevenlabs">ElevenLabs</option>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">ElevenLabs Voice ID</label>
              <Input
                placeholder="Voice ID from ElevenLabs dashboard"
                value={form.voice_id}
                onChange={(e) => updateField("voice_id", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Find voice IDs at elevenlabs.io → Voices → Click voice → ID
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Default Asset Sources */}
        <Card>
          <CardTitle>Default Asset Sources</CardTitle>
          <CardContent className="mt-4 space-y-4">
            <p className="text-xs text-muted-foreground">
              Choose which asset types to enable by default for projects on this channel.
              You can override per-project.
            </p>
            <div className="space-y-3">
              {([
                { key: "dalle_images", label: "DALL-E Images", desc: "AI-generated scene images via OpenAI DALL-E 3" },
                { key: "stock_footage", label: "Stock Footage", desc: "Atmospheric B-roll video clips from Pexels" },
                { key: "hero_scenes", label: "Hero Scenes", desc: "AI-generated video scenes via Runway ML" },
              ] as const).map(({ key, label, desc }) => (
                <label key={key} className="flex items-start gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.asset_sources[key]}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        asset_sources: { ...prev.asset_sources, [key]: e.target.checked },
                      }))
                    }
                    className="mt-0.5 rounded border-muted-foreground/30"
                  />
                  <div>
                    <span className="text-sm font-medium">{label}</span>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Creating..." : "Create Channel"}
          </Button>
          <Link href="/profiles">
            <Button variant="ghost">Cancel</Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
