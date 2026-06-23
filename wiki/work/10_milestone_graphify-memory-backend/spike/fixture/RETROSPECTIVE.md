---
doc: retrospective
---
# Spike Fixture · Retrospective

A minimal RETROSPECTIVE shaped like the real `wiki/work/**` lessons so the LLM
pass has prose to extract. Two lesson entries with the canonical meta line.

## R1 · Pin line endings for content-addressed hashes

- **Kind:** near-miss · **Area:** architecture · **Stage:** build · **Owner:** dev

A content-addressed asset hash diverged between Windows and Linux because git
normalised line endings on checkout. The fix was to pin `* -text` in
`.gitattributes` so the bytes that are hashed are identical on every platform.
Carry: any hash over text must fix the newline convention before hashing.

## R2 · Fitness functions must assert a symbol, not grep a string

- **Kind:** smell · **Area:** testing · **Stage:** verify · **Owner:** architect

An early fitness function grepped for a literal substring, so a renamed function
silently passed. Replacing the grep with an AST symbol assertion made the test
track the real invariant. Carry: a fitness function that greps text is a smell;
assert the parsed symbol instead.
