import { DashboardClient } from "@/components/dashboard-client";
import { listProjectSummaries } from "@/server/services/project.service";
import { listPublicProfiles } from "@/server/services/settings.service";

export default async function ProjectsPage() {
  const [profiles, projects] = await Promise.all([
    listPublicProfiles(),
    listProjectSummaries(),
  ]);

  return (
    <DashboardClient
      initialProfiles={{ profiles }}
      initialProjects={{ projects }}
    />
  );
}
