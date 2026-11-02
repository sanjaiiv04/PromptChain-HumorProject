# CapRate Prompt Studio

A standalone Next.js app for building and running humor prompt chains against the **same Supabase project as CapRate Admin**. Uses the admin panel’s cream background, yellow/lavender/green accents, thick borders, and hard shadows, with a fixed light appearance. Typography matches the admin panel: Plus Jakarta Sans for body text and Outfit for headings, with a 30/18/14/12 px hierarchy. Decorative slogans and banners are omitted.

## Run locally

```sh
npm install
cp -n .env.example .env.local
npm run dev
```

Open http://localhost:3002. Dependencies are project-local in `node_modules`; no global installs are needed. The existing `.venv` is for Python tools; this application needs no Python packages.

Create `.env.local` from `.env.example` on a fresh checkout and fill in the environment variables below. Never commit `.env.local`.

Required environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`: the existing project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: the existing public anon key.
- `GEMINI_API_KEY`: server-only key for running Google Gemini steps.
- `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`): server-only Supabase key for writing generation history and saving uploaded input images. Never prefix it with `NEXT_PUBLIC_`.

In Supabase → Authentication → URL Configuration → **Redirect URLs**, allow `http://localhost:3002/auth/callback`. Keep the existing Site URL and admin-panel redirects. Google sign-in uses the existing provider configuration. Only accounts whose `profiles.is_superadmin` is `true` can use the app or its APIs.

## Features

- Create, edit, search, paginate, and permanently delete chains.
- Create, edit, remove, and reorder steps, including keyboard-accessible up/down buttons and drag handles.
- Save a whole chain’s step configuration in one database transaction; stale saves are rejected.
- Choose existing active Google models, write prompts, and control image/context/terms/example inclusion per step.
- Run a selected chain against an optional image and user context. Each step automatically receives the preceding step’s actual text output.
- Save input images, chain configuration snapshots, per-step model responses, token counts, timing, and failed attempts to the existing history tables.
- Browse all generation history or filter by a particular chain; inspect the input image and each step’s response.
- Always use the light theme, independent of system appearance or previously saved theme preferences.

The editor and runner support up to **50 steps**, with a 100-second model execution deadline per run. Long chains may reach that deadline; completed step responses and the failure are retained in history. The existing user-facing CapRate app retains its own four-step generation limit. Inputs support JPG, PNG, and WebP up to 3 MB. Outputs are text/captions; image synthesis is not configured. All provider credentials remain on the server.

## Shared database

Uses existing `profiles`, `prompt_chains`, `prompt_chain_steps`, `llm_models`, `llm_providers`, `generation_requests`, `llm_responses`, `images`, `terms`, and `ai_generation_examples` tables, and the `generations` Storage bucket. Community examples also read existing `generations` and `votes` tables.

`supabase/prompt_studio.sql` defines the new `studio_save_steps` RPC. It was applied to the shared HumorProject database during setup. Do not recreate the existing tables. The function runs as the caller, keeps existing RLS policies in force, checks live superadmin status, locks the chain, checks the expected step revision, and atomically writes the new order and settings. Anonymous execution is revoked.

Edits here are reflected in the admin panel because both apps share the same records. Creating a chain does not add it to `prompt_chain_mix`; configure production selection separately in the admin panel. Deleting a chain preserves historical configuration snapshots and model responses. Chains referenced by curated examples cannot be deleted until those references are removed.

## Verification

```sh
npm run typecheck
npm run build
```


## Vercel, when ready

1. Push to the GitHub repository you created, after local review.
2. Import the repository as a new Vercel project using the Next.js preset and repository root.
3. Set the same environment variables above in Vercel. Do not commit credentials.
4. Add `https://YOUR-PROJECT.vercel.app/auth/callback` to Supabase Redirect URLs.
5. In Vercel → Settings → Deployment Protection, disable Vercel Authentication for the deployment environments you will share, then save.
6. Open the deployed login page in Incognito and sign in with a superadmin account.

Application-level Supabase authentication remains required even when Vercel Deployment Protection is off.
