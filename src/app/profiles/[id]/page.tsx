"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Save, Trash2, Loader2 } from "lucide-react";
import type { ChannelProfile } from "@/types";

export default function ProfileDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [profile, setProfile] = useState<ChannelProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const loadProfile = useCallback(async () => {
    const res = await fetch(`/api/profiles/${params.id}`);
    const data = await res.json();
    if (data.success) setProfile(data.data);
  }, [params.id]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const updateField = (key: string, value: string) =>
    setProfile((prev) => (prev ? { ...prev, [key]: value } : null));

  const toggleAssetSource = (key: string, checked: boolean) =>
    setProfile((prev) => {
      if (!prev) return null;
      const current = prev.asset_sources || { dalle_images: true, stock_footage: true, hero_scenes: true };
      return { ...prev, asset_sources: { ...current, [key]: checked } };
    });

  const handleSave = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/profiles/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      const data = await res.json();
      if (data.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this channel profile?")) return;
    await fetch(`/api/profiles/${params.id}`, { method: "DELETE" });
    router.push("/profiles");
  };

  if (!profile) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/profiles">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">{profile.name}</h1>
            <div className="flex gap-2 mt-1">
              <Badge variant="outline">{profile.niche}</Badge>
              <Badge variant="outline">{profile.llm_provider}</Badge>
            </div>
          </div>
        </div>
        <Button variant="destructive" size="sm" onClick={handleDelete}>
          <Trash2 className="h-4 w-4 mr-2" />
          Delete
        </Button>
      </div>

      <Card>
        <CardTitle>Channel Identity</CardTitle>
        <CardContent className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Channel Name</label>
              <Input value={profile.name} onChange={(e) => updateField("name", e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Niche</label>
              <Input value={profile.niche} onChange={(e) => updateField("niche", e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <Textarea value={profile.description} onChange={(e) => updateField("description", e.target.value)} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Voice Style</label>
              <Select value={profile.voice_style} onChange={(e) => updateField("voice_style", e.target.value)}>
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
              <Input value={profile.target_audience} onChange={(e) => updateField("target_audience", e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardTitle>Production Preferences</CardTitle>
        <CardContent className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">LLM Provider</label>
              <Select value={profile.llm_provider} onChange={(e) => updateField("llm_provider", e.target.value)}>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI (GPT)</option>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Model</label>
              <Select value={profile.llm_model} onChange={(e) => updateField("llm_model", e.target.value)}>
                <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                <option value="claude-opus-4-6">Claude Opus 4.6</option>
                <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
                <option value="gpt-4o">GPT-4o</option>
                <option value="gpt-4o-mini">GPT-4o Mini</option>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Image Provider</label>
              <Select value={profile.image_provider} onChange={(e) => updateField("image_provider", e.target.value)}>
                <option value="dalle">DALL-E 3</option>
                <option value="pexels">Pexels Stock</option>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Voice ID</label>
              <Input value={profile.voice_id} onChange={(e) => updateField("voice_id", e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

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
            ] as const).map(({ key, label, desc }) => {
              const sources = profile.asset_sources || { dalle_images: true, stock_footage: true, hero_scenes: true };
              return (
                <label key={key} className="flex items-start gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={sources[key] !== false}
                    onChange={(e) => toggleAssetSource(key, e.target.checked)}
                    className="mt-0.5 rounded border-muted-foreground/30"
                  />
                  <div>
                    <span className="text-sm font-medium">{label}</span>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                  </div>
                </label>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4 mr-2" />
          {saving ? "Saving..." : "Save Changes"}
        </Button>
        {saved && <span className="text-sm text-success">Saved!</span>}
      </div>
    </div>
  );
}
