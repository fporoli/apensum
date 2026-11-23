// A new version of the web app on the server: every build gives the main file a new hashed name
// (/assets/index-<hash>.js), which the start page (index.html) references. The running app compares
// the one it was loaded with to the one the server's start page names now (UpdateNotice.tsx).

/** The main file a start page references, or null (none: a development server, or not our page). */
export function mainScriptOf(html: string): string | null {
  const m = /<script[^>]+src="(\/assets\/index-[^"]+\.js)"/.exec(html);
  return m ? m[1] : null;
}

/** Whether the server's start page names another main file than the running one. */
export function isNewVersion(runningScript: string | null, serverHtml: string): boolean {
  if (!runningScript) return false;
  const server = mainScriptOf(serverHtml);
  return server !== null && server !== runningScript;
}
