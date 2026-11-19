/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BUILD_RELEASE?: string;
  readonly VITE_BUILD_COMMIT?: string;
  readonly VITE_BUILD_DATE?: string;
  /** The product website ("More about Apensum"); default https://www.apensum.ch. */
  readonly VITE_INFO_URL?: string;
}

/** The installed plugins' web entries (vite.config.ts, apensumPlugins). */
declare module 'virtual:apensum-plugins' {
  import type { WebPlugin } from './plugin';
  const plugins: WebPlugin[];
  export default plugins;
}
