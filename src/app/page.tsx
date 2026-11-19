import { IdeasClient } from "@/components/ideas-client";
import { listIdeaSummaries } from "@/server/services/idea.service";

export default function HomePage() {
  return <IdeasClient initialIdeas={{ ideas: listIdeaSummaries() }} />;
}
