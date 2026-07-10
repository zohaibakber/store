import type { Note, SyncPhase, SyncStatus } from "@store/contracts";
import {
  CloudIcon,
  CloudOffIcon,
  FileTextIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  TriangleAlertIcon,
  WifiOffIcon,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const initialStatus: SyncStatus = {
  phase: "local-only",
  configured: false,
  lastSyncedAt: null,
  message: "Loading local database…",
};

const phaseBadge: Record<
  SyncPhase,
  { label: string; variant: "outline" | "info" | "warning" | "error" }
> = {
  "local-only": { label: "Local only", variant: "outline" },
  idle: { label: "Cloud ready", variant: "info" },
  syncing: { label: "Syncing", variant: "warning" },
  error: { label: "Sync paused", variant: "error" },
};

const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Something unexpected happened";

export function HomePage() {
  const [notes, setNotes] = useState<ReadonlyArray<Note>>([]);
  const [status, setStatus] = useState(initialStatus);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [nextNotes, nextStatus] = await Promise.all([
      window.offlineStore.listNotes(),
      window.offlineStore.getSyncStatus(),
    ]);
    setNotes(nextNotes);
    setStatus(nextStatus);
  }, []);

  useEffect(() => {
    refresh()
      .catch((cause: unknown) => setError(errorMessage(cause)))
      .finally(() => setLoading(false));
  }, [refresh]);

  const clearForm = () => {
    setEditingId(null);
    setTitle("");
    setBody("");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (editingId) {
        await window.offlineStore.updateNote({ id: editingId, title, body });
      } else {
        await window.offlineStore.createNote({ title, body });
      }
      clearForm();
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const edit = (note: Note) => {
    setEditingId(note.id);
    setTitle(note.title);
    setBody(note.body);
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await window.offlineStore.deleteNote({ id });
      if (editingId === id) clearForm();
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setBusy(true);
    setError(null);
    setStatus((current) => ({ ...current, phase: "syncing", message: "Syncing changes…" }));
    try {
      setStatus(await window.offlineStore.sync());
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
      setStatus(await window.offlineStore.getSyncStatus());
    } finally {
      setBusy(false);
    }
  };

  const badge = phaseBadge[status.phase];

  return (
    <main className="p-6 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="font-medium text-primary text-sm">Offline-first demo</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Local notes</h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              Every edit is written to the on-device Turso database first. Cloud sync is explicit
              and never blocks local work.
            </p>
          </div>
          <Button
            disabled={!status.configured || loading}
            loading={busy && status.phase === "syncing"}
            onClick={sync}
            type="button"
            variant="outline"
          >
            <RefreshCwIcon aria-hidden="true" />
            Sync now
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {status.configured ? (
                <CloudIcon aria-hidden="true" />
              ) : (
                <CloudOffIcon aria-hidden="true" />
              )}
              Sync status
            </CardTitle>
            <CardDescription>{status.message}</CardDescription>
            <CardAction>
              <Badge variant={badge.variant}>{badge.label}</Badge>
            </CardAction>
          </CardHeader>
          <CardPanel className="flex flex-wrap gap-x-8 gap-y-2 border-t pt-4 text-sm">
            <span>
              <strong className="font-medium">Storage:</strong>{" "}
              <span className="text-muted-foreground">local database</span>
            </span>
            <span>
              <strong className="font-medium">Last sync:</strong>{" "}
              <span className="text-muted-foreground">
                {status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString() : "Never"}
              </span>
            </span>
          </CardPanel>
        </Card>

        {error && (
          <Alert variant="error">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle>Operation failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(17rem,22rem)_1fr]">
          <Card>
            <form onSubmit={submit}>
              <CardHeader>
                <CardTitle>{editingId ? "Edit note" : "New note"}</CardTitle>
                <CardDescription>Saved locally as soon as you submit.</CardDescription>
              </CardHeader>
              <CardPanel className="space-y-4">
                <Field name="title">
                  <FieldLabel>Title</FieldLabel>
                  <Input
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="What should you remember?"
                    required
                    type="text"
                    value={title}
                  />
                </Field>
                <Field name="body">
                  <FieldLabel>Details</FieldLabel>
                  <Textarea
                    onChange={(event) => setBody(event.target.value)}
                    placeholder="Add a little context…"
                    rows={5}
                    value={body}
                  />
                  <FieldDescription>Works without a network connection.</FieldDescription>
                </Field>
              </CardPanel>
              <CardFooter className="justify-end gap-2">
                {editingId && (
                  <Button onClick={clearForm} type="button" variant="ghost">
                    Cancel
                  </Button>
                )}
                <Button disabled={!title.trim()} loading={busy} type="submit">
                  {editingId ? <PencilIcon aria-hidden="true" /> : <PlusIcon aria-hidden="true" />}
                  {editingId ? "Save changes" : "Create note"}
                </Button>
              </CardFooter>
            </form>
          </Card>

          <section aria-busy={loading} aria-label="Saved notes" className="space-y-3">
            {notes.length === 0 ? (
              <Card>
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      {status.phase === "error" ? (
                        <WifiOffIcon aria-hidden="true" />
                      ) : (
                        <FileTextIcon aria-hidden="true" />
                      )}
                    </EmptyMedia>
                    <EmptyTitle>{loading ? "Opening local database…" : "No notes yet"}</EmptyTitle>
                    <EmptyDescription>
                      {loading
                        ? "Your on-device data will be ready in a moment."
                        : "Create the first note. It will be available offline immediately."}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </Card>
            ) : (
              notes.map((note) => (
                <Card key={note.id}>
                  <CardHeader>
                    <CardTitle>{note.title}</CardTitle>
                    <CardDescription>
                      Updated {new Date(note.updatedAt).toLocaleString()}
                    </CardDescription>
                    <CardAction className="gap-1">
                      <Button
                        aria-label={`Edit ${note.title}`}
                        onClick={() => edit(note)}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <PencilIcon aria-hidden="true" />
                      </Button>
                      <Button
                        aria-label={`Delete ${note.title}`}
                        disabled={busy}
                        onClick={() => remove(note.id)}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <Trash2Icon aria-hidden="true" />
                      </Button>
                    </CardAction>
                  </CardHeader>
                  {note.body && (
                    <CardPanel>
                      <p className="whitespace-pre-wrap text-sm leading-6">{note.body}</p>
                    </CardPanel>
                  )}
                </Card>
              ))
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
