export const isId = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function chainValues(body: Record<string, unknown>) {
  if (
    typeof body.name !== "string" ||
    !body.name.trim() ||
    body.name.trim().length > 120
  )
    throw new Error("Enter a chain name of 1–120 characters.");
  if (
    typeof body.slug !== "string" ||
    !/^[a-z][a-z0-9_-]{0,79}$/.test(body.slug)
  )
    throw new Error(
      "Use a slug starting with a letter, followed by lowercase letters, numbers, - or _.",
    );
  if (
    typeof body.description !== "string" ||
    body.description.length > 2000 ||
    typeof body.is_active !== "boolean"
  )
    throw new Error("Check the description and status.");
  return {
    name: body.name.trim(),
    slug: body.slug,
    description: body.description.trim() || null,
    is_active: body.is_active,
  };
}
