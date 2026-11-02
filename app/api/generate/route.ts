import {
  createClient as createSupabase,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth";
import { isId } from "@/lib/validation";
import {
  loadConfiguration,
  buildStepPrompt,
} from "@/lib/generation/configuration";
import { parseGeminiResponse } from "@/lib/generation/parse";
export const maxDuration = 120;
export async function POST(request: Request) {
  let requestId: string | undefined;
  let log: SupabaseClient | undefined;
  try {
    const { supabase, user } = await requireAdmin(request);
    const key = process.env.GEMINI_API_KEY;
    const secret =
      process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key || !secret)
      throw new Error(
        "Generation needs GEMINI_API_KEY and a server-only Supabase secret key.",
      );
    if (Number(request.headers.get("content-length")) > 4 * 1024 * 1024)
      throw new Error("Use an image smaller than 3 MB.");
    const form = await request.formData();
    const chainId = form.get("chainId"),
      input = form.get("context"),
      file = form.get("image");
    if (!isId(chainId) || typeof input !== "string" || input.length > 4000)
      throw new Error("Choose a chain and use context up to 4,000 characters.");
    const config = await loadConfiguration(supabase, chainId);
    let image: { base64: string; mimeType: string } | undefined,
      imageId: string | undefined;
    if (file instanceof File && file.size) {
      if (
        file.size > 3 * 1024 * 1024 ||
        !["image/jpeg", "image/png", "image/webp"].includes(file.type)
      )
        throw new Error("Upload a JPG, PNG, or WebP smaller than 3 MB.");
      const bytes = Buffer.from(await file.arrayBuffer());
      const valid =
        file.type === "image/jpeg"
          ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : file.type === "image/png"
            ? bytes
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : bytes.subarray(0, 4).toString() === "RIFF" &&
              bytes.subarray(8, 12).toString() === "WEBP";
      if (!valid)
        throw new Error("The image contents do not match its format.");
      image = { base64: bytes.toString("base64"), mimeType: file.type };
    }
    if (config.steps.some((s) => s.include_image) && !image)
      throw new Error("This chain has image steps. Upload an image to run it.");
    // Privileged client is created only after authentication and live superadmin authorization.
    log = createSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL!, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Limit overlapping provider work per account.
    const { count, error: runningError } = await log
      .from("generation_requests")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "running")
      .gte("started_at", new Date(Date.now() - 125000).toISOString());
    if (runningError || (count ?? 0) > 0)
      throw new Error(
        "A generation is already running for your account. Wait for it to finish.",
      );
    const started = new Date().toISOString();
    const { data: run, error } = await log
      .from("generation_requests")
      .insert({
        user_id: user.id,
        prompt_chain_id: chainId,
        user_context: input || null,
        status: "running",
        started_at: started,
        configuration_snapshot: { ...config, source: "prompt-studio" },
      })
      .select("id")
      .single();
    if (error || !run) throw new Error("Could not start generation.");
    requestId = run.id;
    if (image) {
      const path = `${user.id}/studio-${requestId}.${image.mimeType.split("/")[1]}`;
      const { error: uploadError } = await log.storage
        .from("generations")
        .upload(path, Buffer.from(image.base64, "base64"), {
          contentType: image.mimeType,
          upsert: false,
        });
      if (uploadError) throw new Error("Could not save the input image.");
      const saved = await log
        .from("images")
        .insert({
          uploaded_by: user.id,
          storage_bucket: "generations",
          storage_path: path,
          mime_type: image.mimeType,
          size_bytes: Buffer.byteLength(image.base64, "base64"),
          original_filename: file instanceof File ? file.name : null,
        })
        .select("id")
        .single();
      if (saved.error) throw new Error("Could not save image metadata.");
      imageId = saved.data.id;
      const linked = await log
        .from("generation_requests")
        .update({ image_id: imageId })
        .eq("id", requestId!);
      if (linked.error)
        throw new Error("Could not link the image to this run.");
    }
    let community = { liked: [] as string[], disliked: [] as string[] };
    if (config.steps.some((s) => s.use_community_examples)) {
      const [g, v] = await Promise.all([
        supabase
          .from("generations")
          .select("id,caption")
          .order("created_at", { ascending: false })
          .limit(200),
        supabase.from("votes").select("generation_id,vote_type").limit(10000),
      ]);
      if (g.error || v.error)
        throw new Error("Could not load community examples.");
      const scored = (g.data || []).map((x) => ({
        ...x,
        score: (v.data || [])
          .filter((y) => y.generation_id === x.id)
          .reduce((n, y) => n + (y.vote_type === "up" ? 1 : -1), 0),
      }));
      community = {
        liked: scored
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map((x) => x.caption),
        disliked: scored
          .filter((x) => x.score < 0)
          .sort((a, b) => a.score - b.score)
          .slice(0, 3)
          .map((x) => x.caption),
      };
    }
    let previous = "";
    const deadline = AbortSignal.timeout(100000);
    for (const step of config.steps) {
      const prompt = buildStepPrompt(step, config, community, input, previous);
      const model = step.model!,
        callStart = Date.now();
      let parsed = parseGeminiResponse(null),
        failure: string | null = null,
        status: number | null = null;
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.model_identifier)}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": key,
            },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { text: prompt },
                    ...(step.include_image && image
                      ? [
                          {
                            inline_data: {
                              mime_type: image.mimeType,
                              data: image.base64,
                            },
                          },
                        ]
                      : []),
                  ],
                },
              ],
              generationConfig: { maxOutputTokens: 2048 },
            }),
            signal: AbortSignal.any([deadline, AbortSignal.timeout(45000)]),
          },
        );
        status = response.status;
        if (!response.ok) failure = `Model returned HTTP ${status}.`;
        else {
          parsed = parseGeminiResponse(await response.json());
          if (!parsed.caption || parsed.caption.length > 16000)
            failure = "The model returned an empty or oversized response.";
        }
      } catch {
        failure = "The model request timed out or could not be read.";
      }
      const saved = await log
        .from("llm_responses")
        .insert({
          generation_request_id: requestId,
          prompt_chain_step_id: step.id,
          llm_model_id: model.id,
          step_position: step.position,
          attempt: 1,
          provider_slug: model.provider!.slug,
          model_identifier: model.model_identifier,
          prompt_text: prompt,
          response_text: failure ? null : parsed.caption,
          status: failure ? "failed" : "succeeded",
          http_status: status,
          error_message: failure,
          input_tokens: parsed.inputTokens,
          output_tokens: parsed.outputTokens,
          latency_ms: Date.now() - callStart,
          response_metadata: parsed.metadata,
        });
      if (saved.error) throw new Error("Could not save the step response.");
      if (failure) throw new Error(`Step ${step.position}: ${failure}`);
      previous = parsed.caption;
    }
    const finished = await log
      .from("generation_requests")
      .update({ status: "succeeded", completed_at: new Date().toISOString() })
      .eq("id", requestId!);
    if (finished.error) throw new Error("Could not finalize generation.");
    return Response.json({ requestId, output: previous });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Generation failed.";
    if (requestId && log) {
      const result = await log
        .from("generation_requests")
        .update({
          status: "failed",
          error_message: message,
          completed_at: new Date().toISOString(),
        })
        .eq("id", requestId!);
      if (result.error)
        console.error("Could not finalize failed generation", requestId);
    }
    return Response.json({ error: message, requestId }, { status: 400 });
  }
}
