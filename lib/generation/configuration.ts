import type { SupabaseClient } from "@supabase/supabase-js";

export class ConfigurationError extends Error {}
export interface Step {
  id: string;
  prompt_chain_id: string;
  position: number;
  name: string;
  prompt_template: string;
  include_image: boolean;
  use_community_examples: boolean;
  use_curated_examples: boolean;
  use_terms: boolean;
  include_user_context: boolean;
  model: {
    id: string;
    name: string;
    model_identifier: string;
    is_active: boolean;
    supports_images: boolean;
    provider: {
      id: string;
      slug: string;
      name: string;
      is_active: boolean;
    } | null;
  } | null;
}
interface Mix {
  id: string;
  weight: number | string;
  is_enabled: boolean;
  chain: { id: string; name: string; slug: string; is_active: boolean } | null;
}
export interface Term {
  id: string;
  term: string;
  definition: string;
  example: string | null;
}
export interface Example {
  id: string;
  caption: string;
  context: string | null;
  sentiment: string;
  image_id: string | null;
  prompt_chain_id: string | null;
}
export interface Configuration {
  chain: NonNullable<Mix["chain"]>;
  mix: { id: string; weight: number };
  steps: Step[];
  terms: Term[];
  examples: Example[];
}
export const MAX_STEPS = 50;

// Exclude an entire chain if any step cannot run. Never silently skip a step.
export function selectChain(
  mix: Mix[],
  steps: Step[],
  random = Math.random,
): Omit<Configuration, "terms" | "examples"> {
  const candidates = mix.flatMap((entry) => {
    const chain = entry.chain;
    const weight = Number(entry.weight);
    const ordered = steps
      .filter((step) => step.prompt_chain_id === chain?.id)
      .sort((a, b) => a.position - b.position);
    if (
      !entry.is_enabled ||
      !chain?.is_active ||
      !Number.isFinite(weight) ||
      weight <= 0 ||
      !ordered.length ||
      ordered.length > MAX_STEPS ||
      new Set(ordered.map((s) => s.position)).size !== ordered.length ||
      ordered.some(
        (step) =>
          !Number.isInteger(step.position) ||
          step.position < 1 ||
          !step.prompt_template.trim() ||
          step.prompt_template.length > 12000 ||
          !step.model?.is_active ||
          !step.model.provider?.is_active ||
          step.model.provider.slug !== "google" ||
          !/^gemini-[a-zA-Z0-9._-]+$/.test(step.model.model_identifier) ||
          (step.include_image && !step.model.supports_images),
      )
    )
      return [];
    return [{ chain, mix: { id: entry.id, weight }, steps: ordered }];
  });
  const total = candidates.reduce(
    (sum, candidate) => sum + candidate.mix.weight,
    0,
  );
  if (!candidates.length || !Number.isFinite(total))
    throw new ConfigurationError(
      "No executable prompt chain is enabled. Check chain mix, steps, models, and providers.",
    );
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
    throw new ConfigurationError("Invalid chain selection.");
  let target = sample * total;
  for (const candidate of candidates) {
    target -= candidate.mix.weight;
    if (target < 0) return candidate;
  }
  return candidates[candidates.length - 1];
}

export async function loadConfiguration(
  client: SupabaseClient,
  chainId: string,
): Promise<Configuration> {
  const { data: chain, error: chainError } = await client
    .from("prompt_chains")
    .select("id,name,slug,is_active")
    .eq("id", chainId)
    .single();
  if (chainError || !chain?.is_active)
    throw new ConfigurationError("Choose an active prompt chain.");
  const { data: steps, error } = await client
    .from("prompt_chain_steps")
    .select(
      "id,prompt_chain_id,position,name,prompt_template,include_image,use_community_examples,use_curated_examples,use_terms,include_user_context,model:llm_models(id,name,model_identifier,supports_images,is_active,provider:llm_providers(id,name,slug,is_active))",
    )
    .eq("prompt_chain_id", chainId)
    .order("position")
    .limit(51)
    .overrideTypes<Step[], { merge: false }>();
  if (error || !steps) throw new ConfigurationError("Could not load steps.");
  const selected = selectChain(
    [{ id: chainId, weight: 1, is_enabled: true, chain }],
    steps,
    () => 0,
  );
  let terms: Term[] = [],
    examples: Example[] = [];
  if (steps.some((s) => s.use_terms)) {
    const r = await client
      .from("terms")
      .select("id,term,definition,example")
      .eq("is_active", true)
      .order("term")
      .limit(20);
    if (r.error) throw new ConfigurationError("Could not load terms.");
    terms = r.data ?? [];
  }
  if (steps.some((s) => s.use_curated_examples)) {
    const r = await client
      .from("ai_generation_examples")
      .select("id,caption,context,sentiment,image_id,prompt_chain_id")
      .eq("is_active", true)
      .or(`prompt_chain_id.is.null,prompt_chain_id.eq.${chainId}`)
      .order("created_at", { ascending: false })
      .limit(10);
    if (r.error) throw new ConfigurationError("Could not load examples.");
    examples = r.data ?? [];
  }
  return { ...selected, terms, examples };
}

export function buildStepPrompt(
  step: Step,
  config: Configuration,
  community: { liked: string[]; disliked: string[] },
  userPrompt: string,
  previous: string,
) {
  let prompt = step.prompt_template;
  if (step.use_community_examples) {
    if (community.liked.length)
      prompt += `\n\nCaptions the community rated highly (match their tone, length and humor):\n${community.liked.map((caption) => `- ${caption}`).join("\n")}`;
    if (community.disliked.length)
      prompt += `\n\nCaptions the community disliked (avoid this style):\n${community.disliked.map((caption) => `- ${caption}`).join("\n")}`;
  }
  if (step.use_terms && config.terms.length)
    prompt += `\n\nVocabulary/context:\n${config.terms.map((term) => `- ${term.term}: ${term.definition}${term.example ? ` Example: ${term.example}` : ""}`).join("\n")}`;
  if (step.use_curated_examples && config.examples.length)
    prompt += `\n\nCurated caption examples (positive: emulate; negative: avoid):\n${config.examples.map((example) => `- ${example.sentiment}: ${example.caption}${example.context ? ` Context: ${example.context}` : ""}`).join("\n")}`;
  if (step.include_user_context && userPrompt)
    prompt += `\n\nStyle/context from the user: ${userPrompt}`;
  if (previous) prompt += `\n\nPrevious step output:\n${previous}`;
  if (prompt.length > 64000)
    throw new ConfigurationError(
      "The configured prompt exceeds 64000 characters. Reduce terms, examples, or step text.",
    );
  return prompt;
}
