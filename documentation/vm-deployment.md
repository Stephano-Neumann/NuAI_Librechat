# Deploying NuAI on a Company Server VM

This guide walks through running NuAI (this repository) as a persistent, shared
service on a VM inside the company network, using Docker Compose — the same
mechanism already set up for local development (`docker-compose.yml` +
`docker-compose.override.yml`).

It does **not** cover Kubernetes/Helm (the `helm/` folder in this repo targets a
different deployment model) or SSO (see [`sso-setup.md`](sso-setup.md)).

## 1. What gets deployed

`docker compose up` (base file + our override) starts:

| Service | Purpose | Exposed to host? |
|---|---|---|
| `api` | NuAI itself — built from source in this repo (`docker-compose.override.yml`), NuAI branding/theme baked in | Yes, on `${PORT}` (default `3080`) |
| `admin-panel` | Browser-based admin UI (users, roles, config overrides) | Yes, on `${ADMIN_PANEL_PORT}` (default `3000`) |
| `mongodb` | Primary database (conversations, users, config) | No (internal network only) |
| `meilisearch` | Message/conversation search index | No |
| `vectordb` (pgvector) + `rag_api` | File search / RAG embeddings store | No |

Unlike `deploy-compose.yml` (which pulls prebuilt upstream images and fronts
everything with nginx), our `docker-compose.override.yml` deliberately builds
the `api` image from this repo's source so the NuAI branding, theme, and
`librechat.yaml` customizations are actually included. Keep using
`docker-compose.yml` + `docker-compose.override.yml` — not `deploy-compose.yml`
— for this deployment.

## 2. Prerequisites

- A VM on the company network, reachable by the people who'll use it.
  - Recommended minimum: 4 vCPU / 8 GB RAM / 50 GB disk. Increase disk if you
    expect large file uploads or a long chat/conversation retention window.
  - Linux (e.g. Ubuntu Server 22.04/24.04 LTS) is assumed below. A Windows
    Server host with Docker Desktop/Engine works too, but path and service
    commands will differ.
- Docker Engine and the Docker Compose plugin installed on the VM.
- Network/firewall access to:
  - Pull base images and npm packages during the build (or a company proxy —
    see `PROXY`/`HTTP_PROXY` in `.env.example` if outbound internet is
    restricted).
  - Whatever model provider endpoints `librechat.yaml` points at (e.g.
    Anthropic, the Azure AI Foundry "Ethan library" once wired up).
- Access to this git repository from the VM (clone over your normal internal
  git remote/credentials).
- An `ANTHROPIC_API_KEY` (or whichever provider keys `ENDPOINTS` in `.env`
  lists) and any other secrets the deployment needs, obtained out-of-band —
  never stored in this repo.

## 3. Install Docker on the VM

```bash
# Ubuntu/Debian example — see docs.docker.com for other distros
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
# log out/in (or `newgrp docker`) for the group change to take effect
docker compose version   # confirm the Compose plugin is present
```

Enable Docker to start on boot (containers are already `restart: always`, but
the daemon itself needs to survive a reboot):

```bash
sudo systemctl enable --now docker
```

## 4. Get the code onto the VM

```bash
git clone <your-internal-remote-url> nuai-librechat
cd nuai-librechat
git checkout main   # or whichever branch you deploy from
```

Treat this checkout as the deployment's source of truth — pull and rebuild to
update (§9), rather than editing files directly on the VM.

## 5. Configure `.env`

`.env` is gitignored on purpose (it holds secrets) — it does not come with the
clone. Create it from the tracked template and fill it in:

```bash
cp .env.example .env
```

At minimum, review/set these before starting the stack:

- **`PORT`** — leave at `3080` unless it conflicts with something else on the
  VM.
- **`DOMAIN_CLIENT`** / **`DOMAIN_SERVER`** — set both to the URL people will
  actually use (e.g. `https://nuai.neumann-steel.example` once you have a
  reverse proxy + TLS in front — see §8; `http://<vm-ip>:3080` if you're
  starting without one). These drive redirect URLs and cookie behavior.
- **Persistent secrets** — `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CREDS_KEY`,
  `CREDS_IV`, `MEILI_MASTER_KEY`. Leaving these blank lets LibreChat generate
  *temporary* values on each start, which is fine for a laptop but not for a
  shared server (sessions/encrypted credentials break on every restart).
  Generate real ones once and keep them fixed:

  ```bash
  openssl rand -hex 32   # JWT_SECRET
  openssl rand -hex 32   # JWT_REFRESH_SECRET
  openssl rand -hex 32   # CREDS_KEY
  openssl rand -hex 16   # CREDS_IV
  openssl rand -hex 32   # MEILI_MASTER_KEY
  ```

- **`ADMIN_PANEL_SESSION_SECRET`** — same idea; generate a fixed value with
  `openssl rand -hex 32` if it isn't already set.
- **`UID` / `GID`** — on Linux, uncomment and set these to the host user that
  should own the bind-mounted data directories (`id -u`, `id -g`), so upload
  and log files aren't root-owned.
- **`ENDPOINTS`** and provider API keys — match what `librechat.yaml` expects
  (see §6). Get real keys from your provider/IT, not from this repo.
- **`ALLOW_REGISTRATION`** — consider setting to `false` once SSO is the only
  way in (see `sso-setup.md`), so accounts aren't created outside SSO.

Never commit `.env`. If you need to hand structural changes off to the tracked
template, edit `.env.example` the same way we already do for this repo (var
names and comments only, never real values).

