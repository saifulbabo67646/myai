/** @jsxImportSource react */
import { useEffect, useState } from "react";

import { readDenBootstrapConfig } from "../../../app/lib/den";
import { createMyaiServerClient, MyaiServerApiError } from "../../../app/lib/myai-server-client";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { useBootState } from "../../shell/boot-state";
import { useDenAuth } from "./den-auth-provider";

function messageFor(error: unknown): string {
  if (error instanceof MyaiServerApiError && error.status === 401) {
    return "Email or password is incorrect.";
  }
  return error instanceof Error ? error.message : "The team server could not sign you in.";
}

export function MyaiTeamSignInPage() {
  const denAuth = useDenAuth();
  const { markRouteReady } = useBootState();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    markRouteReady();
  }, [markRouteReady]);

  async function submit(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const client = createMyaiServerClient({ baseUrl: readDenBootstrapConfig().baseUrl });
      await client.signIn(email, password);
      await denAuth.refresh();
      if (!denAuth.isSignedIn && denAuth.status !== "checking") {
        setError(denAuth.error ?? "The team server did not establish a session.");
      }
    } catch (nextError) {
      setError(messageFor(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground"
      data-testid="myai-team-signin"
    >
      <section className="w-full max-w-md rounded-3xl border border-border bg-card p-8 shadow-sm">
        <div className="mb-8 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">myai Team</p>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to your team</h1>
          <p className="text-sm text-muted-foreground">Use the account invited to this myai server.</p>
        </div>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="block space-y-2 text-sm font-medium">
            <span>Email</span>
            <Input
              aria-label="Email"
              autoComplete="email"
              disabled={busy}
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label className="block space-y-2 text-sm font-medium">
            <span>Password</span>
            <Input
              aria-label="Password"
              autoComplete="current-password"
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          <Button className="w-full" disabled={busy} type="submit">
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </section>
    </main>
  );
}
