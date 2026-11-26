// A short hint on the operator's phone through ntfy (https://ntfy.sh; the ntfy app subscribes to one topic), in
// addition to the mail and the notification in the Admin organization: a message through the website's contact form,
// a new registration, the API's own monitor. Optional: NTFY_TOPIC_URL (e.g. https://ntfy.sh/apensum-<random>, or the
// topic alone for one on ntfy.sh; a GitHub secret: whoever knows a public topic reads and writes it), unset = nothing.
//
// The public server is not in Switzerland: a push never carries personal data (no names, addresses or texts of
// people), only what happened; the details stay in the mail and in Apensum. Best effort: it never fails a request.

export interface OperatorPush {
  title: string;
  message: string;
  /** Opened when the push is tapped (e.g. the app). */
  click?: string;
  /** ntfy's emoji tags, e.g. `incoming_envelope`. */
  tags?: string[];
  /** 1 (min) to 5 (max); 3 is the default. */
  priority?: 1 | 2 | 3 | 4 | 5;
}

/** The request ntfy's JSON publishing takes (`POST <server>/` with the topic in the body: UTF-8 titles stay intact). */
export function ntfyRequest(topicUrl: string, push: OperatorPush): { url: string; body: Record<string, unknown> } | null {
  // A topic name alone is a topic on the public server.
  const value = /^[-_A-Za-z0-9]{1,64}$/.test(topicUrl) ? `https://ntfy.sh/${topicUrl}` : topicUrl;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  const topic = parsed.pathname.replace(/^\/+|\/+$/g, '');
  if (!/^https?:$/.test(parsed.protocol) || !/^[-_A-Za-z0-9]{1,64}$/.test(topic)) return null;
  return {
    url: `${parsed.origin}/`,
    body: {
      topic,
      title: push.title.slice(0, 120),
      message: push.message.slice(0, 1000),
      ...(push.click ? { click: push.click } : {}),
      ...(push.tags?.length ? { tags: push.tags } : {}),
      ...(push.priority ? { priority: push.priority } : {}),
    },
  };
}

/** Sends the push when NTFY_TOPIC_URL is set; true when ntfy accepted it. Never throws. */
export async function pushToOperator(
  push: OperatorPush,
  env: NodeJS.ProcessEnv = process.env,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  const topicUrl = (env.NTFY_TOPIC_URL ?? '').trim();
  if (!topicUrl) return false;
  const request = ntfyRequest(topicUrl, push);
  if (!request) {
    console.warn('operator push: NTFY_TOPIC_URL is neither a topic URL (https://<server>/<topic>) nor a topic name');
    return false;
  }
  try {
    const res = await fetchFn(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.warn(`operator push: ntfy answered ${res.status}`);
    return res.ok;
  } catch (err) {
    console.warn(`operator push failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}
