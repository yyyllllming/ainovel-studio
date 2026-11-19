import {
  applyFoundationStructuredSuggestion,
  dismissFoundationStructuredSuggestion,
  generateFoundationStructuredSuggestions,
} from "@/server/foundation/foundation-workshop";
import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import {
  foundationStructuredSuggestionActionSchema,
  projectIdSchema,
} from "@/server/validation";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    projectIdSchema.parse(projectId);
    const payload = foundationStructuredSuggestionActionSchema.parse(await readJsonBody(request));

    const snapshot = payload.action === "apply"
      ? applyFoundationStructuredSuggestion(projectId, payload.suggestionId!)
      : payload.action === "dismiss"
        ? dismissFoundationStructuredSuggestion(projectId, payload.suggestionId!)
        : generateFoundationStructuredSuggestions(projectId);

    return jsonOk(snapshot);
  } catch (error) {
    return jsonFromError(error, "处理结构化建议失败", 400);
  }
}
