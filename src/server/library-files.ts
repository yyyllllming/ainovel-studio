import "./server-only.ts";

import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type {
  AuthorCardRecord,
  AuthorBookCardRecord,
  AuthorCardVersionRecord,
  AuthorTextImportRecord,
  IdeaRecord,
  IdeaWorkshopMessage,
  IdeaWorkshopStateRecord,
} from "./types.ts";
import { rewriteIndexedJsonDirectory } from "./foundation/foundation-file-sync.ts";
import { ensureDir, writeTextFile } from "./utils.ts";
import { authorCardDir, withinAuthorCard, withinIdea, ideaDir } from "./paths.ts";

async function writeJson(path: string, value: unknown) {
  await writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function ensureIdeaLayout(ideaId: string) {
  const base = ideaDir(ideaId);
  await Promise.all([
    ensureDir(base),
    ensureDir(withinIdea(ideaId, "messages")),
  ]);
  const marker = withinIdea(ideaId, ".keep");
  if (!existsSync(marker)) {
    await writeFile(marker, "", "utf8");
  }
}

export async function writeIdeaMirror(input: {
  idea: IdeaRecord;
  state: IdeaWorkshopStateRecord | null;
  messages: IdeaWorkshopMessage[];
}) {
  await ensureIdeaLayout(input.idea.id);
  await Promise.all([
    writeJson(withinIdea(input.idea.id, "idea.json"), input.idea),
    writeJson(withinIdea(input.idea.id, "draft.json"), input.state?.draft ?? null),
    writeJson(withinIdea(input.idea.id, "messages.json"), input.messages),
  ]);
}

export async function ensureAuthorCardLayout(authorCardId: string) {
  const base = authorCardDir(authorCardId);
  await Promise.all([
    ensureDir(base),
    ensureDir(withinAuthorCard(authorCardId, "versions")),
    ensureDir(withinAuthorCard(authorCardId, "imports")),
    ensureDir(withinAuthorCard(authorCardId, "imports", "raw")),
    ensureDir(withinAuthorCard(authorCardId, "imports", "normalized")),
    ensureDir(withinAuthorCard(authorCardId, "book-cards")),
  ]);
}

export async function writeAuthorCardMirror(input: {
  card: AuthorCardRecord;
  versions: AuthorCardVersionRecord[];
  bookCards?: AuthorBookCardRecord[];
  imports?: AuthorTextImportRecord[];
}) {
  await ensureAuthorCardLayout(input.card.id);
  await Promise.all([
    writeJson(withinAuthorCard(input.card.id, "author-card.json"), input.card),
    writeJson(withinAuthorCard(input.card.id, "versions.json"), input.versions),
    writeJson(withinAuthorCard(input.card.id, "book-cards.json"), input.bookCards ?? []),
    writeJson(withinAuthorCard(input.card.id, "imports.json"), input.imports ?? []),
    ...input.versions.map((version) =>
      writeJson(
        withinAuthorCard(
          input.card.id,
          "versions",
          `version_${String(version.version).padStart(3, "0")}.json`,
        ),
        version,
      )
    ),
    rewriteIndexedJsonDirectory({
      dir: withinAuthorCard(input.card.id, "book-cards"),
      entries: input.bookCards ?? [],
      fileName: (bookCard) => `${bookCard.id}.json`,
    }),
  ]);
}
