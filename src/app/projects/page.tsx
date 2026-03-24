import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, FolderOpen, Clock, DollarSign } from "lucide-react";
import { getAll } from "@/lib/store";
import type { Project, ChannelProfile } from "@/types";

export const dynamic = "force-dynamic";

const statusVariant: Record<string, "default" | "success" | "warning" | "destructive"> = {
  draft: "default",
  researching: "default",
  scripting: "default",
  producing: "warning",
  assembling: "warning",
  completed: "success",
  failed: "destructive",
};

export default async function ProjectsPage() {
  const projects = await getAll<Project>("projects");
  const profiles = await getAll<ChannelProfile>("profiles");

  const getProfileName = (id: string) =>
    profiles.find((p) => p.id === id)?.name || "Unknown";

  const sorted = [...projects].reverse();

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

      {sorted.length === 0 ? (
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
          {sorted.map((project) => (
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
