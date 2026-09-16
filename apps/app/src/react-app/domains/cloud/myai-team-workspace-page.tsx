/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";

import { readDenBootstrapConfig } from "../../../app/lib/den";
import {
  createMyaiServerClient,
  MyaiServerApiError,
  readMyaiString,
  type MyaiWorkspace,
} from "../../../app/lib/myai-server-client";
import { Button } from "../../../components/ui/button";
import { useBootState } from "../../shell/boot-state";
import { useDenAuth } from "./den-auth-provider";

function messageFor(error: unknown): string {
  if (error instanceof MyaiServerApiError && (error.status === 401 || error.status === 403)) {
    return "Access rejected";
  }
  return error instanceof Error ? error.message : "The team server could not complete the action.";
}

export function MyaiTeamWorkspacePage() {
  const denAuth = useDenAuth();
  const { markRouteReady } = useBootState();
  const baseUrl = readDenBootstrapConfig().baseUrl;
  const clientResult = useMemo(() => {
    try {
      return { client: createMyaiServerClient({ baseUrl }), error: null };
    } catch (error) {
      return { client: null, error: messageFor(error) };
    }
  }, [baseUrl]);
  const [workspaces, setWorkspaces] = useState<MyaiWorkspace[]>([]);
  const [message, setMessage] = useState<string | null>(clientResult.error);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    markRouteReady();
  }, [markRouteReady]);

  useEffect(() => {
    if (!clientResult.client) return;
    let active = true;
    void clientResult.client.listWorkspaces()
      .then((result) => {
        if (active) setWorkspaces(result.workspaces);
      })
      .catch((error: unknown) => {
        if (active) setMessage(messageFor(error));
      });
    return () => {
      active = false;
    };
  }, [clientResult.client]);

  async function createSession(workspace: MyaiWorkspace): Promise<void> {
    if (!clientResult.client || busy) return;
    setBusy(`session:${workspace.id}`);
    setMessage(null);
    try {
      const runtime = await clientResult.client.createRuntimeToken(workspace.id);
      const response = await clientResult.client.runtimeRequest(
        workspace.id,
        "/opencode/session",
        runtime.token,
        { method: "POST", body: JSON.stringify({ title: "myai Team session" }) },
      );
      setSessionId(readMyaiString(response, "id"));
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setBusy(null);
    }
  }

  async function readApprovedFile(workspace: MyaiWorkspace): Promise<void> {
    if (!clientResult.client || busy) return;
    setBusy(`file:${workspace.id}`);
    setMessage(null);
    try {
      const runtime = await clientResult.client.createRuntimeToken(workspace.id);
      const response = await clientResult.client.runtimeRequest(
        workspace.id,
        "/files/content?path=approved.txt",
        runtime.token,
      );
      setFileContent(readMyaiString(response, "content"));
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setBusy(null);
    }
  }

  async function signOut(): Promise<void> {
    if (!clientResult.client || busy) return;
    setBusy("sign-out");
    try {
      await clientResult.client.signOut();
      await denAuth.refresh();
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="min-h-screen bg-background px-6 py-10 text-foreground" data-testid="myai-team-workspace">
      <div className="mx-auto max-w-3xl space-y-8">
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">myai Team</p>
            <h1 className="text-3xl font-semibold tracking-tight">Team workspace</h1>
            <p className="text-sm text-muted-foreground">{denAuth.user?.email ?? "Signed-in team member"}</p>
          </div>
          <Button disabled={busy !== null} onClick={() => void signOut()} variant="outline">
            Sign out
          </Button>
        </header>

        <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Available workspaces</h2>
          {workspaces.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No workspaces have been granted yet.</p>
          ) : (
            <ul className="mt-4 space-y-4">
              {workspaces.map((workspace) => (
                <li className="rounded-2xl border border-border p-4" key={workspace.id}>
                  <p className="font-medium">{workspace.name}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      disabled={busy !== null}
                      onClick={() => void createSession(workspace)}
                    >
                      Create runtime session
                    </Button>
                    <Button
                      disabled={busy !== null}
                      onClick={() => void readApprovedFile(workspace)}
                      variant="outline"
                    >
                      Read approved file
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {sessionId ? <p className="mt-5 text-sm" data-testid="myai-team-session" role="status">Session: {sessionId}</p> : null}
          {fileContent ? <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-muted p-3 text-sm" data-testid="myai-team-file" role="status">{fileContent}</pre> : null}
          {message ? <p className="mt-4 text-sm text-destructive" data-testid="myai-team-error" role="alert">{message}</p> : null}
        </section>
      </div>
    </main>
  );
}
