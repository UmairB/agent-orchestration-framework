/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AOF_UI_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
