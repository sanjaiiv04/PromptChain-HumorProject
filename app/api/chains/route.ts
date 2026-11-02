import { requireAdmin } from "@/lib/auth";
import { chainValues, isId } from "@/lib/validation";
import type { Step } from "@/lib/types";
export const dynamic = "force-dynamic";
function fail(error: unknown, status = 400) {
  return Response.json(
    { error: error instanceof Error ? error.message : "Request failed." },
    { status },
  );
}
export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireAdmin(request);
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (id && !isId(id)) throw new Error("Invalid chain ID.");
    if (id) {
      const [chain, steps, models] = await Promise.all([
        supabase.from("prompt_chains").select("*").eq("id", id).single(),
        supabase
          .from("prompt_chain_steps")
          .select("*")
          .eq("prompt_chain_id", id)
          .order("position"),
        supabase
          .from("llm_models")
          .select(
            "id,name,model_identifier,supports_images,is_active,provider:llm_providers(slug,is_active)",
          )
          .eq("is_active", true),
      ]);
      if (chain.error || steps.error || models.error)
        throw new Error("Could not load this chain.");
      return Response.json(
        { chain: chain.data, steps: steps.data, models: models.data },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const page = Math.max(
      1,
      Math.min(10000, Number(url.searchParams.get("page")) || 1),
    );
    const q =
      url.searchParams
        .get("q")
        ?.slice(0, 120)
        .replace(/[%_\\]/g, "") || "";
    let query = supabase
      .from("prompt_chains")
      .select("*,prompt_chain_steps(count)", { count: "exact" })
      .order("updated_at", { ascending: false })
      .order("id")
      .range((page - 1) * 24, page * 24 - 1);
    if (q) query = query.ilike("name", `%${q}%`);
    const { data, error, count } = await query;
    if (error) throw new Error("Could not load prompt chains.");
    return Response.json(
      { chains: data, count, email: user.email },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return fail(error);
  }
}
export async function POST(request: Request) {
  try {
    const { supabase } = await requireAdmin(request);
    const body = await request.json();
    const { data, error } = await supabase
      .from("prompt_chains")
      .insert(chainValues(body))
      .select()
      .single();
    if (error)
      throw new Error(
        error.code === "23505"
          ? "That slug already exists. Choose another."
          : "Could not create chain.",
      );
    return Response.json({ chain: data });
  } catch (error) {
    return fail(error);
  }
}
export async function PATCH(request: Request) {
  try {
    const { supabase } = await requireAdmin(request);
    const body = await request.json();
    if (!isId(body.id)) throw new Error("Invalid chain ID.");
    if (body.action === "steps") {
      if (
        !Array.isArray(body.expected) ||
        !Array.isArray(body.steps) ||
        body.steps.length > 50
      )
        throw new Error("Invalid steps.");
      for (const step of body.steps as Step[]) {
        if (
          !isId(step.id) ||
          !isId(step.llm_model_id) ||
          typeof step.name !== "string" ||
          typeof step.prompt_template !== "string" ||
          !step.name.trim() ||
          step.name.length > 120 ||
          !step.prompt_template.trim() ||
          step.prompt_template.length > 12000
        )
          throw new Error(
            "Each step needs a name, model, and prompt (up to 12,000 characters).",
          );
        for (const flag of [
          "include_image",
          "include_user_context",
          "use_terms",
          "use_community_examples",
          "use_curated_examples",
        ] as const)
          if (typeof step[flag] !== "boolean")
            throw new Error("Invalid step settings.");
      }
      const { error } = await supabase.rpc("studio_save_steps", {
        chain_id: body.id,
        expected: body.expected,
        steps: body.steps,
      });
      if (error) throw new Error(error.message);
      return Response.json({ ok: true });
    }
    if (typeof body.updated_at !== "string")
      throw new Error("Reload the chain before saving.");
    const { data, error } = await supabase
      .from("prompt_chains")
      .update(chainValues(body))
      .eq("id", body.id)
      .eq("updated_at", body.updated_at)
      .select()
      .maybeSingle();
    if (error)
      throw new Error(
        error.code === "23505"
          ? "That slug already exists."
          : "Could not update chain.",
      );
    if (!data)
      throw new Error(
        "This chain changed in another session. Reload before saving.",
      );
    return Response.json({ chain: data });
  } catch (error) {
    return fail(error);
  }
}
export async function DELETE(request: Request) {
  try {
    const { supabase } = await requireAdmin(request);
    const body = await request.json();
    if (!isId(body.id) || typeof body.updated_at !== "string")
      throw new Error("Invalid chain.");
    const { data, error } = await supabase
      .from("prompt_chains")
      .delete()
      .eq("id", body.id)
      .eq("updated_at", body.updated_at)
      .select("id")
      .maybeSingle();
    if (error)
      throw new Error(
        error.code === "23503"
          ? "This chain is used by generation examples. Remove those links in the admin panel first."
          : "Could not delete chain.",
      );
    if (!data)
      throw new Error(
        "This chain changed in another session. Reload before deleting.",
      );
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
