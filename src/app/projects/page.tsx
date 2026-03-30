"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, FolderOpen, Clock, DollarSign, Loader2 } from "lucide-react";
import type { Project, ChannelProfile } from "@/types";

const statusVariant: Record<string, "default" | "success" | "warning" | "destructive"> = {
  draft: "default",
  researching: "default",
  scripting: "default",
  producing: "warning",
  assembling: "warning",
  completed: "success",
  failed: "destructive",
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [profiles, setProfiles] = useState<ChannelProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [pRes, prRes] = await Promise.all([
          fetch("/api/projects"),
          fetch("/api/profiles"),
        ]);
        const pData = await pRes.json();
        const prData = await prRes.json();
        if (pData.success) setProjects(pData.data);
        if (prData.success) setProfiles(prData.data);
      } catch {}
      setLoading(false);
    };
    load();
  }, []);

  const getProfileName = (id: string) =>
    profiles.find((p) => p.id === id)?.name || "Unknown";

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-muted-foreground mt-1">
            All your video productions
          </p>
        </div>
        <Link href="/projects/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            New Production
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading projects...
        </div>
      ) : projects.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <FolderOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h3 className="text-lg font-medium mb-2">No projects yet</h3>
            <p className="text-muted-foreground mb-4">
              Start your first video production to see it here.
            </p>
            <Link href="/projects/new">
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Start First Production
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {projects.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                <CardContent className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="font-semibold">{project.title}</h3>
                      <Badge variant={statusVariant[project.status] || "default"}>
                        {project.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                      <span>{getProfileName(project.profile_id)}</span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(project.created_at).toLocaleDateString()}
                      </span>
                      {project.total_cost_cents > 0 && (
                        <span className="flex items-center gap-1">
                          <DollarSign className="h-3 w-3" />$
                          {(project.total_cost_cents / 100).toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
