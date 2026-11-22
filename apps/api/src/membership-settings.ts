/**
 * `organization_memberships.settings` holds the person's calendar feed, whose token alone opens the feed
 * (calendar-feed.service.ts): only that service returns it, to that person. Everything else that returns,
 * audits or takes these settings goes through here.
 */

const FEED = 'calendar_feed';

function plain(settings: unknown): Record<string, unknown> {
  return settings && typeof settings === 'object' && !Array.isArray(settings) ? { ...(settings as Record<string, unknown>) } : {};
}

/** The settings as others may see them, and as they may come from a client: without the feed. */
export function withoutFeed(settings: unknown): Record<string, unknown> {
  const { [FEED]: _feed, ...rest } = plain(settings);
  return rest;
}

/** What to store when someone replaces the settings: theirs, with the person's own feed as it was. */
export function keepingFeed(incoming: unknown, stored: unknown): Record<string, unknown> {
  const feed = plain(stored)[FEED];
  return { ...withoutFeed(incoming), ...(feed === undefined ? {} : { [FEED]: feed }) };
}