## 6. Configure `librechat.yaml`

Also gitignored, also created from a tracked template — but here the tracked
template is `librechat.nuai.example.yaml`, which we keep byte-for-byte in sync
with what actually runs:

```bash
cp librechat.nuai.example.yaml librechat.yaml
```

Review it for anything still marked `TODO` (real Azure Foundry instance name,
the `NuAI` custom endpoint's `apiKey`/`baseURL` once Phase 2 wires it up,
Legal-approved privacy policy / terms URLs, etc.) before this goes in front of
the whole company. `docker-compose.yml`/`docker-compose.override.yml` already
bind-mount `./librechat.yaml` into the container, so edits take effect on the
next `docker compose restart api` — no rebuild needed for YAML-only changes.

## 7. Build and start the stack

```bash
docker compose build
docker compose up -d
docker compose ps            # all services should be "running"/"healthy"
docker compose logs -f api   # watch startup, Ctrl+C to stop tailing
```

`docker compose` automatically picks up `docker-compose.yml` +
`docker-compose.override.yml` together — no extra flag needed.

Once it's up, confirm it loads locally on the VM:

```bash
curl -I http://localhost:3080
```

## 8. Put it behind a domain and TLS (recommended)

For anything beyond a quick internal test, don't hand people
`http://<vm-ip>:3080` directly. Put a reverse proxy in front that terminates
TLS on your internal domain, and forward to the container:

```nginx
server {
    listen 443 ssl;
    server_name nuai.neumann-steel.example;   # replace with your real internal domain

    ssl_certificate     /etc/ssl/certs/nuai.crt;
    ssl_certificate_key /etc/ssl/private/nuai.key;

    location / {
        proxy_pass http://127.0.0.1:3080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

After this is in place:
- Update `DOMAIN_CLIENT`/`DOMAIN_SERVER` in `.env` to the real
  `https://nuai.neumann-steel.example` URL and `docker compose restart api`.
- `TRUST_PROXY` in `.env.example` already defaults to `1`, which is correct
  for a single reverse proxy hop in front.
- Only expose 80/443 (or whatever your proxy listens on) to the rest of the
  company network; keep 3080 and 3000 bound to `localhost`/internal-only via
  your firewall, since the proxy is now the only intended entry point.

If your company already has standard reverse-proxy/TLS infrastructure (an
internal load balancer, IIS, an existing nginx/Caddy fleet), use that instead
of a bespoke nginx container — the requirement is just "TLS-terminating proxy
in front of port 3080."

## 9. Firewall checklist

- **Allow**: inbound 443 (or your chosen proxy port) from the company network.
- **Allow**: outbound to your model provider(s) and, if used, your package
  registry/proxy.
- **Block**: direct inbound access to 3080/3000 from outside the VM once the
  reverse proxy is in place (bind them to `127.0.0.1` in
  `docker-compose.override.yml` or restrict at the host firewall).
- MongoDB, Meilisearch, and the vector DB already have no host port mappings
  by default in `docker-compose.yml` — leave the commented-out `ports:` lines
  in those services commented out.

## 10. Persistent data and backups

These are bind-mounted from the repo checkout on the VM — back them up as part
of your normal VM/server backup routine:

| Path | Contains |
|---|---|
| `./data-node` | MongoDB data files |
| `./meili_data_v1.35.1` | Meilisearch index |
| `./uploads`, `./images` | User-uploaded and generated files |
| `./logs` | Application logs |
| `librechat-data` (named Docker volume) | Temporary generated credentials (`.env.temp`) if `CREDS_KEY`/`JWT_SECRET` etc. were left blank — another reason to set real values in §5 |

`.env` and `librechat.yaml` themselves live outside these mounts (in the repo
checkout) — include them in your backup too, since they're not in git.

## 11. Updating the deployment

Because the `api` image is built from source (not pulled), updates are a
rebuild, not a `docker compose pull`:

```bash
git pull
diff librechat.nuai.example.yaml librechat.yaml   # review structural changes before merging by hand
diff .env.example .env                            # same, for new/changed env vars
docker compose build
docker compose up -d
```

Since `librechat.yaml` and `.env` are gitignored local files, `git pull` never
touches them directly — merge structural changes from the example files in by
hand, the same way we've been keeping `librechat.nuai.example.yaml` in sync
with `librechat.yaml` in this repo.

## 12. Troubleshooting

- **Container restarts in a loop** — `docker compose logs api` almost always
  shows a config validation error (bad `librechat.yaml`, missing required
  `.env` value) near the top of the log.
- **"port is already allocated"** — something else on the VM is using 3080 or
  3000; change `PORT`/`ADMIN_PANEL_PORT` in `.env` or free the port.
  Anthropic timeouts / model errors — usually blocked outbound access; check
  the firewall/proxy rules in §9 and the `PROXY`/`HTTP_PROXY` vars in `.env`.
- **Uploads/logs owned by `root` and unwritable from the host** — set
  `UID`/`GID` in `.env` (§5) to match the host user and recreate the
  containers: `docker compose up -d --force-recreate`.
- **Users can log in but the model doesn't work** — check `ENDPOINTS` in
  `.env` and the corresponding section of `librechat.yaml`; the `NuAI` custom
  endpoint in particular is a visible placeholder until Phase 2 wires it to a
  real model (see the comments in `librechat.yaml` above the `custom:` entry).
