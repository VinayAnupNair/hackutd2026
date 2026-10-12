"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function PasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error || "Wrong password.");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden arena-floor">
      <div className="noise-overlay absolute inset-0" />
      <div className="pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full bg-[var(--teal)]/25 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 bottom-20 h-80 w-80 rounded-full bg-[var(--coral)]/25 blur-3xl" />

      <main className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-10">
        <p className="mb-3 text-xs uppercase tracking-[0.35em] text-[var(--mute)]">
          Restricted access
        </p>
        <h1 className="font-[family-name:var(--font-display)] text-5xl font-extrabold leading-[0.9] tracking-tighter text-[var(--ink)] md:text-6xl">
          Enter
          <br />
          password
        </h1>
        <p className="mt-5 text-sm leading-relaxed text-[var(--ink)]/75">
          This arena is locked. Enter the site password to continue.
        </p>

        <form onSubmit={onSubmit} className="mt-10 flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--mute)]">
              Password
            </span>
            <input
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border border-[var(--ink)]/15 bg-[var(--ring)] px-4 py-3 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--ink)]/40"
              placeholder="••••••••"
            />
          </label>

          {error ? (
            <p className="text-sm text-[var(--coral)]" role="alert">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={loading || !password}
            className="mt-2 w-fit bg-[var(--ink)] px-8 py-3.5 font-[family-name:var(--font-display)] text-lg font-bold uppercase tracking-wide text-[var(--paper)] transition hover:bg-[var(--ink)]/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "Checking…" : "Unlock"}
          </button>
        </form>
      </main>
    </div>
  );
}
