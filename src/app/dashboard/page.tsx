import Link from "next/link";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Zap,
  FolderOpen,
  Users,
  DollarSign,
  ArrowRight,
  Clock,
} from "lucide-react";
import { getAll } from "@/lib/store";
import type { Project, ChannelProfile } from "@/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const projects = await getAll<Project>("projects");
  const profiles = await getAll<ChannelProfile>("profiles");

  const completedCount = projects.filter((p) => p.status === "completed").length;
  const totalCost = projects.reduce((sum, p) => sum + (p.total_cost_cents || 0), 0);
  const recentProjects = projects.slice(-5).reverse();

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Your video production command center
          </p>
        </div>
        <Link href="/projects/new">
          <Button size="lg">
            <Zap className="h-4 w-4 mr-2" />
            New Production
          </Button>
        </Link>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/15">
              <FolderOpen className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{projects.length}</p>
              <p className="text-sm text-muted-foreground">Total Projects</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-success/15">
              <Zap className="h-6 w-6 text-success" />
            </div>
            <div>
              <p className="text-2xl font-bold">{completedCount}</p>
              <p className="text-sm text-muted-foreground">Completed</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-purple-500/15">
              <Users className="h-6 w-6 text-purple-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{profiles.length}</p>
              <p className="text-sm text-muted-foreground">Channels</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-warning/15">
              <DollarSign className="h-6 w-6 text-warning" />
            </div>
            <div>
              <p className="text-2xl font-bold">${(totalCost / 100).toFixed(2)}</p>
              <p className="text-sm text-muted-foreground">Total Spend</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions + Recent Projects */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quick Actions */}
        <Card className="lg:col-span-1">
          <CardTitle className="mb-4">Quick Actions</CardTitle>
          <CardContent className="space-y-2">
            <Link href="/projects/new" className="block">
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted hover:bg-muted/80 transition-colors">
                <div className="flex items-center gap-3">
                  <Zap className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">Start New Production</span>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </Link>
            <Link href="/profiles/new" className="block">
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted hover:bg-muted/80 transition-colors">
                <div className="flex items-center gap-3">
                  <Users className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">Create Channel Profile</span>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </Link>
            <Link href="/settings" className="block">
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted hover:bg-muted/80 transition-colors">
                <div className="flex items-center gap-3">
                  <DollarSign className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">Configure API Keys</span>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </Link>
          </CardContent>
        </Card>

        {/* Recent Projects */}
        <Card className="lg:col-span-2">
          <CardTitle className="mb-4">Recent Projects</CardTitle>
          <CardContent>
            {recentProjects.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No projects yet. Start your first production!</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentProjects.map((project) => (
                  <Link key={project.id} href={`/projects/${project.id}`}>
                    <div className="flex items-center justify-between p-3 rounded-lg bg-muted hover:bg-muted/80 transition-colors">
                      <div>
                        <p className="text-sm font-medium">{project.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {project.topic}
                        </p>
                      </div>
                      <Badge
                        variant={
                          project.status === "completed"
                            ? "success"
                            : project.status === "failed"
                            ? "destructive"
                            : "default"
                        }
                      >
                        {project.status}
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
