// Renders a markdown string as HTML for the detail panel's doc tabs.
//
// The `source` is the operator's OWN local work docs (SPEC/STORY/VERIFICATION
// etc.) served from the board over localhost — single-user, trusted, same-origin.
// In that context `dangerouslySetInnerHTML` on `marked.parse` output is
// acceptable; we are not rendering untrusted third-party content. As a cheap,
// belt-and-braces defense we still strip any <script> blocks before setting.
//
// Callers pass the ALREADY frontmatter/comment-stripped body (see cleanDoc in
// DetailPanel) — this component only does markdown → HTML.
import { useMemo } from "react";
import { marked } from "marked";

// GFM on (tables, etc.); synchronous parse so we can render inline.
marked.setOptions({ gfm: true, breaks: false });

function renderHtml(source: string): string {
  const html = marked.parse(source, { async: false }) as string;
  // Strip <script>...</script> (and bare <script .../>) as a cheap defense.
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<script\b[^>]*\/?>/gi, "");
}

export function Markdown({ source }: { source: string }) {
  const html = useMemo(() => renderHtml(source), [source]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
