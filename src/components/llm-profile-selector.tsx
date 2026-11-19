"use client";

interface LlmProfileSelectorProps {
  sectionTitle?: string;
  title: string;
  description: string;
  usableProfiles: Array<{ id: string; name: string; defaultModel: string }>;
  selectedProfileId: string;
  profilesLoading: boolean;
  onProfileChange: (value: string) => void;
  className?: string;
}

export function LlmProfileSelector({
  sectionTitle = "LLM Profile",
  title,
  description,
  usableProfiles,
  selectedProfileId,
  profilesLoading,
  onProfileChange,
  className = "workspace-panel p-4",
}: LlmProfileSelectorProps) {
  return (
    <section className={className}>
      <div>
        <p className="section-title">{sectionTitle}</p>
        <h2 className="mt-2 text-lg font-semibold text-[var(--ink)]">{title}</h2>
        <p className="mt-2 text-sm leading-7 text-[var(--ink-soft)]">{description}</p>
      </div>
      <label className="mt-3 grid gap-2 text-sm text-[var(--ink-soft)]">
        <span>LLM Profile</span>
        <select
          className="form-input"
          aria-label="LLM Profile"
          value={selectedProfileId}
          disabled={!usableProfiles.length || profilesLoading}
          onChange={(event) => onProfileChange(event.target.value)}
        >
          {usableProfiles.length ? usableProfiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name} ({profile.defaultModel})
            </option>
          )) : (
            <option value="">
              {profilesLoading ? "正在读取可用 Profile…" : "没有可用的 Profile"}
            </option>
          )}
        </select>
      </label>
      {!usableProfiles.length && !profilesLoading ? (
        <p className="mt-3 text-sm text-[var(--danger)]">
          请先在设置页启用至少一个带 API Key 和默认模型的 LLM Profile。
        </p>
      ) : null}
    </section>
  );
}
