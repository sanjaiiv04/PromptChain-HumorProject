import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from("profiles")
          .select("is_superadmin")
          .eq("id", user.id)
          .single();
        if (data?.is_superadmin === true)
          return NextResponse.redirect(new URL("/", url.origin));
      }
      await supabase.auth.signOut();
      return NextResponse.redirect(
        new URL("/login?error=unauthorized", url.origin),
      );
    }
  }
  return NextResponse.redirect(new URL("/login?error=callback", url.origin));
}
