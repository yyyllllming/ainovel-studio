import "./server-only.ts";

/**
 * @deprecated All callers have been migrated to focused repository modules.
 * This barrel is kept only for type re-exports.
 */
export type {
  AuthorCardRecord,
  AuthorCardVersionRecord,
  ChapterInvalidationRecord,
  ChapterPlanRecord,
  ChapterVersionRecord,
  FoundationWorkshopStateRecord,
  IdeaRecord,
  ProjectRecord,
  ReviewReportRecord,
  RunStateRecord,
} from "./repositories/shared.ts";
