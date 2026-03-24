"use client";

import { useState, useEffect } from "react";
import { Card, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Eye, EyeOff, Save, CheckCircle, AlertCircle } from "lucide-react";

interface ProviderConfig {
  key: string;
  label: string;
  placeholder: string;
  testEndpoint?: string;
}

const providers: ProviderConfig[] = [
  { key: "anthropic_key", label: "Anthropic (Claude)", placeholder: "sk-ant-..." },
  { key: "openai_key", label: "OpenAI (GPT + DALL-E)", placeholder: "sk-..." },
  { key: "elevenlabs_key", label: "ElevenLabs (Voice)", placeholder: "xi-..." },
  { key: "pexels_key", label: "Pexels (Stock Media)", placeholder: "..." },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, "success" | "error" | null>>({});

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setSettings(data.data);
      });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (data.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        setSaveError(data.error || "Failed to save settings");
      }
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (providerKey: string) => {
    setTestResults((prev) => ({ ...prev, [providerKey]: null }));
    try {
      const res = await fetch("/api/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerKey, key: settings[providerKey] }),
      });
      const data = await res.json();
      setTestResults((prev) => ({
        ...prev,
        [providerKey]: data.success ? "success" : "error",
      }));
    } catch {
      setTestResults((prev) => ({ ...prev, [providerKey]: "error" }));
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage your API keys and default preferences
        </p>
      </div>

      {/* API Keys */}
      <Card>
        <CardTitle>API Keys</CardTitle>
        <CardDescription className="mt-1">
          Your keys are stored locally and never sent to our servers.
        </CardDescription>
        <CardContent className="mt-6 space-y-6">
          {providers.map((provider) => (
            <div key={provider.key} className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">{provider.label}</label>
                {testResults[provider.key] === "success" && (
                  <Badge variant="success">
                    <CheckCircle className="h-3 w-3 mr-1" /> Connected
                  </Badge>
                )}
                {testResults[provider.key] === "error" && (
                  <Badge variant="destructive">
                    <AlertCircle className="h-3 w-3 mr-1" /> Failed
                  </Badge>
                )}
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={visibility[provider.key] ? "text" : "password"}
                    placeholder={provider.placeholder}
                    value={settings[provider.key] || ""}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        [provider.key]: e.target.value,
                      }))
                    }
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      setVisibility((prev) => ({
                        ...prev,
                        [provider.key]: !prev[provider.key],
                      }))
                    }
                  >
                    {visibility[provider.key] ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleTest(provider.key)}
                  disabled={!settings[provider.key]}
                  className="h-10"
                >
                  Test
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Default Preferences */}
      <Card>
        <CardTitle>Default Preferences</CardTitle>
        <CardDescription className="mt-1">
          These can be overridden per channel profile
        </CardDescription>
        <CardContent className="mt-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Default LLM</label>
              <Select
                value={settings.default_llm || "anthropic"}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, default_llm: e.target.value }))
                }
              >
                <option value="anthropic">Claude (Anthropic)</option>
                <option value="openai">GPT (OpenAI)</option>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Default Model</label>
              <Select
                value={settings.default_model || "claude-sonnet-4-6"}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, default_model: e.target.value }))
                }
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
                value={settings.default_image || "dalle"}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, default_image: e.target.value }))
                }
              >
                <option value="dalle">DALL-E 3 (OpenAI)</option>
                <option value="pexels">Pexels Stock</option>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Voice Provider</label>
              <Select
                value={settings.default_voice || "elevenlabs"}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, default_voice: e.target.value }))
                }
              >
                <option value="elevenlabs">ElevenLabs</option>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4 mr-2" />
          {saving ? "Saving..." : "Save Settings"}
        </Button>
        {saved && (
          <span className="text-sm text-success flex items-center gap-1">
            <CheckCircle className="h-4 w-4" /> Settings saved
          </span>
        )}
        {saveError && (
          <span className="text-sm text-red-500 flex items-center gap-1">
            <AlertCircle className="h-4 w-4" /> {saveError}
          </span>
        )}
      </div>
    </div>
  );
}
