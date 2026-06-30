# Deploying the Waiver App on Dokploy

This guide covers deploying the app as a **Dokploy Application** service, including
Mailgun SMTP for emailed copies.

The app is a standard Node/Express service with one native dependency
(`better-sqlite3`) and on-disk state under `data/`. Two things matter most:

1. Use the **Nixpacks** build pack.
2. Mount a **persistent volume at `/app/data`** — without it, every redeploy wipes
   all signed waivers (the SQLite database and the stored PDFs).

---

## Build pack: Nixpacks (the Dokploy default)

Nixpacks auto-detects Node from `package.json`, installs dependencies, and runs
`npm start` (`node server.js`) — no Dockerfile needed. `better-sqlite3` ships
prebuilt binaries, so it installs without compiling on a normal Linux host.

---

## Step 1 — Get the code into Git

Dokploy deploys from a Git repository. Initialize and push to GitHub/GitLab (or a
self-hosted Git):

```bash
cd /path/to/WaiverApp
git init
git add .
git commit -m "Initial commit: waiver app"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

`.gitignore` already excludes `node_modules/`, `data/`, and `.env`, so secrets and
the local database won't be pushed.

> Alternatives: Dokploy also supports deploying from a **Docker image** or a
> **drag-and-drop upload**, but Git is the smoothest path here.

## Step 2 — Point the Application at your repo

In the Dokploy Application → **General / Source**:

- **Provider:** GitHub (via the Dokploy GitHub App) or **Git** (repo URL + deploy key).
- **Repository / Branch:** your repo, `main`.
- **Build Path:** `/` (project root).

## Step 3 — Build settings

- **Build Type:** **Nixpacks**.
- Leave the install / build / start commands blank — Nixpacks uses `package.json`
  (`npm install` then `npm start`). No custom build command is needed.

## Step 4 — Environment variables

Application → **Environment**. At minimum:

```
ADMIN_PASSWORD=choose-a-strong-password
```

Add the Mailgun variables (see [Mailgun SMTP setup](#mailgun-smtp-setup) below) if
you want emailed copies. Leave them out to disable email cleanly — the app still
works fully and still stores PDFs server-side.

> Do **not** set `PORT` — the app defaults to **3000**, which you route to in Step 6.

## Step 5 — ⚠️ Persistent volume (do not skip)

The SQLite database and all signed PDFs live in `data/`. Containers are ephemeral,
so you must mount a volume there or you lose every waiver on each deploy.

Application → **Advanced → Volumes → Add Volume Mount**:

- **Type:** Volume Mount (named volume)
- **Volume Name:** `waiver-data`
- **Mount Path:** `/app/data`

Nixpacks runs the app from `/app`, so `/app/data` is exactly where `db.js`
reads/writes (`waivers.db` + `pdfs/`). The app creates the subfolders on first boot.

## Step 6 — Domain, port & HTTPS

Application → **Domains → Add Domain**:

- **Host:** `waiver.yourdomain.com` (point its DNS A record at the server first)
- **Container Port:** `3000`
- **HTTPS:** On, **Certificate: Let's Encrypt**

HTTPS matters here — the admin page uses Basic Auth and the form transmits
signatures, neither of which should travel over plain HTTP. `server.js` already has
`trust proxy` enabled, so client IPs are recorded correctly behind Dokploy's Traefik
proxy.

## Step 7 — Deploy & verify

Click **Deploy** and watch the logs for:

```
Waiver app listening on http://localhost:3000
Email copies: ENABLED   (or "disabled" if you skipped SMTP)
```

Then check:

- `https://waiver.yourdomain.com/` → the signing form
- `https://waiver.yourdomain.com/api/health` → `{"ok":true,...}`
- `https://waiver.yourdomain.com/admin` → prompts for Basic Auth (any username + your
  `ADMIN_PASSWORD`)

---

## Mailgun SMTP setup

`mailer.js` speaks standard SMTP with auth, so **no code changes are needed** — just
set these environment variables in Dokploy.

### Environment variables

