// Renders a markdown string as HTML for the detail panel's doc tabs.
//
// TRUST MODEL — read before touching this. The `source` is the operator's OWN
// local work docs (SPEC/STORY/VERIFICATION etc.) read off their own disk and
// served by their own board over 127.0.0.1 — single-user, same-origin, fully
// trusted. There is NO untrusted/third-party content path here, so this renders
// `marked.parse` output via dangerouslySetInnerHTML WITHOUT sanitization, by
// design. (A previous `<script>`-only strip was deliberately removed: it read as
// protection while doing nothing against `<img onerror=…>`, `javascript:` hrefs,
// `<iframe>`, etc. — a half-defense is worse than an explicit none.) If this ever
// renders content from another origin or another user, add a real sanitizer
// (e.g. DOMPurify) here — do NOT re-add a partial regex strip.
//
// Callers pass the ALREADY frontmatter/comment-stripped body (see cleanDoc in
// DetailPanel) — this component only does markdown → HTML.
import { useMemo } from "react";
import { marked } from "marked";

// GFM on (tables, etc.); synchronous parse so we can render inline.
marked.setOptions({ gfm: true, breaks: false });

function renderHtml(source: string): string {
  // Trusted local same-origin doc files — no sanitization (see trust model above).
  return marked.parse(source, { async: false }) as string;
}

export function Markdown({ source }: { source: string }) {
  const html = useMemo(() => renderHtml(source), [source]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
