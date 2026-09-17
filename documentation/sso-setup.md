# Setting Up Single Sign-On (SSO) for NuAI

NuAI's Terms of Use already promise SSO with your Company email account
("Access to NuAI is granted exclusively to individuals authorized by Neumann
Steel and is provisioned through single sign-on (SSO)..."). This guide sets
that up.

This repo's `.env.example` also scaffolds SharePoint file-picker and
Microsoft Graph people-search integration, both of which require Entra ID
(Azure AD) authentication. For a Neumann Steel deployment, **OpenID Connect
against Microsoft Entra ID is the recommended and primary path** below. Other
providers LibreChat supports (SAML, Google, GitHub, Discord, Facebook, Apple,
LDAP) use the same on/off mechanism — see §6 if you need one of those instead
of or alongside Entra ID.

## 1. How LibreChat's SSO switch works

Two things both have to be true for an SSO button to appear on the login
page:

1. `librechat.yaml` → `registration.socialLogins` lists the provider. This
   repo's `librechat.nuai.example.yaml` / `librechat.yaml` already include
   `'openid'` and `'saml'` (among others) — no change needed here.
2. The provider's env vars are filled in, in `.env`, **and**
   `ALLOW_SOCIAL_LOGIN=true`.

So the work below is entirely in Entra ID (to create the app registration)
and `.env` (to point NuAI at it) — not in `librechat.yaml`.

## 2. Register NuAI as an app in Microsoft Entra ID

You'll need Application Administrator (or equivalent) rights in the Neumann
Steel Entra ID tenant.

1. Go to **Azure Portal → Microsoft Entra ID → App registrations → New
   registration**.
2. **Name**: `NuAI` (or similar — this is just the label admins see in Entra
   ID).
3. **Supported account types**: "Accounts in this organizational directory
   only" (single tenant) — this keeps sign-in scoped to Neumann Steel.
4. **Redirect URI**: platform **Web**, value
   `https://<your-nuai-domain>/oauth/openid/callback`
   (matches `OPENID_CALLBACK_URL` in `.env.example`, which defaults to
   `/oauth/openid/callback`).
5. If you'll also use the separate Admin Panel's own SSO login, add a second
   redirect URI:
   `https://<your-nuai-domain>/api/admin/oauth/openid/callback`.
6. Register, then note down from the app's **Overview** page:
   - **Application (client) ID**
   - **Directory (tenant) ID**
7. **Certificates & secrets → New client secret** — create one, and copy the
   **Value** immediately (Azure only shows it once). This becomes
   `OPENID_CLIENT_SECRET`.
8. **API permissions → Add a permission → Microsoft Graph → Delegated
   permissions** — add at minimum `openid`, `profile`, `email`. If you plan to
   enable the SharePoint file picker or Graph-based people search later, also
   add the scopes listed in `OPENID_GRAPH_SCOPES` / `GRAPH_API_SCOPES` in
   `.env.example` (e.g. `User.Read`, `People.Read`,
   `GroupMember.Read.All`, `Files.Read.All`) — grant admin consent for the
   tenant if the permissions require it.

## 3. Configure `.env`

In the deployment's `.env` (see `vm-deployment.md` §5 for where this lives —
never commit real values to `.env.example`):

```bash
OPENID_CLIENT_ID=<Application (client) ID from step 2>
OPENID_CLIENT_SECRET=<client secret value from step 2>
OPENID_ISSUER=https://login.microsoftonline.com/<Directory (tenant) ID>/v2.0
OPENID_SESSION_SECRET=<generate with: openssl rand -hex 32>
OPENID_SCOPE="openid profile email"
OPENID_CALLBACK_URL=/oauth/openid/callback
OPENID_BUTTON_LABEL="Sign in with Neumann Steel"
```

`OPENID_ISSUER` must be the exact OIDC issuer LibreChat runs discovery
against (`<issuer>/.well-known/openid-configuration` must resolve) — the
`.../v2.0` tenant URL above is the standard Entra ID v2 issuer.

