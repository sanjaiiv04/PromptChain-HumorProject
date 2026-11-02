type JsonRecord = Record<string, unknown>;
const object = (value: unknown): JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
const tokenCount = (value: unknown) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= 2_147_483_647
    ? value
    : null;
const shortText = (value: unknown) =>
  typeof value === "string" ? value.slice(0, 200) : null;

export function parseGeminiResponse(raw: unknown) {
  const body = object(raw);
  const candidate = object(
    Array.isArray(body.candidates) ? body.candidates[0] : undefined,
  );
  const content = object(candidate.content);
  const parts: unknown[] = Array.isArray(content.parts) ? content.parts : [];
  const caption = parts
    .map(object)
    .filter((part) => part.thought !== true)
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
  const usage = object(body.usageMetadata);
  return {
    caption,
    inputTokens: tokenCount(usage.promptTokenCount),
    outputTokens: tokenCount(usage.candidatesTokenCount),
    metadata: {
      finish_reason: shortText(candidate.finishReason),
      model_version: shortText(body.modelVersion),
      response_id: shortText(body.responseId),
      block_reason: shortText(object(body.promptFeedback).blockReason),
    },
  };
}
