"use client";

import { AuthorSubmissionWorkbench } from "./author-submission-workbench";

export function AuthorSubmissionsClient({ projectId }: { projectId: string }) {
  return <AuthorSubmissionWorkbench projectId={projectId} />;
}
