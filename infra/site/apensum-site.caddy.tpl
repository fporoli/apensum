# The website's block on the shared edge Caddy. infra/site/remote.sh renders it to
# /opt/edge/sites/apensum-site.caddy (filling in the domain) and reloads Caddy. Do not edit the
# rendered copy on the VPS. Both names need a DNS record pointing at this server for the
# certificates (Let's Encrypt) to be issued.
__SITE_HOST__ {
	reverse_proxy apensum-site:80
}
www.__SITE_HOST__ {
	redir https://__SITE_HOST__{uri} permanent
}
