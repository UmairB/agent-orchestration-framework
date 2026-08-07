/// <reference types="vite/client" />

// `VITE_AOF_UI_MODE` was declared here and is RETIRED with the query selector it fed
// (milestone 45 / ADR-002). It was set in exactly one place (src/commands/assets-ui.mjs) and
// was a build-time constant that is undefined in the shipped bundle; keeping it would have
// given the route decision two inputs — a URL and a baked env var — which is the
// two-homes-for-one-fact shape this milestone exists to remove. The address bar is the one
// input now.
