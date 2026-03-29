"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ArrowRight,
  Search,
  Sparkles,
  CheckCircle,
  Loader2,
  FileText,
  Mic,
  Image,
  Film,
  Clock,
  Repeat2,
} from "lucide-react";
import Link from "next/link";
import type { ChannelProfile, FormatPreset, TopicSuggestion, TopicBankItem, Project } from "@/types";

type WizardStep = "setup" | "research" | "plan" | "confirm";

const PIPELINE_STEPS = [
  { id: "topic_research", label: "Topic Research", icon: Search, phase: "pre" },
  { id: "script_writing", label: "Script Writing", icon: FileText, phase: "pre" },
  { id: "hook_engineering", label: "Hook Engineering", icon: Sparkles, phase: "pre" },
  { id: "voice_selection", label: "Voice Selection", icon: Mic, phase: "pre" },
  { id: "visual_direction", label: "Visual Direction", icon: Image, phase: "pre" },
  { id: "blend_curator", label: "Blend Curator", icon: Film, phase: "pre" },
  { id: "brand_assets", label: "Brand Assets", icon: Image, phase: "pre" },
  { id: "script_refinement", label: "Script Refinement", icon: FileText, phase: "pre" },
  { id: "timing_sync", label: "Timing Sync", icon: Clock, phase: "pre" },
  { id: "thumbnail_creation", label: "Thumbnail Creation", icon: Image, phase: "pre" },
  { id: "retention_structure", label: "Retention Structure", icon: Sparkles, phase: "pre" },
  { id: "comment_magnet", label: "Comment Magnet", icon: Sparkles, phase: "pre" },
  { id: "upload_blueprint", label: "Upload Blueprint", icon: FileText, phase: "pre" },
  { id: "voiceover_generation", label: "Voiceover Generation", icon: Mic, phase: "production" },
  { id: "image_generation", label: "Image Generation", icon: Image, phase: "production" },
  { id: "stock_footage", label: "Stock Footage", icon: Film, phase: "production" },
  { id: "motion_graphics", label: "Motion Graphics", icon: Film, phase: "production" },
  { id: "hero_scenes", label: "Hero Scenes", icon: Film, phase: "production" },
];

export default function NewProductionPageWrapper() {
  return (
    <Suspense>
      <NewProductionPage />
    </Suspense>
  );
}

function NewProductionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<WizardStep>("setup");
  const [profiles, setProfiles] = useState<ChannelProfile[]>([]);
  const [formats, setFormats] = useState<FormatPreset[]>([]);
  const [loading, setLoading] = useState(false);

  // Form state
  const [profileId, setProfileId] = useState("");
  const [formatId, setFormatId] = useState("");
  const [nicheInput, setNicheInput] = useState("");

  // Follow-up state
  const [followupProject, setFollowupProject] = useState<Pick<Project, "id" | "topic"> | null>(null);
  const [followupContext, setFollowupContext] = useState<string>("");

  // Topic bank state
  const [bankTopics, setBankTopics] = useState<TopicBankItem[]>([]);
  const [topicBankId, setTopicBankId] = useState<string | null>(null);
  const [showingBank, setShowingBank] = useState(false);
  const [topicSuggestions, setTopicSuggestions] = useState<TopicSuggestion[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<TopicSuggestion | null>(null);
  const [customTopic, setCustomTopic] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/profiles").then((r) => r.json()),
      fetch("/api/formats").then((r) => r.json()),
    ]).then(([profilesData, formatsData]) => {
      if (profilesData.success) setProfiles(profilesData.data);
      if (formatsData.success) setFormats(formatsData.data);

      // Handle deep-link from topic bank: /projects/new?topic_bank_id=X&profile_id=Y
      const tbId = searchParams.get("topic_bank_id");
      const pId = searchParams.get("profile_id");
      if (tbId && pId) {
        setProfileId(pId);
        const p = (profilesData.data as ChannelProfile[])?.find((x) => x.id === pId);
        if (p?.niche) setNicheInput(p.niche);
        // Fetch the specific topic
        fetch(`/api/topic-bank/${tbId}`).then(r => r.json()).then(d => {
          if (d.success && d.data) {
            const t = d.data as TopicBankItem;
            setSelectedTopic({ title: t.title, angle: t.angle, keywords: t.keywords, estimated_interest: t.estimated_interest, reasoning: t.reasoning });
            setTopicBankId(t.id);
            setStep("plan");
          }
        });
      }

      // Handle follow-up: /projects/new?followup_from=X&profile_id=Y
      const followupFrom = searchParams.get("followup_from");
      if (followupFrom) {
        Promise.all([
          fetch(`/api/projects/${followupFrom}`).then(r => r.json()),
          fetch(`/api/pipeline/steps?project_id=${followupFrom}`).then(r => r.json()),
        ]).then(([projData, stepsData]) => {
          if (projData.success && projData.data) {
            const orig = projData.data as Project;
            setFollowupProject({ id: orig.id, topic: orig.topic });
            // Pre-fill profile + format from original
            if (orig.profile_id) {
              setProfileId(orig.profile_id);
              const p = (profilesData.data as ChannelProfile[])?.find((x) => x.id === orig.profile_id);
              if (p?.niche) setNicheInput(p.niche);
            }
            if (orig.format_id) setFormatId(orig.format_id);
            // Extract original script as follow-up context (first 4000 chars)
            if (stepsData.success && Array.isArray(stepsData.data)) {
              const scriptStep = stepsData.data.find((s: { step: string; status: string; output?: { script?: string } }) =>
                s.step === "script_writing" && s.status === "completed"
              );
              const scriptText = scriptStep?.output?.script || "";
              setFollowupContext(scriptText.slice(0, 4000));
            }
          }
        });
      }
    });
  }, [searchParams]);

  // Fetch available bank topics when profile changes
  useEffect(() => {
    if (!profileId) { setBankTopics([]); return; }
    fetch(`/api/topic-bank?profile_id=${profileId}&status=available`)
      .then(r => r.json())
      .then(d => { if (d.success) setBankTopics(d.data); })
      .catch(() => {});
  }, [profileId]);

  const selectedProfile = profiles.find((p) => p.id === profileId);
  const selectedFormat = formats.find((f) => f.id === formatId);

  const handleResearch = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/pipeline/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          niche: nicheInput || selectedProfile?.niche || "",
          profile_id: profileId,
          format_id: formatId,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTopicSuggestions(data.data);
        setStep("research");
      }
    } finally {
      setLoading(false);
    }
  };

  const [startError, setStartError] = useState<string | null>(null);

  const handleStartProduction = async () => {
    setLoading(true);
    setStartError(null);
    try {
      const topic = selectedTopic?.title || customTopic;
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: topic,
          topic,
          topic_data: selectedTopic,
          profile_id: profileId,
          format_id: formatId,
          additional_notes: additionalNotes,
          ...(topicBankId ? { topic_bank_id: topicBankId } : {}),
          ...(followupProject ? {
            metadata: {
              followup_from: followupProject.id,
              followup_original_topic: followupProject.topic,
              followup_context: followupContext,
            }
          } : {}),
        }),
      });
      const text = await res.text();
      if (!text) {
        setStartError(`Server returned empty response (status ${res.status})`);
        return;
      }
      const data = JSON.parse(text);
      if (data.success) {
        router.push(`/projects/${data.data.id}`);
      } else {
        setStartError(data.error || "Failed to create project");
      }
    } catch (err) {
      setStartError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">New Production</h1>
          {followupProject ? (
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className="text-xs gap-1">
                <Repeat2 className="h-3 w-3" />
                Follow-up from: {followupProject.topic}
              </Badge>
            </div>
          ) : (
            <p className="text-muted-foreground mt-1">
              Create a new video from research to final render
            </p>
          )}
        </div>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center gap-2">
        {(["setup", "research", "plan", "confirm"] as WizardStep[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium ${
                step === s
                  ? "bg-primary text-white"
                  : (["setup", "research", "plan", "confirm"].indexOf(step) > i)
                  ? "bg-success/20 text-success"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {["setup", "research", "plan", "confirm"].indexOf(step) > i ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                i + 1
              )}
            </div>
            <span className="text-xs text-muted-foreground capitalize hidden sm:inline">
              {s}
            </span>
            {i < 3 && <div className="h-px w-8 bg-border" />}
          </div>
        ))}
      </div>

      {/* Step 1: Setup */}
      {step === "setup" && (
        <div className="space-y-6">
          <Card>
            <CardTitle>Choose Channel & Format</CardTitle>
            <CardDescription className="mt-1">
              Select which channel this video is for and what format to use
            </CardDescription>
            <CardContent className="mt-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Channel Profile *</label>
                  <Select
                    value={profileId}
                    onChange={(e) => {
                      setProfileId(e.target.value);
                      const p = profiles.find((x) => x.id === e.target.value);
                      if (p?.niche) setNicheInput(p.niche);
                    }}
                  >
                    <option value="">Select a channel...</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {p.niche}
                      </option>
                    ))}
                  </Select>
                  {profiles.length === 0 && (
                    <p className="text-xs text-warning">
                      No channels yet.{" "}
                      <Link href="/profiles/new" className="underline">
                        Create one first
                      </Link>
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Video Format *</label>
                  <Select
                    value={formatId}
                    onChange={(e) => setFormatId(e.target.value)}
                  >
                    <option value="">Select a format...</option>
                    {formats.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} ({f.duration_min / 60}-{f.duration_max / 60} min)
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              {selectedFormat && (
                <div className="p-3 rounded-lg bg-muted text-sm">
                  <p className="font-medium">{selectedFormat.name}</p>
                  <p className="text-muted-foreground mt-1">
                    {selectedFormat.description}
                  </p>
                  <div className="flex gap-3 mt-2">
                    <Badge variant="outline">
                      {selectedFormat.word_count_min}-{selectedFormat.word_count_max} words
                    </Badge>
                    <Badge variant="outline">{selectedFormat.wpm} WPM</Badge>
                    <Badge variant="outline">
                      {selectedFormat.sections?.length} sections
                    </Badge>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardTitle>Topic Direction</CardTitle>
            <CardDescription className="mt-1">
              Enter a niche to research, or provide a specific topic directly
            </CardDescription>
            <CardContent className="mt-4 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Niche / Topic Area (for AI research)
                </label>
                <Input
                  placeholder="e.g., Dark psychology manipulation tactics"
                  value={nicheInput}
                  onChange={(e) => setNicheInput(e.target.value)}
                />
              </div>
              <div className="text-center text-xs text-muted-foreground">— OR —</div>
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Specific Topic (skip research)
                </label>
                <Input
                  placeholder="e.g., 7 Signs Someone Is Secretly Manipulating You"
                  value={customTopic}
                  onChange={(e) => setCustomTopic(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-3 flex-wrap">
            {customTopic ? (
              <Button
                onClick={() => {
                  setSelectedTopic(null);
                  setTopicBankId(null);
                  setStep("plan");
                }}
                disabled={!profileId || !formatId}
              >
                Skip to Planning
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            ) : (
              <>
                <Button
                  onClick={handleResearch}
                  disabled={!profileId || !formatId || !nicheInput || loading}
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4 mr-2" />
                  )}
                  {loading ? "Researching..." : "Research Topics"}
                </Button>
                {bankTopics.length > 0 && (
                  <Button
                    variant="outline"
                    onClick={() => setShowingBank(!showingBank)}
                    disabled={!profileId || !formatId}
                  >
                    <Sparkles className="h-4 w-4 mr-2" />
                    Pick from Bank ({bankTopics.length})
                  </Button>
                )}
              </>
            )}
          </div>

          {/* Topic Bank picker */}
          {showingBank && bankTopics.length > 0 && (
            <Card>
              <CardTitle>Topic Bank</CardTitle>
              <CardDescription className="mt-1">
                Select a topic from your saved bank to start production
              </CardDescription>
              <CardContent className="mt-4 space-y-2">
                {bankTopics.map(topic => (
                  <button
                    key={topic.id}
                    onClick={() => {
                      setSelectedTopic({
                        title: topic.title,
                        angle: topic.angle,
                        keywords: topic.keywords,
                        estimated_interest: topic.estimated_interest,
                        reasoning: topic.reasoning,
                      });
                      setTopicBankId(topic.id);
                      setShowingBank(false);
                      setStep("plan");
                    }}
                    className="w-full text-left p-3 rounded-lg border border-muted-foreground/10 hover:border-primary/50 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm">{topic.title}</span>
                      <Badge variant={topic.estimated_interest === "high" ? "default" : "outline"} className="text-[10px]">
                        {topic.estimated_interest}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{topic.angle}</p>
                  </button>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Step 2: Research Results */}
      {step === "research" && (
        <div className="space-y-6">
          <Card>
            <CardTitle>Topic Suggestions</CardTitle>
            <CardDescription className="mt-1">
              AI-generated topic ideas based on your niche. Select one to continue.
            </CardDescription>
            <CardContent className="mt-4 space-y-3">
              {topicSuggestions.map((topic, i) => (
                <button
                  key={i}
                  type="button"
                  className={`w-full text-left p-4 rounded-lg border transition-colors cursor-pointer ${
                    selectedTopic === topic
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/50 bg-muted"
                  }`}
                  onClick={() => setSelectedTopic(topic)}
                >
                  <div className="flex items-start justify-between">
                    <h4 className="font-medium">{topic.title}</h4>
                    <Badge
                      variant={
                        topic.estimated_interest === "high"
                          ? "success"
                          : topic.estimated_interest === "medium"
                          ? "warning"
                          : "outline"
                      }
                    >
                      {topic.estimated_interest} interest
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{topic.angle}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {topic.keywords?.map((kw) => (
                      <Badge key={kw} variant="outline" className="text-xs">
                        {kw}
                      </Badge>
                    ))}
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setStep("setup")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <Button
              onClick={() => setStep("plan")}
              disabled={!selectedTopic}
            >
              Continue with Selected Topic
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Plan & Notes */}
      {step === "plan" && (
        <div className="space-y-6">
          <Card>
            <CardTitle>Production Plan</CardTitle>
            <CardDescription className="mt-1">
              Review the pipeline steps that will run for this video
            </CardDescription>
            <CardContent className="mt-4">
              <div className="space-y-2">
                {PIPELINE_STEPS.map((ps) => (
                  <div
                    key={ps.id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-muted"
                  >
                    <ps.icon className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium flex-1">{ps.label}</span>
                    <Badge variant="outline" className="text-xs capitalize">
                      {ps.phase}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardTitle>Additional Notes</CardTitle>
            <CardDescription className="mt-1">
              Any special instructions for the AI during production
            </CardDescription>
            <CardContent className="mt-4">
              <Textarea
                placeholder="e.g., Include a section about the Stanford Prison Experiment. Keep the tone slightly ominous but not over-the-top."
                value={additionalNotes}
                onChange={(e) => setAdditionalNotes(e.target.value)}
                rows={4}
              />
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setStep(topicSuggestions.length > 0 ? "research" : "setup")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <Button onClick={() => setStep("confirm")}>
              Review & Confirm
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 4: Confirm */}
      {step === "confirm" && (
        <div className="space-y-6">
          <Card>
            <CardTitle>Confirm Production</CardTitle>
            <CardContent className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Channel:</span>
                  <p className="font-medium">{selectedProfile?.name}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Format:</span>
                  <p className="font-medium">{selectedFormat?.name}</p>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Topic:</span>
                  <p className="font-medium">
                    {selectedTopic?.title || customTopic}
                  </p>
                  {selectedTopic?.angle && (
                    <p className="text-muted-foreground text-xs mt-1">
                      {selectedTopic.angle}
                    </p>
                  )}
                </div>
                {additionalNotes && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Notes:</span>
                    <p className="text-xs mt-1">{additionalNotes}</p>
                  </div>
                )}
                {followupProject && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Follow-up from:</span>
                    <p className="text-xs mt-1 flex items-center gap-1">
                      <Repeat2 className="h-3 w-3 shrink-0" />
                      {followupProject.topic}
                    </p>
                    {followupContext && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Original script context will be provided to the scriptwriter.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setStep("plan")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <Button onClick={handleStartProduction} disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              {loading ? "Creating..." : "Start Production"}
            </Button>
          </div>
          {startError && (
            <p className="text-sm text-red-500 mt-2">{startError}</p>
          )}
        </div>
      )}
    </div>
  );
}
