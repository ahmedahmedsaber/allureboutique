# ALLURE Boutique — serves the shop and the owner dashboard as static files with Caddy.
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY index.html admin.html styles.css admin.css app.js admin.js api.js config.js i18n.js i18n.ar.js /srv/
COPY assets /srv/assets
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
