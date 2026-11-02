"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import PageTransition from "@/components/page-transition";
import { createClient } from "@/lib/supabase/client";
import type { Chain, Step, Model, Run } from "@/lib/types";

type View = "chains" | "editor" | "run" | "history";
async function api(path: string, method = "GET", body?: unknown) {
  const res = await fetch(path, {
    method,
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
    cache: "no-store",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
function Mark({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? "small" : ""}`} aria-hidden="true">
      ✳
    </span>
  );
}
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    const d = ref.current;
    return () => d?.close();
  }, []);
  return (
    <dialog ref={ref} className="modal panel" onCancel={close}>
      <div className="row between">
        <h2>{title}</h2>
        <button
          aria-label="Close dialog"
          className="icon-button"
          onClick={close}
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
function ChainForm({
  chain,
  busy,
  onSubmit,
}: {
  chain?: Chain;
  busy: boolean;
  onSubmit: (values: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState(chain?.name || ""),
    [slug, setSlug] = useState(chain?.slug || "");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          name,
          slug,
          description: new FormData(e.currentTarget).get("description"),
          is_active: new FormData(e.currentTarget).get("active") === "on",
        });
      }}
      className="form-stack"
    >
      <label>
        Chain name
        <input
          required
          maxLength={120}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!chain)
              setSlug(
                e.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-|-$/g, ""),
              );
          }}
          placeholder="e.g. Image captions"
          autoFocus
        />
      </label>
      <label>
        Slug
        <input
          required
          pattern="[a-z][a-z0-9_-]*"
          maxLength={80}
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="image-captions"
        />
      </label>
      <label>
        Description
        <textarea
          name="description"
          maxLength={2000}
          rows={3}
          defaultValue={chain?.description || ""}
          placeholder="What does this chain do?"
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          name="active"
          defaultChecked={chain?.is_active ?? true}
        />
        Active and available to run
      </label>
      <button disabled={busy} className="button yellow">
        {busy ? "Saving…" : chain ? "Save changes ↗" : "Create chain ↗"}
      </button>
    </form>
  );
}
export default function Studio() {
  const [view, setView] = useState<View>("chains"),
    [chains, setChains] = useState<Chain[]>([]),
    [chain, setChain] = useState<Chain | null>(null),
    [steps, setSteps] = useState<Step[]>([]),
    [original, setOriginal] = useState<Step[]>([]),
    [models, setModels] = useState<Model[]>([]);
  const [count, setCount] = useState(0),
    [page, setPage] = useState(1),
    [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [email, setEmail] = useState(""),
    [busy, setBusy] = useState(false),
    [chainsLoading, setChainsLoading] = useState(true),
    [historyLoading, setHistoryLoading] = useState(true),
    [openingChain, setOpeningChain] = useState<string | null>(null),
    [historyLoadedKey, setHistoryLoadedKey] = useState<string | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [modal, setModal] = useState<"create" | "edit" | "delete" | null>(null),
    [dirty, setDirty] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]),
    [historyCount, setHistoryCount] = useState(0),
    [historyPage, setHistoryPage] = useState(1),
    [historyChain, setHistoryChain] = useState(""),
    [expanded, setExpanded] = useState<string | null>(null);
  const [running, setRunning] = useState(false),
    [output, setOutput] = useState(""),
    [preview, setPreview] = useState(""),
    [runId, setRunId] = useState(""),
    [dragged, setDragged] = useState<number | null>(null);
  const navigationSequence = useRef(0);
  const chainLoadSequence = useRef(0);
  const historyLoadSequence = useRef(0);
  const loadChains = useCallback(async () => {
    const requestSequence = ++chainLoadSequence.current;
    setChainsLoading(true);
    try {
      const data = await api(
        `/api/chains?page=${page}&q=${encodeURIComponent(search)}`,
      );
      if (requestSequence !== chainLoadSequence.current) return;
      setChains(data.chains);
      setCount(data.count);
      setEmail(data.email);
    } catch (e) {
      if (requestSequence === chainLoadSequence.current)
        setError((e as Error).message);
    } finally {
      if (requestSequence === chainLoadSequence.current)
        setChainsLoading(false);
    }
  }, [page, search]);
  useEffect(() => {
    void loadChains();
  }, [loadChains]);
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(q);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const loadHistory = useCallback(async () => {
    const requestSequence = ++historyLoadSequence.current;
    setHistoryLoading(true);
    try {
      const d = await api(
        `/api/history?page=${historyPage}${historyChain ? `&chainId=${historyChain}` : ""}`,
      );
      if (requestSequence !== historyLoadSequence.current) return;
      setRuns(d.runs);
      setHistoryCount(d.count);
      setHistoryLoadedKey(`${historyChain}:${historyPage}`);
    } catch (e) {
      if (requestSequence === historyLoadSequence.current)
        setError((e as Error).message);
    } finally {
      if (requestSequence === historyLoadSequence.current)
        setHistoryLoading(false);
    }
  }, [historyPage, historyChain]);
  useEffect(() => {
    if (view === "history") void loadHistory();
  }, [view, loadHistory]);
  useEffect(() => {
    const f = (e: BeforeUnloadEvent) => {
      if (dirty || running) e.preventDefault();
    };
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, [dirty, running]);
  function canLeave() {
    if (running) {
      setNotice("Wait for this generation to finish before changing views.");
      return false;
    }
    if (busy) return false;
    return !dirty || confirm("Discard your unsaved step changes?");
  }
  function navigate(v: View) {
    if (!canLeave()) return;
    navigationSequence.current += 1;
    setOpeningChain(null);
    if (dirty) setSteps(original);
    setDirty(false);
    setView(v);
    setError("");
    setNotice("");
    if (v === "chains") void loadChains();
  }
  async function openChain(id: string, v: View = "editor", saved = false) {
    if (!saved && !canLeave()) return;
    const requestSequence = ++navigationSequence.current;
    setOpeningChain(id);
    setError("");
    setNotice("");
    try {
      const d = await api(`/api/chains?id=${id}`);
      if (requestSequence !== navigationSequence.current) return;
      setChain(d.chain);
      setSteps(d.steps);
      setOriginal(d.steps);
      setModels(d.models);
      setDirty(false);
      setView(v);
      setOutput("");
      setRunId("");
    } catch (e) {
      if (requestSequence === navigationSequence.current)
        setError((e as Error).message);
    } finally {
      if (requestSequence === navigationSequence.current) setOpeningChain(null);
    }
  }
  async function mutate(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveChain(values: Record<string, unknown>) {
    await mutate(async () => {
      const d = await api(
        "/api/chains",
        modal === "create" ? "POST" : "PATCH",
        {
          ...values,
          ...(modal === "edit"
            ? { id: chain!.id, updated_at: chain!.updated_at }
            : {}),
        },
      );
      setModal(null);
      if (modal === "create") await openChain(d.chain.id, "editor", true);
      else setChain(d.chain);
      void loadChains();
      setNotice("Chain saved.");
    });
  }
  async function deleteChain() {
    await mutate(async () => {
      await api("/api/chains", "DELETE", {
        id: chain!.id,
        updated_at: chain!.updated_at,
      });
      setModal(null);
      setChain(null);
      setSteps([]);
      setDirty(false);
      setView("chains");
      void loadChains();
      setNotice("Chain deleted. Existing run history is preserved.");
    });
  }
  function updateStep(index: number, patch: Partial<Step>) {
    setSteps((s) =>
      s.map((step, i) => (i === index ? { ...step, ...patch } : step)),
    );
    setDirty(true);
  }
  function move(from: number, to: number) {
    if (from === to || to < 0 || to >= steps.length) return;
    setSteps((s) => {
      const next = [...s];
      const [step] = next.splice(from, 1);
      next.splice(to, 0, step);
      return next;
    });
    setDirty(true);
  }
  function addStep() {
    const model = models.find(
      (m) => m.provider?.slug === "google" && m.provider.is_active,
    );
    setSteps((s) => [
      ...s,
      {
        id: crypto.randomUUID(),
        prompt_chain_id: chain!.id,
        position: s.length + 1,
        name: "",
        prompt_template: "",
        llm_model_id: model?.id || "",
        include_image: s.length === 0,
        include_user_context: true,
        use_terms: false,
        use_curated_examples: false,
        use_community_examples: false,
        updated_at: "",
      },
    ]);
    setDirty(true);
  }
  async function saveSteps() {
    await mutate(async () => {
      await api("/api/chains", "PATCH", {
        action: "steps",
        id: chain!.id,
        expected: original
          .map((s) => ({ id: s.id, updated_at: s.updated_at }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        steps,
      });
      setDirty(false);
      const d = await api(`/api/chains?id=${chain!.id}`);
      setChain(d.chain);
      setSteps(d.steps);
      setOriginal(d.steps);
      setNotice("All steps saved. Your chain is ready.");
      void loadChains();
    });
  }
  function historyFor(id = "") {
    if (!canLeave()) return;
    navigationSequence.current += 1;
    setOpeningChain(null);
    if (dirty) setSteps(original);
    setDirty(false);
    setHistoryChain(id);
    setHistoryPage(1);
    setView("history");
    setError("");
    setNotice("");
  }
  async function generate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (running) return;
    setRunning(true);
    setError("");
    setOutput("");
    setRunId("");
    const form = new FormData(e.currentTarget);
    form.set("chainId", chain!.id);
    try {
      const res = await fetch("/api/generate", { method: "POST", body: form });
      const d = await res.json();
      if (d.requestId) setRunId(d.requestId);
      if (!res.ok) throw new Error(d.error);
      setOutput(d.output);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }
  const active = chains.filter((c) => c.is_active).length;
  return (
    <div className="studio">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Prompt Studio home">
          <Mark />
          <span>
            CapRate<span className="brand-sub">PROMPT STUDIO</span>
          </span>
        </a>
        <span className="sidebar-label">YOUR WORKSPACE</span>
        <nav aria-label="Main navigation">
          <button
            className={
              view === "chains" || view === "editor"
                ? "nav-item selected"
                : "nav-item"
            }
            onClick={() => navigate("chains")}
          >
            <span>▦</span>Prompt chains<span className="nav-arrow">↗</span>
          </button>
          <button
            className={view === "run" ? "nav-item selected" : "nav-item"}
            onClick={() => {
              if (chain) navigate("run");
              else {
                navigate("chains");
                setNotice("Open a chain to start generating.");
              }
            }}
          >
            <span>▷</span>Playground
          </button>
          <button
            className={view === "history" ? "nav-item selected" : "nav-item"}
            onClick={() => historyFor()}
          >
            <span>◷</span>Generated media
          </button>
        </nav>
        <div className="sidebar-bottom">
          <span className="badge green">● SUPERADMIN</span>
          <p className="email" title={email}>
            {email || "CapRate workspace"}
          </p>
          <button
            className="text-button"
            onClick={async () => {
              if (!canLeave()) return;
              await createClient().auth.signOut();
              location.assign("/login");
            }}
          >
            Sign out ↗
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            WORKSPACE <span>/</span>
            <strong>
              {view === "editor"
                ? chain?.name
                : view === "run"
                  ? "Playground"
                  : view === "history"
                    ? "Generated media"
                    : "Prompt chains"}
            </strong>
          </div>
          <div className="row">
            <button
              className="text-button mobile-signout"
              onClick={async () => {
                if (!canLeave()) return;
                await createClient().auth.signOut();
                location.assign("/login");
              }}
            >
              Sign out ↗
            </button>
          </div>
        </header>
        <main id="main" className="main">
          <PageTransition
            transitionKey={
              view === "editor" || view === "run"
                ? `${view}:${chain?.id ?? ""}`
                : view
            }
          >
            <div className="mobile-brand">
              <Mark small /> CAPRATE / PROMPT STUDIO
            </div>
            <div className="page-heading">
              <div>
                <h1>
                  {view === "editor"
                    ? chain?.name
                    : view === "run"
                      ? "Playground"
                      : view === "history"
                        ? "Generated media"
                        : "Prompt chains"}
                </h1>
                <p className="muted">
                  {view === "editor"
                    ? "Create, edit, and reorder the steps in this chain."
                    : view === "run"
                      ? "Run a prompt chain with an image and optional context."
                      : view === "history"
                        ? "View generated output and individual step responses."
                        : "Create and manage prompt chains."}
                </p>
              </div>
              {view === "chains" && (
                <button
                  className="button yellow"
                  onClick={() => setModal("create")}
                >
                  ＋ New chain
                </button>
              )}
              {view === "editor" && (
                <button
                  className="button yellow"
                  disabled={busy || !dirty}
                  onClick={saveSteps}
                >
                  {busy ? "Saving…" : "Save steps ↗"}
                </button>
              )}
            </div>
            {error && (
              <div role="alert" className="notice error">
                {error}
                <button aria-label="Dismiss error" onClick={() => setError("")}>
                  ×
                </button>
              </div>
            )}
            {notice && (
              <div role="status" className="notice success">
                {notice}
                <button
                  aria-label="Dismiss notification"
                  onClick={() => setNotice("")}
                >
                  ×
                </button>
              </div>
            )}
            {view === "chains" && (
              <>
                <div className="library-bar">
                  <div className="row">
                    <h2>Chain library</h2>
                    <span className="count">
                      {count.toString().padStart(2, "0")}
                    </span>
                  </div>
                  <label className="search">
                    <span aria-hidden="true">⌕</span>
                    <input
                      aria-label="Search chains"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Find a chain…"
                    />
                  </label>
                </div>
                {chainsLoading && !chains.length ? (
                  <div className="empty panel" role="status">
                    Loading your chains…
                  </div>
                ) : chains.length === 0 ? (
                  <div className="empty panel">
                    <Mark />
                    <h2>{search ? "No matches." : "No prompt chains yet."}</h2>
                    <p>
                      {search
                        ? "Try another chain name."
                        : "Create a chain and add its steps."}
                    </p>
                    <button
                      className="button yellow"
                      onClick={() => (search ? setQ("") : setModal("create"))}
                    >
                      {search ? "Clear search" : "＋ Create your first chain"}
                    </button>
                  </div>
                ) : (
                  <div className="chain-grid">
                    {chains.map((c, i) => (
                      <article
                        className="chain-card panel"
                        key={c.id}
                        aria-busy={openingChain === c.id}
                      >
                        <div className="row between">
                          <span
                            className={`chain-icon ${["lavender", "yellow", "green"][i % 3]}`}
                            aria-hidden="true"
                          >
                            {["⌘", "✳", "↗"][i % 3]}
                          </span>
                          <span
                            className={`badge ${c.is_active ? "green" : "neutral"}`}
                          >
                            ● {c.is_active ? "ACTIVE" : "INACTIVE"}
                          </span>
                        </div>
                        <h3>
                          <button
                            className="card-title"
                            onClick={() => void openChain(c.id)}
                          >
                            {c.name}
                          </button>
                        </h3>
                        <p className="card-description">
                          {c.description || "No description provided."}
                        </p>
                        <div className="card-meta">
                          <span>
                            ▤ {c.prompt_chain_steps?.[0]?.count || 0} steps
                          </span>
                          <span>
                            Updated{" "}
                            {new Date(c.updated_at).toLocaleDateString(
                              "en-US",
                              {
                                month: "short",
                                day: "numeric",
                              },
                            )}
                          </span>
                        </div>
                        <div className="card-actions">
                          <button onClick={() => void openChain(c.id)}>
                            {openingChain === c.id ? "Opening…" : "Open chain"}{" "}
                            <span>↗</span>
                          </button>
                          <button
                            aria-label={`Run ${c.name}`}
                            disabled={!c.is_active}
                            onClick={() => void openChain(c.id, "run")}
                          >
                            ▷
                          </button>
                        </div>
                      </article>
                    ))}
                    <button
                      className="new-card"
                      onClick={() => setModal("create")}
                    >
                      <span>＋</span>
                      <strong>Create a prompt chain</strong>
                    </button>
                  </div>
                )}
                <div className="row between library-footer">
                  <p className="fine">
                    {count} chains in your workspace · {active} active on this
                    page
                  </p>
                  <div className="row">
                    <button
                      className="button compact"
                      disabled={page === 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      ← Previous
                    </button>
                    <span className="fine">{page}</span>
                    <button
                      className="button compact"
                      disabled={page * 24 >= count}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next →
                    </button>
                  </div>
                </div>
              </>
            )}
            {(view === "editor" || view === "run") && chain && (
              <>
                <div className="chain-toolbar">
                  <div className="tabs">
                    <button
                      className={view === "editor" ? "active" : ""}
                      onClick={() => navigate("editor")}
                    >
                      01 / Steps
                    </button>
                    <button
                      className={view === "run" ? "active" : ""}
                      onClick={() => navigate("run")}
                    >
                      02 / Playground
                    </button>
                    <button onClick={() => historyFor(chain.id)}>
                      03 / History
                    </button>
                  </div>
                  <div className="row">
                    <button
                      className="text-button"
                      onClick={() => setModal("edit")}
                    >
                      Edit details
                    </button>
                    <button
                      className="text-button danger-text"
                      onClick={() => setModal("delete")}
                    >
                      Delete chain
                    </button>
                  </div>
                </div>
                {view === "editor" && (
                  <>
                    <div className="section-line">
                      <span>
                        {steps.length} STEPS {dirty ? " / UNSAVED CHANGES" : ""}
                      </span>
                      <span>Drag to reorder, or use the arrows</span>
                    </div>
                    <div className="steps-list">
                      {steps.map((step, i) => (
                        <article
                          className="step-card panel"
                          key={step.id}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (dragged !== null) move(dragged, i);
                            setDragged(null);
                          }}
                        >
                          <div className="step-rail">
                            <button
                              draggable
                              onDragStart={(e) => {
                                setDragged(i);
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setData("text/plain", step.id);
                              }}
                              onDragEnd={() => setDragged(null)}
                              className="drag-handle"
                              aria-label={`Drag step ${i + 1}`}
                            >
                              ⠿
                            </button>
                            <span
                              className={`step-number ${["lavender", "yellow", "green"][i % 3]}`}
                            >
                              {String(i + 1).padStart(2, "0")}
                            </span>
                            <button
                              className="icon-button"
                              aria-label={`Move step ${i + 1} up`}
                              disabled={i === 0 || busy}
                              onClick={() => move(i, i - 1)}
                            >
                              ↑
                            </button>
                            <button
                              className="icon-button"
                              aria-label={`Move step ${i + 1} down`}
                              disabled={i === steps.length - 1 || busy}
                              onClick={() => move(i, i + 1)}
                            >
                              ↓
                            </button>
                          </div>
                          <div className="step-body">
                            <div className="row between">
                              <label className="step-name">
                                <span className="sr-only">
                                  Step {i + 1} name
                                </span>
                                <input
                                  disabled={busy}
                                  value={step.name}
                                  maxLength={120}
                                  placeholder="Give this step a name…"
                                  onChange={(e) =>
                                    updateStep(i, { name: e.target.value })
                                  }
                                />
                              </label>
                              <button
                                className="text-button danger-text"
                                disabled={busy}
                                onClick={() => {
                                  if (
                                    confirm(
                                      `Remove step ${i + 1}? Save steps to apply this change.`,
                                    )
                                  ) {
                                    setSteps((s) =>
                                      s.filter((_, j) => j !== i),
                                    );
                                    setDirty(true);
                                  }
                                }}
                              >
                                Remove ×
                              </button>
                            </div>
                            <label>
                              Model
                              <select
                                disabled={busy}
                                value={step.llm_model_id}
                                onChange={(e) =>
                                  updateStep(i, {
                                    llm_model_id: e.target.value,
                                  })
                                }
                              >
                                <option value="">Choose a model</option>
                                {models
                                  .filter(
                                    (m) =>
                                      m.provider?.slug === "google" &&
                                      m.provider.is_active,
                                  )
                                  .map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.name} / {m.model_identifier}
                                    </option>
                                  ))}
                              </select>
                            </label>
                            <label>
                              Prompt
                              <textarea
                                disabled={busy}
                                rows={5}
                                maxLength={12000}
                                value={step.prompt_template}
                                onChange={(e) =>
                                  updateStep(i, {
                                    prompt_template: e.target.value,
                                  })
                                }
                                placeholder={
                                  i === 0
                                    ? "Describe the image in detail. Focus on unexpected or amusing details."
                                    : "Use the previous step’s output to write something funny…"
                                }
                              />
                            </label>
                            <p className="fine">
                              {i === 0
                                ? "The first step receives your image and context."
                                : "The previous step’s text is automatically included in this prompt."}
                            </p>
                            <div className="step-flags">
                              {(
                                [
                                  ["include_image", "Include image"],
                                  ["include_user_context", "User context"],
                                  ["use_terms", "Terms"],
                                  ["use_curated_examples", "Curated examples"],
                                  [
                                    "use_community_examples",
                                    "Community examples",
                                  ],
                                ] as const
                              ).map(([key, label]) => (
                                <label className="check" key={key}>
                                  <input
                                    disabled={busy}
                                    type="checkbox"
                                    checked={step[key]}
                                    onChange={(e) =>
                                      updateStep(i, { [key]: e.target.checked })
                                    }
                                  />
                                  {label}
                                </label>
                              ))}
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                    {steps.length === 0 && (
                      <div className="empty panel">
                        <h2>No steps yet.</h2>
                        <p>Add your first step below.</p>
                      </div>
                    )}
                    <button
                      className="add-step"
                      disabled={steps.length >= 50 || busy}
                      onClick={addStep}
                    >
                      ＋ Add a step
                    </button>
                    <p className="fine">
                      Chains support up to 50 steps. Each run has a two-minute
                      execution window; previous step outputs are included
                      automatically.
                    </p>
                  </>
                )}
                {view === "run" && (
                  <div className="playground-grid">
                    <form
                      className="panel input-panel form-stack"
                      onSubmit={generate}
                    >
                      <div className="row between">
                        <h2>Input</h2>
                        <span className="badge lavender">INPUT</span>
                      </div>
                      <label className="upload">
                        <span className="upload-icon">↥</span>
                        <strong>
                          {preview
                            ? "Image ready. Choose another?"
                            : "Upload an image"}
                        </strong>
                        <span>JPG, PNG, or WebP · up to 3 MB</span>
                        <input
                          name="image"
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          disabled={running}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            setPreview(f ? URL.createObjectURL(f) : "");
                          }}
                        />
                        {preview && (
                          <img
                            className="image-preview"
                            src={preview}
                            alt="Selected input"
                          />
                        )}
                      </label>
                      <label>
                        Context <span className="muted">(optional)</span>
                        <textarea
                          name="context"
                          rows={4}
                          maxLength={4000}
                          placeholder="A dry sense of humor. Five short captions. Make it feel like finals week…"
                          disabled={running}
                        />
                      </label>
                      <div className="run-summary">
                        <span>{chain.name}</span>
                        <span>{steps.length} steps → text</span>
                      </div>
                      <button
                        disabled={
                          running ||
                          !chain.is_active ||
                          steps.length === 0 ||
                          steps.length > 50
                        }
                        className="button yellow full"
                      >
                        {running
                          ? "✳ Running your chain…"
                          : "▷ Generate captions"}
                      </button>
                      {!chain.is_active && (
                        <p className="fine">
                          Activate this chain in Edit details to run it.
                        </p>
                      )}
                      {steps.length > 50 && (
                        <p className="fine">
                          Reduce this chain to 50 steps to run it.
                        </p>
                      )}
                    </form>
                    <section className="panel output-panel">
                      <div className="row between">
                        <h2>Output</h2>
                        <span className="badge green">OUTPUT</span>
                      </div>
                      {running ? (
                        <div className="output-empty" role="status">
                          <span className="spinning">✳</span>
                          <h3>Running chain…</h3>
                          <p>
                            Working through each step in order.
                            <br />
                            This can take a minute.
                          </p>
                        </div>
                      ) : output ? (
                        <>
                          <div className="generated-output">{output}</div>
                          <div className="row">
                            <button
                              className="button compact"
                              onClick={() =>
                                void navigator.clipboard
                                  .writeText(output)
                                  .then(() => setNotice("Output copied."))
                                  .catch(() =>
                                    setError(
                                      "Could not copy. Select and copy the text manually.",
                                    ),
                                  )
                              }
                            >
                              Copy text ↗
                            </button>
                            <button
                              className="text-button"
                              onClick={() => {
                                setExpanded(runId);
                                historyFor(chain.id);
                              }}
                            >
                              View all step responses →
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="output-empty">
                          <h3>No output yet.</h3>
                          <p>Run this chain to view its final output.</p>
                          {runId && (
                            <button
                              className="text-button"
                              onClick={() => {
                                setExpanded(runId);
                                historyFor(chain.id);
                              }}
                            >
                              Inspect failed run →
                            </button>
                          )}
                        </div>
                      )}
                    </section>
                  </div>
                )}
              </>
            )}
            {view === "history" && (
              <>
                <div className="library-bar">
                  <h2>
                    Generation history{" "}
                    <span className="count">{historyCount}</span>
                  </h2>
                  <label className="row">
                    <span className="fine">CHAIN</span>
                    <select
                      aria-label="Filter history by chain"
                      value={historyChain}
                      onChange={(e) => {
                        setHistoryChain(e.target.value);
                        setHistoryPage(1);
                      }}
                    >
                      <option value="">All chains</option>
                      {chain && !chains.some((c) => c.id === chain.id) && (
                        <option value={chain.id}>{chain.name}</option>
                      )}
                      {chains.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {historyLoading &&
                historyLoadedKey !== `${historyChain}:${historyPage}` ? (
                  <div className="empty panel" role="status">
                    Loading generated media…
                  </div>
                ) : !runs.length ? (
                  <div className="empty panel">
                    <Mark />
                    <h2>No generations yet.</h2>
                    <p>
                      Run a chain in the playground to see your results here.
                    </p>
                  </div>
                ) : (
                  <div className="history-list">
                    {runs.map((run) => (
                      <article className="panel history-card" key={run.id}>
                        <button
                          className="history-heading"
                          onClick={() =>
                            setExpanded(expanded === run.id ? null : run.id)
                          }
                          aria-expanded={expanded === run.id}
                        >
                          <div>
                            <span className="eyebrow">
                              {new Date(run.created_at).toLocaleString()}
                            </span>
                            <h3>
                              {run.configuration_snapshot?.chain?.name ||
                                "Prompt chain"}
                            </h3>
                            <p className="fine">
                              {run.id.slice(0, 8)} · {run.llm_responses.length}{" "}
                              responses
                            </p>
                          </div>
                          <span
                            className={`badge ${run.status === "succeeded" ? "green" : run.status === "failed" ? "red" : "yellow"}`}
                          >
                            {run.status.toUpperCase()}
                          </span>
                          <span>{expanded === run.id ? "−" : "＋"}</span>
                        </button>
                        {expanded === run.id && (
                          <div className="history-detail">
                            {run.imageUrl && (
                              <img
                                src={run.imageUrl}
                                alt="Generation input"
                                className="history-image"
                              />
                            )}
                            {run.user_context && (
                              <p>
                                <strong>User context:</strong>{" "}
                                {run.user_context}
                              </p>
                            )}
                            {run.error_message && (
                              <p className="notice error">
                                {run.error_message}
                              </p>
                            )}
                            {[...run.llm_responses]
                              .sort((a, b) => a.step_position - b.step_position)
                              .map((r) => (
                                <section className="response" key={r.id}>
                                  <div className="row between">
                                    <strong>
                                      STEP{" "}
                                      {String(r.step_position).padStart(2, "0")}
                                    </strong>
                                    <span className="fine">
                                      {r.model_identifier} · {r.latency_ms ?? 0}{" "}
                                      ms
                                    </span>
                                  </div>
                                  <div className="generated-output">
                                    {r.response_text ||
                                      r.error_message ||
                                      "No text returned."}
                                  </div>
                                </section>
                              ))}
                            {run.llm_responses.length === 0 && (
                              <p className="muted">
                                No model responses recorded for this run.
                              </p>
                            )}
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                )}
                <div className="row between library-footer">
                  <p className="fine">Page {historyPage}</p>
                  <div className="row">
                    <button
                      className="button compact"
                      disabled={historyPage === 1}
                      onClick={() => setHistoryPage((p) => p - 1)}
                    >
                      ← Previous
                    </button>
                    <button
                      className="button compact"
                      disabled={historyPage * 12 >= historyCount}
                      onClick={() => setHistoryPage((p) => p + 1)}
                    >
                      Next →
                    </button>
                    <button
                      className="button compact"
                      onClick={() => void loadHistory()}
                    >
                      Refresh ↻
                    </button>
                  </div>
                </div>
              </>
            )}
          </PageTransition>
        </main>
      </div>
      {modal && (
        <Modal
          title={
            modal === "create"
              ? "Create prompt chain"
              : modal === "edit"
                ? "Edit prompt chain"
                : "Delete this chain?"
          }
          close={() => {
            if (!busy) setModal(null);
          }}
        >
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          {modal === "delete" ? (
            <>
              <p>
                This permanently deletes <strong>{chain?.name}</strong> and all
                its steps. Existing generation history will be preserved.
              </p>
              <div className="row">
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => setModal(null)}
                >
                  Keep chain
                </button>
                <button
                  className="button red"
                  disabled={busy}
                  onClick={deleteChain}
                >
                  {busy ? "Deleting…" : "Delete permanently"}
                </button>
              </div>
            </>
          ) : (
            <ChainForm
              chain={modal === "edit" ? chain || undefined : undefined}
              busy={busy}
              onSubmit={saveChain}
            />
          )}
        </Modal>
      )}
    </div>
  );
}
