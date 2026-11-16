# The website's block on the shared edge Caddy. infra/site/remote.sh renders it to
# /opt/edge/sites/<SITE_NAME>.caddy (filling in the host and the site container) and reloads Caddy.
# Do not edit the rendered copy on the VPS. Every name needs a DNS record pointing at this server
# for the certificates (Let's Encrypt) to be issued. remote.sh appends the www. redirect for the
# main domain and marks previews noindex.
__SITE_HOST__ {
	reverse_proxy __SITE_NAME__:80
	__PREVIEW__ header X-Robots-Tag "noindex, nofollow"
}
