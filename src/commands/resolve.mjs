// Ref → item resolvers, shared by the work commands (ADR-002/003). Moved out of
// `board-ui.mjs` so the read-vs-write resolver distinction lives IN the command
// core and BOTH faces inherit it (neither face can weaken it).
//
// The load-bearing distinction (ADR-003): a READ (doc/tasks) may slug-match a
// free-text ref (`resolveItem`), but the WRITE (feedback) must resolve by EXACT
// ref only (`resolveItemExact`) — a typo'd/partial ref returns null rather than
// silently appending the bullet to the first free-text slug match (the wrong
// item). `findWork` already returns slug matches for free text, so the two
// resolvers differ only in their fallback.
import { findWork } from "../work.mjs";

// Resolve an item by ref to its row (native-path `dir` + ref/type) via findWork —
// the canonical resolver. Returns null when nothing resolves. Used by the
// READ commands (doc/tasks), where a free-text slug fallback is acceptable.
export async function resolveItem(workDir, ref) {
  if (!ref) return null;
  const rows = await findWork(workDir, ref);
  // Prefer an exact ref match; findWork can return slug matches for free text.
  return rows.find((row) => row.ref === ref) ?? rows[0] ?? null;
}

// EXACT-ref resolver for the WRITE command (feedback): there is NO slug fallback,
// so a typo'd/partial ref returns null (→ ref-not-found) rather than appending
// the bullet to the first free-text slug match (the wrong item).
export async function resolveItemExact(workDir, ref) {
  if (!ref) return null;
  const rows = await findWork(workDir, ref);
  return rows.find((row) => row.ref === ref) ?? null;
}
