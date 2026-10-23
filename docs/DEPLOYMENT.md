# Deployment

SpectraStage is one Node.js process that serves the web app, the REST API and the WebSocket
(`/ws`) on a single port (default 3000) and stores everything in one SQLite file under `/data`.
Run exactly **one** instance per database (no horizontal scaling in v1 – that would need a shared
pub/sub and state store).

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PUBLIC_URL` | – | Public origin, e.g. `https://show.example.com`. Enables the WebSocket `Origin` check. **Set it in production.** |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Listen address |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-*` from the reverse proxy (Easypanel/Traefik, Nginx, Caddy) |
| `CLOUDFLARE` | `false` | Use `CF-Connecting-IP` as client IP for rate limits. Only enable behind Cloudflare. |
| `DATABASE_PATH` | `/data/spectrastage.db` (image) | SQLite file (WAL mode) |
| `SESSION_TTL_DAYS` | `0` | Delete shows inactive for N days; `0` = keep forever |
| `MAX_SESSIONS` | `20000` | Global cap on stored shows (abuse protection on a public instance) |
| `MAX_DEVICES_PER_SESSION` | `16` | Projector PCs per show |
| `PAIRING_CODE_TTL_MINUTES` | `15` | Validity of a pairing code |
| `LOG_LEVEL` | `info` | pino log level; tokens and auth headers are never logged |

## Easypanel + Cloudflare (recommended for this project)

1. **Push the repository** to your Git host (the repo is committed locally only).
2. In Easypanel create a project → **App** service → *Source*: your repository, *Build*: **Dockerfile** (path `Dockerfile`).
3. **Environment**:
   ```
   PUBLIC_URL=https://show.example.com
   TRUST_PROXY=true
   CLOUDFLARE=true
   ```
4. **Mounts** → add a *Volume* mounted at `/data` (this is where the SQLite database lives; without it every deploy starts empty).
5. **Domains** → add `show.example.com`, target port **3000**, HTTPS on. Easypanel's Traefik handles WebSocket upgrades automatically.
6. Deploy. The container has a health check (`/api/health`); Easypanel shows it as healthy after ~10 s.

### Cloudflare settings

- DNS record for the domain: **proxied** (orange cloud).
- SSL/TLS mode: **Full (strict)** (Easypanel provides a valid certificate; alternatively install a Cloudflare Origin Certificate in Easypanel).
- Network → **WebSockets: On** (default).
- Do **not** enable Rocket Loader (it rewrites scripts and breaks the strict Content-Security-Policy).
- Caching: the app sends `Cache-Control: no-cache` for HTML and the service worker and immutable caching for `/assets/*`; API and `/ws` are never cached. No extra cache rules are needed. If you add a "Cache Everything" rule, exclude `/api/*`, `/ws` and `/sw.js`.
- Cloudflare closes idle WebSockets after 100 s; SpectraStage pings every 5 s (client) and 20 s (server), so connections stay open.
- Recommended: restrict the origin so it only accepts traffic from Cloudflare (Easypanel firewall / provider firewall with Cloudflare IP ranges). Otherwise a client talking to the origin directly could spoof `CF-Connecting-IP` to dodge rate limits (it cannot gain any access, see the threat model).

### Updating

Redeploy in Easypanel. Migrations run automatically on start; the volume keeps all shows,
calibrations and paired devices. Projector PCs reconnect automatically (exponential backoff) and
pick up the new web app version on the next reload; running animations continue meanwhile.

## Generic Docker host

```bash
cp .env.example .env    # adjust PUBLIC_URL etc.
docker compose up --build -d
docker compose logs -f
```

`compose.yaml` binds to `127.0.0.1:3000`; put a TLS reverse proxy in front.

**Caddy**
```
show.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

**Nginx**
```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_read_timeout 120s;
  proxy_send_timeout 120s;
  client_max_body_size 512k;
}
```

HTTPS is required in production: browsers only allow the service worker, wake lock and reliable
audio/fullscreen behaviour in a secure context.

## Backup & restore

- **Per show**: Controller → *More* → *Export show* (JSON with surfaces, outputs incl. calibration profiles, playlists, creature settings). *Import show* restores it into the current show (owner only).
- **Whole server**: copy the volume. With the container stopped: `docker run --rm -v spectrastage-data:/data -v $PWD:/backup alpine tar czf /backup/spectrastage-data.tgz /data`. For a hot backup use `sqlite3 /data/spectrastage.db ".backup /data/backup.db"`.

## Shutdown

`SIGTERM` closes all WebSockets with code 1001, stops the HTTP server and closes the database
(10 s hard limit). Clients reconnect automatically when the new container is up.
