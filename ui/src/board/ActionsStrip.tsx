// The pinned actions strip at the foot of the detail panel (DESIGN — "Footer
// actions"): + Add feedback (outline) · ✓ Validate (teal) · → Next, with an
// inline mono result line below. Behavior is unchanged from the accepted build —
// the inline feedback composer appends one bullet; Validate/Next render INLINE
// (not toasts).
import { useState } from "react";
import { Send } from "lucide-react";
import { workApi } from "./api";
import type { Finding, NextResponse, WorkItem } from "./api";

type ActionResult =
  | { kind: "none" }
  | { kind: "feedback-ok" }
  | { kind: "validate"; scope: string; findings: Finding[] }
  | { kind: "next"; next: NextResponse }
  | { kind: "error"; message: string };

export function ActionsStrip({
  item,
  actor,
  onRevealRef,
}: {
  item: WorkItem;
  actor: string;
  onRevealRef: (ref: string) => void;
}) {
  const [composing, setComposing] = useState(false);
  const [note, setNote] = useState("");
  const [refs, setRefs] = useState("");
  const [busy, setBusy] = useState<"feedback" | "validate" | "next" | null>(null);
  const [result, setResult] = useState<ActionResult>({ kind: "none" });

  const scope = item.ref;

  async function submitFeedback() {
    if (!note.trim() || busy) return;
    setBusy("feedback");
    try {
      await workApi.feedback({ ref: item.ref, note: note.trim(), actor, refs: refs.trim() || undefined });
      setComposing(false);
      setNote("");
      setRefs("");
      setResult({ kind: "feedback-ok" });
    } catch (error) {
      // A failed append surfaces an error and keeps the composer open with the note.
      setResult({ kind: "error", message: error instanceof Error ? error.message : "Feedback failed" });
    } finally {
      setBusy(null);
    }
  }

  async function runValidate() {
    if (busy) return;
    setBusy("validate");
    try {
      const response = await workApi.validate(scope);
      setResult({ kind: "validate", scope, findings: response.findings });
    } catch (error) {
      setResult({ kind: "error", message: error instanceof Error ? error.message : "Validate failed" });
    } finally {
      setBusy(null);
    }
  }

  async function runNext() {
    if (busy) return;
    setBusy("next");
    try {
      const response = await workApi.next(scope);
      setResult({ kind: "next", next: response });
    } catch (error) {
      setResult({ kind: "error", message: error instanceof Error ? error.message : "Next failed" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => setComposing((open) => !open)}
          className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium transition hover:border-primary/50 disabled:opacity-50"
        >
          + Add feedback
        </button>
        {/* Validate = NEUTRAL secondary (DESIGN §3): a check, not the loudest
            button. Run-agent (detail header, teal) is the single headline. */}
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void runValidate()}
          className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground transition hover:bg-secondary/80 disabled:opacity-50"
        >
          {busy === "validate" ? "Validating..." : "✓ Validate"}
        </button>
        {/* Next = primary-ish (navigation) but visually SUBORDINATE to Run-agent:
            a quiet primary-tinted outline, not the full teal fill. */}
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void runNext()}
          className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 px-3 py-1.5 text-sm font-medium text-primary transition hover:bg-primary/10 disabled:opacity-50"
        >
          {busy === "next" ? "Resolving..." : "→ Next"}
        </button>
      </div>

      {composing ? (
        <div className="space-y-2 rounded-md border border-border bg-background p-3">
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={`Feedback on ${item.ref}...`}
            className="min-h-20 w-full rounded-md border border-input bg-card p-2 text-sm"
          />
          <input
            value={refs}
            onChange={(event) => setRefs(event.target.value)}
            placeholder="Refs (optional) — ADR / scenario / commit"
            className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
          />
          <div className="flex justify-end">
            <button
              type="button"
              disabled={!note.trim() || busy !== null}
              onClick={() => void submitFeedback()}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
              {busy === "feedback" ? "Adding..." : "Submit"}
            </button>
          </div>
        </div>
      ) : null}

      <ResultLine result={result} onRevealRef={onRevealRef} />
    </div>
  );
}

function ResultLine({ result, onRevealRef }: { result: ActionResult; onRevealRef: (ref: string) => void }) {
  if (result.kind === "none") return null;

  if (result.kind === "error") {
    return <p className="mono text-xs text-accent">✕ {result.message}</p>;
  }
  if (result.kind === "feedback-ok") {
    return <p className="mono text-xs text-primary">✓ Feedback added</p>;
  }

  if (result.kind === "validate") {
    if (result.findings.length === 0) {
      return (
        <p className="mono text-xs text-primary">
          ✓ Validated {result.scope} — no issues (folder↔frontmatter · tags · depends graph)
        </p>
      );
    }
    return (
      <div className="space-y-1 rounded-md border border-border bg-background p-2">
        <p className="mono text-xs font-semibold text-accent">
          ✕ Validated {result.scope} — {result.findings.length} issue{result.findings.length === 1 ? "" : "s"}
        </p>
        {result.findings.map((finding) => (
          <p key={`${finding.path}-${finding.problem}`} className="mono text-xs text-accent">
            <span className="text-muted-foreground">{finding.path}</span> · {finding.problem}
          </p>
        ))}
      </div>
    );
  }

  // next
  const next = result.next;
  if (next.state === "done") return <p className="mono text-xs text-primary">✓ Stream complete</p>;
  if (next.state === "blocked") {
    const waiting = (next.waitingOn ?? []).join(", ");
    return (
      <p className="mono text-xs text-accent">
        Blocked{next.ref ? ` at ${next.ref}` : ""} — waiting on {waiting}
      </p>
    );
  }
  // ready
  return (
    <p className="mono flex flex-wrap items-center gap-2 text-xs">
      <span className="text-primary">→ Next: {next.ref}</span>
      {next.ref ? (
        <button
          type="button"
          onClick={() => onRevealRef(next.ref!)}
          className="rounded border border-input bg-background px-2 py-0.5 text-[11px] font-medium transition hover:border-primary/50"
        >
          Reveal in board
        </button>
      ) : null}
    </p>
  );
}
