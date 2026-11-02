import { requireAdmin } from "@/lib/auth";
import { isId } from "@/lib/validation";
export async function GET(request: Request) {
  try {
    const { supabase } = await requireAdmin(request);
    const url = new URL(request.url),
      id = url.searchParams.get("chainId");
    if (id && !isId(id)) throw new Error("Invalid chain ID.");
    const page = Math.max(
      1,
      Math.min(10000, Number(url.searchParams.get("page")) || 1),
    );
    let query = supabase
      .from("generation_requests")
      .select(
        "id,prompt_chain_id,status,created_at,error_message,user_context,image_id,configuration_snapshot,llm_responses(id,step_position,response_text,error_message,status,model_identifier,latency_ms)",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .order("id")
      .range((page - 1) * 12, page * 12 - 1);
    if (id) query = query.eq("prompt_chain_id", id);
    const { data, error, count } = await query;
    if (error) throw new Error("Could not load generation history.");
    const runs = await Promise.all(
      (data || []).map(async (run) => {
        let imageUrl: string | undefined;
        if (run.image_id) {
          const { data: image } = await supabase
            .from("images")
            .select("storage_bucket,storage_path")
            .eq("id", run.image_id)
            .maybeSingle();
          if (image) {
            if (image.storage_bucket === "generations") {
              imageUrl = supabase.storage
                .from("generations")
                .getPublicUrl(image.storage_path).data.publicUrl;
            } else {
              const signed = await supabase.storage
                .from(image.storage_bucket)
                .createSignedUrl(image.storage_path, 3600);
              imageUrl = signed.data?.signedUrl;
            }
          }
        }
        return { ...run, imageUrl };
      }),
    );
    return Response.json(
      { runs, count },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Could not load history.",
      },
      { status: 400 },
    );
  }
}
