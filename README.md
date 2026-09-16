<p align="center">
  <img src="client/public/assets/logo.svg" height="200" alt="NuAI logo">
</p>

<h1 align="center">NuAI</h1>

<p align="center">
  Neumann Steel's internal AI chat platform — for work use only.
</p>

---

## About

NuAI is Neumann Steel's company-operated AI assistant, provided to employees, contractors, and other authorized personnel for business use. It is built on [LibreChat](https://librechat.ai) (open source, MIT licensed) and customized with Neumann Steel's branding, endpoint configuration, and access policies.

Access is provisioned through single sign-on with your Company email account. NuAI is a business tool only — see the in-app Terms of Use and Privacy Policy for permitted use, role-based model access, data handling, and monitoring policies.

## Development

This is a monorepo. See [CLAUDE.md](CLAUDE.md) for the full workspace layout, coding conventions, and branching/PR process.

| Command | Purpose |
|---|---|
| `npm run smart-reinstall` | Install deps (if lockfile changed) + build via Turborepo |
| `npm run reinstall` | Clean install — wipe `node_modules` and reinstall from scratch |
| `npm run backend` | Start the backend server |
| `npm run backend:dev` | Start backend with file watching (development) |
| `npm run build` | Build all compiled code via Turborepo (parallel, cached) |
| `npm run frontend:dev` | Start frontend dev server with HMR (port 3090, requires backend running) |
| `npm run build:data-provider` | Rebuild `packages/data-provider` after changes |

- Node.js: v24.16.0
- Database: MongoDB
- Backend: `http://localhost:3080/`
- Frontend dev server: `http://localhost:3090/`

## Configuration

- `librechat.yaml` (untracked, local) — the active runtime configuration for this deployment. See [`librechat.nuai.example.yaml`](librechat.nuai.example.yaml) for the tracked, documented template it's kept in sync with.
- `.env` (untracked, local) — secrets and environment-specific values. See [`.env.example`](.env.example) for the tracked template.

Never commit real API keys, base URLs, or other secrets to either example file — keep those in the local, untracked `.env`/`librechat.yaml` only.

## License

NuAI is built on [LibreChat](https://github.com/danny-avila/LibreChat), distributed under the [MIT License](LICENSE).
