"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Pickaxe, Play, Archive, Trash2, RotateCcw, X, Snowflake } from "lucide-react";
import type { TopicBankItem, TopicStatus } from "@/types";

const STATUS_FILTERS: { label: string; value: TopicStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Available", value: "available" },
  { label: "In Production", value: "in_production" },
  { label: "Produced", value: "produced" },
  { label: "Published", value: "published" },
  { label: "Icebox", value: "icebox" },
  { label: "Rejected", value: "rejected" },
  { label: "Archived", value: "archived" },
];

const interestVariant = (interest: string) => {
  if (interest === "high") return "default" as const;
  if (interest === "medium") return "outline" as const;
  return "outline" as const;
};

const statusVariant = (status: string) => {
  if (status === "available") return "success" as const;
  if (status === "in_production") return "warning" as const;
  if (status === "produced" || status === "published") return "default" as const;
  if (status === "rejected") return "destructive" as const;
  return "outline" as const;
};

export function TopicBankList({ profileId }: { profileId: string }) {
  const [topics, setTopics] = useState<TopicBankItem[]>([]);
  const [filter, setFilter] = useState<TopicStatus | "all">("all");
  const [mining, setMining] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTopics = useCallback(async () => {
    try {
      const res = await fetch(`/api/topic-bank?profile_id=${profileId}`);
      const data = await res.json();
      if (data.success) setTopics(data.data);
    } catch {}
    setLoading(false);
  }, [profileId]);

  useEffect(() => {
    loadTopics();
  }, [loadTopics]);

  const mineTopic = async () => {
    setMining(true);
    setError(null);
    try {
      const res = await fetch("/api/topic-bank/mine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile_id: profileId }),
      });
      const text = await res.text();
      let data: { success: boolean; error?: string };
      try {
        data = JSON.parse(text);
      } catch {
        // Vercel timeout or unexpected error — surface it clearly
        setError(res.status === 504 || res.status === 408
          ? "Request timed out — the AI is taking too long. Please try again."
          : `Server error (${res.status}): ${text.slice(0, 150)}`);
        setMining(false);
        return;
      }
      if (!data.success) {
        setError(data.error || "Mining failed");
      } else {
        await loadTopics();
      }
    } catch (err) {
      setError(String(err));
    }
    setMining(false);
  };

  const updateStatus = async (id: string, status: TopicStatus) => {
    try {
      await fetch(`/api/topic-bank/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      await loadTopics();
    } catch {}
  };

  const deleteTopic = async (id: string) => {
    try {
      await fetch(`/api/topic-bank/${id}`, { method: "DELETE" });
      await loadTopics();
    } catch {}
  };

  const filtered = filter === "all" ? topics : topics.filter(t => t.status === filter);

  return (
    <Card>
      <CardTitle className="flex items-center justify-between">
        <span>Topic Bank</span>
        <Button onClick={mineTopic} disabled={mining} size="sm">
          {mining ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Mining...</>
          ) : (
            <><Pickaxe className="h-4 w-4 mr-2" /> Mine New Topics</>
          )}
        </Button>
      </CardTitle>
      <CardContent className="mt-4 space-y-4">
        {error && <p className="text-sm text-red-400">{error}</p>}

        {/* Filter tabs */}
        <div className="flex gap-1 flex-wrap">
          {STATUS_FILTERS.map(f => (
            <Button
              key={f.value}
              variant={filter === f.value ? "primary" : "ghost"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setFilter(f.value)}
            >
              {f.label}
              {f.value !== "all" && (
                <span className="ml-1 opacity-60">
                  ({topics.filter(t => t.status === f.value).length})
                </span>
              )}
            </Button>
          ))}
        </div>

        {/* Topic list */}
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            {topics.length === 0
              ? "No topics yet. Click 'Mine New Topics' to discover viral ideas."
              : "No topics match this filter."}
          </p>
        ) : (
          <div className="space-y-2">
            {filtered.map(topic => (
              <div
                key={topic.id}
                className="flex items-start gap-3 p-3 rounded-lg border border-muted-foreground/10 hover:bg-muted/30 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm truncate">{topic.title}</span>
                    <Badge variant={interestVariant(topic.estimated_interest)} className="text-[10px] shrink-0">
                      {topic.estimated_interest}
                    </Badge>
                    <Badge variant={statusVariant(topic.status)} className="text-[10px] shrink-0">
                      {topic.status.replace("_", " ")}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{topic.angle}</p>
                  {topic.keywords?.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {topic.keywords.map((kw, i) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 bg-muted rounded">{kw}</span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {topic.status === "available" && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => window.location.href = `/projects/new?topic_bank_id=${topic.id}&profile_id=${profileId}`}
                      >
                        <Play className="h-3 w-3 mr-1" /> Produce
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground"
                        title="Save for later"
                        onClick={() => updateStatus(topic.id, "icebox")}
                      >
                        <Snowflake className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground"
                        title="Reject"
                        onClick={() => updateStatus(topic.id, "rejected")}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                  {topic.status === "in_production" && topic.project_id && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => window.location.href = `/projects/${topic.project_id}`}
                    >
                      View Project
                    </Button>
                  )}
                  {topic.status === "produced" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => updateStatus(topic.id, "published")}
                    >
                      Mark Published
                    </Button>
                  )}
                  {(topic.status === "archived" || topic.status === "icebox" || topic.status === "rejected") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => updateStatus(topic.id, "available")}
                    >
                      <RotateCcw className="h-3 w-3 mr-1" /> Restore
                    </Button>
                  )}
                  {(topic.status === "available" || topic.status === "archived" || topic.status === "icebox" || topic.status === "rejected") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-red-400"
                      onClick={() => deleteTopic(topic.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {topics.length} topic{topics.length !== 1 ? "s" : ""} in bank
        </p>
      </CardContent>
    </Card>
  );
}
