import "server-only";
import { createClient } from "@/lib/supabase/server";
export async function requireAdmin(request?: Request) {
  if (request && !["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin)
      throw new Error("Cross-origin requests are not allowed.");
  }
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Sign in to continue.");
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_superadmin")
    .eq("id", user.id)
    .single();
  if (profileError || profile?.is_superadmin !== true)
    throw new Error("Superadmin access required.");
  return { supabase, user };
}
