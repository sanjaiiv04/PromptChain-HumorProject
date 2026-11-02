export type Chain = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  updated_at: string;
  created_at: string;
  prompt_chain_steps: { count: number }[];
};
export type Step = {
  id: string;
  prompt_chain_id: string;
  name: string;
  position: number;
  prompt_template: string;
  llm_model_id: string;
  include_image: boolean;
  include_user_context: boolean;
  use_terms: boolean;
  use_community_examples: boolean;
  use_curated_examples: boolean;
  updated_at: string;
};
export type Model = {
  id: string;
  name: string;
  model_identifier: string;
  supports_images: boolean;
  is_active: boolean;
  provider: { slug: string; is_active: boolean } | null;
};
export type Run = {
  id: string;
  prompt_chain_id: string | null;
  status: string;
  created_at: string;
  error_message: string | null;
  user_context: string | null;
  image_id: string | null;
  configuration_snapshot: {
    chain?: { name?: string };
    steps?: { name: string; position: number }[];
  };
  llm_responses: {
    id: string;
    step_position: number;
    response_text: string | null;
    error_message: string | null;
    status: string;
    model_identifier: string;
    latency_ms: number | null;
  }[];
  imageUrl?: string;
};
