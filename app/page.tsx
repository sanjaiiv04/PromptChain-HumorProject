import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import Studio from "@/components/studio";
export const dynamic = "force-dynamic";
export default async function Page() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
    return (
      <main className="login">
        <section className="panel">
          <h1>Set up Prompt Studio</h1>
          <p>
            Add your Supabase URL and public key to .env.local, then restart the
            server.
          </p>
        </section>
      </main>
    );
  try {
    await requireAdmin();
  } catch {
    redirect("/login");
  }
  return <Studio />;
}
