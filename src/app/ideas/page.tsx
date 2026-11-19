import { IdeasClient } from "@/components/ideas-client";
import { listIdeaSummaries } from "@/server/services/idea.service";

export default function IdeasPage() {
  return <IdeasClient initialIdeas={{ ideas: listIdeaSummaries() }} />;
}