Then decide the account-provisioning and login policy:

```bash
ALLOW_SOCIAL_LOGIN=true
ALLOW_SOCIAL_REGISTRATION=true   # first-time SSO sign-in auto-creates the NuAI account
```

If you'd rather pre-provision accounts and only let existing ones sign in via
SSO, set `ALLOW_SOCIAL_REGISTRATION=false` instead.

To make Entra ID the *only* way in (no local email/password accounts), also
set in `.env`:

```bash
ALLOW_EMAIL_LOGIN=false
ALLOW_REGISTRATION=false
OPENID_AUTO_REDIRECT=true   # skip the login page entirely, go straight to Entra ID
```

Restart the stack to pick this up:

```bash
docker compose restart api
```

## 4. Restrict sign-in to Neumann Steel email addresses

Even with single-tenant Entra ID, add a belt-and-suspenders restriction in
`librechat.yaml` so no other email domain can register, by uncommenting and
setting `registration.allowedDomains`:

```yaml
registration:
  socialLogins: ['github', 'google', 'discord', 'openid', 'facebook', 'apple', 'saml']
  allowedDomains:
    - 'neumann-steel.example'   # replace with the real company email domain(s)
```

(Keep `librechat.nuai.example.yaml` in sync with this change, the same way we
already do for other structural `librechat.yaml` edits — variable names and
structure only, no real domain if that's considered sensitive; use your
judgment for an internal domain name.)

## 5. Test the flow

1. `docker compose restart api` (or `up -d` if you also changed
   `librechat.yaml`, which doesn't need a rebuild — see `vm-deployment.md`
   §6).
2. Visit the NuAI login page. You should see a "Sign in with Neumann Steel"
   (or whatever `OPENID_BUTTON_LABEL` says) button — or land directly on the
   Entra ID login page if `OPENID_AUTO_REDIRECT=true`.
3. Sign in with a real Neumann Steel account and confirm you land back in
   NuAI, logged in.
4. Check `docker compose logs -f api` if it fails — the two most common
   issues are a **redirect URI mismatch** (must exactly match what's
   registered in Entra ID, including trailing slash and http vs https) and an
   **issuer/discovery** problem (typo in `OPENID_ISSUER`, or the VM can't
   reach `login.microsoftonline.com` — check outbound firewall/proxy rules
   from `vm-deployment.md` §9).

## 6. Optional: role mapping and other providers

- **Map Entra ID roles/groups to NuAI roles** (e.g. auto-granting the admin
  role to IT staff): see `OPENID_REQUIRED_ROLE`, `OPENID_ADMIN_ROLE`,
  `OPENID_ROLE_SYNC_ENABLED`, and related `OPENID_ROLE_SYNC_*` vars in
  `.env.example`. This is a separate, optional layer on top of the basic
  login flow above.
- **Other identity providers** (SAML, Google Workspace, GitHub, etc.) follow
  the same two-part pattern from §1 — a `PROVIDER_*` block in `.env.example`
  plus the provider already being listed in `registration.socialLogins`.
  Note: LibreChat automatically disables SAML if OpenID is configured, so
  don't try to run both at once against the same login page.
- **LDAP** is also available (`LDAP_*` vars in `.env.example`) if Neumann
  Steel needs on-prem Active Directory auth instead of/alongside Entra ID.

## 7. What this does *not* yet cover

- SharePoint file picker and Graph-based people search — scaffolded in
  `.env.example` (`ENABLE_SHAREPOINT_FILEPICKER`, `SHAREPOINT_*`,
  `USE_ENTRA_ID_FOR_PEOPLE_SEARCH`) but require their own follow-up
  configuration once basic Entra ID login here is working.
- Per-role model access (limiting which AI models a given role/department can
  use) — that's tracked separately as Phase 2 of the `NuAI` model library
  endpoint (see the comments in `librechat.yaml`), not part of the SSO login
  flow itself.
