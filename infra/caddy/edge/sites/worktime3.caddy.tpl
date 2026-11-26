# Template for one worktime3 instance's site block on the shared edge Caddy. Not served as
# is: infra/vps/remote.sh renders it to /opt/edge/sites/<prefix>.caddy on every deploy,
# filling in the instance's hostnames and container prefix, then reloads Caddy. Do not edit
# the rendered copy on the VPS; it gets overwritten. Edit this file instead.
#
# Proxies to the containers by their explicit container_name (not the bare service name):
# the edge Caddy only sees them over the shared "edge" network, where a bare service name
# alias would collide between instances and with other projects' same-named services (e.g.
# worktime2 also has a service called "api"). The prefix keeps every instance's names unique.
#
# Security headers. The app (no inline scripts; MUI's styles are inline, hence style-src 'unsafe-inline') may load and
# connect only to itself, its API (REST and the notifications' WebSocket) and its sign-on host; it is never framed by
# another site; HTTPS only. Frames and objects may show blob: URLs the app made itself (a document's preview, a PDF
# in the browser's viewer); nothing else. The session is in localStorage, so the CSP is what stops injected script from reaching it.
__WEB_HOST__ {
  header {
    Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://__API_HOST__; font-src 'self' data:; connect-src 'self' https://__API_HOST__ wss://__API_HOST__ https://__AUTH_HOST__; media-src 'self' blob:; worker-src 'self'; frame-src https://__AUTH_HOST__ blob:; frame-ancestors 'none'; form-action 'self' https://__AUTH_HOST__; base-uri 'self'; object-src blob:"
    Strict-Transport-Security "max-age=31536000"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "strict-origin-when-cross-origin"
    Permissions-Policy "camera=(self), microphone=(self), display-capture=(self), geolocation=()"
  }
  reverse_proxy __PREFIX__-web:80
}
__API_HOST__ {
  header {
    Strict-Transport-Security "max-age=31536000"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "strict-origin-when-cross-origin"
    X-Frame-Options "DENY"
  }
  reverse_proxy __PREFIX__-api:8000
}
# The single sign-on host (AUTH_SUB) is appended by remote.sh when the instance has one (SSO_PROVIDER).
