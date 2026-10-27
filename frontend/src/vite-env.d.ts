/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the deployed backend; leave unset in development to use the Vite proxy. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