```
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=postmaster@mg.yourdomain.com
SMTP_PASS=your-mailgun-smtp-password
SMTP_SECURE=false
MAIL_FROM=4th of July Celebration <noreply@mg.yourdomain.com>
```

How these map to the code:

- `SMTP_SECURE=false` + port `587` → nodemailer uses **STARTTLS**. (Switching to port
  `465` auto-enables TLS as well.)
- `SMTP_USER` / `SMTP_PASS` → SMTP authentication.
- `MAIL_FROM` → the From header on every emailed copy.

### Where to get the username & password

In the Mailgun dashboard: **Send → Sending → Domains → (your domain) → SMTP credentials**.

- **Username** = the SMTP login shown there, typically `postmaster@mg.yourdomain.com`.
  (You can also create a dedicated SMTP user like `waiver@…`.)
- **Password** = click **Reset password** to reveal/generate it. This is the **SMTP
  password** — *not* your Mailgun account password and *not* the API key.

### ⚠️ Verify your own domain (the common gotcha)

New Mailgun accounts come with a **sandbox** domain (`sandboxXXXX.mailgun.org`) that
**only sends to a handful of pre-authorized recipients you manually add.** At a real
event, parents type in arbitrary email addresses — those all silently fail on a
sandbox domain.

Before the event:

1. **Add your domain** in Mailgun (e.g. `mg.yourdomain.com`).
2. Add the **DNS records Mailgun provides** (SPF `TXT`, DKIM `TXT`, and the tracking
   `CNAME`) at your DNS provider, and wait for Mailgun to mark the domain **Verified**.
3. Use that verified domain in both `SMTP_USER` and the address in `MAIL_FROM`. The
   From-address domain **must** match the verified Mailgun domain or mail is rejected
   / spam-filed.

### More notes

- **Region:** If your Mailgun domain is in the **EU** region, use
  `SMTP_HOST=smtp.eu.mailgun.org` instead. US is the default `smtp.mailgun.org`. The
  wrong region's host causes auth failures.
- **Verify after deploy:** Redeploy so the env vars load, check the startup log for
  `Email copies: ENABLED`, then sign a test waiver (email box checked) using an
  address you control. Mailgun's **Logs** tab shows accepted/delivered/failed per
  message — the first place to look if something doesn't arrive.
- **Optional alternative:** Mailgun also has an HTTP API, but there's no reason to
  switch — SMTP works with the current code as-is.

---

## Recommendations

1. **Pin Node to 20 LTS.** `engines` currently says `>=18`, which can let Nixpacks
   pick an older runtime. Pin a known-good version so `better-sqlite3`'s prebuilt
   binary always matches: set `package.json` `"engines": { "node": "20.x" }`, or add a
   `.nvmrc` file containing `20`. (If a deploy ever fails compiling `better-sqlite3`,
   this is almost always the cause.)
2. **Back up the `waiver-data` volume.** It's the only copy of signed waivers.
   Schedule a Dokploy volume/DB backup, or periodically copy `waivers.db` and `pdfs/`
   off the server.
3. **Fallback build:** If a build ever fails on the native module despite pinning
   Node, switch Build Type to **Dockerfile** (Node 20-slim + build tools) as a
   drop-in alternative.

---

## Environment variable reference

| Variable        | Required?            | Example                                          |
| --------------- | -------------------- | ------------------------------------------------ |
| `ADMIN_PASSWORD`| Yes (for `/admin`)   | `choose-a-strong-password`                       |
| `PORT`          | No (defaults `3000`) | leave unset                                      |
| `SMTP_HOST`     | For email            | `smtp.mailgun.org` (`smtp.eu.mailgun.org` in EU) |
| `SMTP_PORT`     | For email            | `587`                                            |
| `SMTP_USER`     | For email            | `postmaster@mg.yourdomain.com`                   |
| `SMTP_PASS`     | For email            | (Mailgun SMTP password)                          |
| `SMTP_SECURE`   | For email            | `false`                                          |
| `MAIL_FROM`     | For email            | `4th of July Celebration <noreply@mg.yourdomain.com>` |
