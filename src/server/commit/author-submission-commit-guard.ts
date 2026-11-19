import "../server-only.ts";

import { createChapterSessionGuard } from "./chapter-session-guard.ts";

export function assertAuthorSubmissionMayCommit(projectId: string) {
  createChapterSessionGuard().assertNoOpenSession(projectId, "提交作者稿");
}
