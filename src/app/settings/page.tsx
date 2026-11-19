import { SettingsClient } from "@/components/settings-client";
import { listPublicProfiles } from "@/server/services/settings.service";

export default async function SettingsPage() {
  const profiles = await listPublicProfiles();
  return <SettingsClient initialProfiles={{ profiles }} />;
}
