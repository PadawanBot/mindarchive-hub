import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Users, ArrowRight } from "lucide-react";
import { getAll } from "@/lib/store";
import type { ChannelProfile } from "@/types";

export const dynamic = "force-dynamic";

export default async function ProfilesPage() {
  const profiles = await getAll<ChannelProfile>("profiles");

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Channel Profiles</h1>
          <p className="text-muted-foreground mt-1">
            Manage your YouTube channel configurations
          </p>
        </div>
        <Link href="/profiles/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            New Channel
          </Button>
        </Link>
      </div>

      {profiles.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h3 className="text-lg font-medium mb-2">No channels yet</h3>
            <p className="text-muted-foreground mb-4">
              Create a channel profile to define your brand voice, niche, and production preferences.
            </p>
            <Link href="/profiles/new">
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Create Your First Channel
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {profiles.map((profile) => (
            <Link key={profile.id} href={`/profiles/${profile.id}`}>
              <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
                <CardContent>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold">{profile.name}</h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        {profile.niche || "No niche set"}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground mt-1" />
                  </div>
                  <div className="flex flex-wrap gap-2 mt-4">
                    <Badge variant="outline">{profile.llm_provider}</Badge>
                    <Badge variant="outline">{profile.image_provider}</Badge>
                    <Badge variant="outline">{profile.voice_provider}</Badge>
                  </div>
                  {profile.description && (
                    <p className="text-xs text-muted-foreground mt-3 line-clamp-2">
                      {profile.description}
                    </p>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
