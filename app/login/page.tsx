"use client";
import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
function Login() {
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signIn() {
    setBusy(true);
    setError("");
    try {
      const { error } = await createClient().auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${location.origin}/auth/callback`,
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) throw error;
    } catch {
      setError("Could not start sign in. Please try again.");
      setBusy(false);
    }
  }
  return (
    <div className="login">
      <div className="login-art" aria-hidden="true">
        <span className="art-step yellow">01 →</span>
        <span className="art-step lavender">02 ✳</span>
        <span className="art-step green">03 ↗</span>
      </div>
      <section className="panel login-card">
        <span className="eyebrow">CAPRATE</span>
        <h1>Prompt Studio</h1>
        <p className="muted">
          Sign in with a superadmin account to manage prompt chains.
        </p>
        <div className="rule" />
        <span className="badge lavender">SUPERADMIN ACCESS</span>
        {(error || params.get("error")) && (
          <p role="alert" className="notice error">
            {error ||
              (params.get("error") === "unauthorized"
                ? "This account does not have superadmin access. Choose an authorized account."
                : "Sign in could not be completed. Please try again.")}
          </p>
        )}
        <button className="button yellow full" onClick={signIn} disabled={busy}>
          {busy ? "Opening Google…" : "Continue with Google ↗"}
        </button>
        <p className="fine">
          Sign in with your existing CapRate superadmin account.
        </p>
      </section>
    </div>
  );
}
export default function Page() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}
