# 4th of July Celebration — Liability Waiver App

A single-page web app for electronically signing the event liability waiver. It:

- Displays the full waiver text.
- Collects the supervising adult's name and up to 8 minors' names.
- Lets the signer **draw a signature** (mouse or touch).
- Optionally **emails the signer a copy**.
- Generates a **PDF** of the signed waiver, stored server-side.
- Saves a record of every signed waiver (SQLite + the PDF on disk) so you keep a copy too.

## Tech

- **Node.js + Express** server.
- **SQLite** (`better-sqlite3`) for the record of who signed.
- **pdfkit** for server-side PDF generation (the stored and emailed PDFs are identical).
- **signature_pad** for drawing the signature.
- **nodemailer** for the optional email copy.

## Run locally

```bash
npm install
npm start
```

Then open http://localhost:3000

## Configuration

Copy `.env.example` to `.env` and adjust as needed:

- `PORT` — port the app listens on (default 3000).
- `SMTP_*` / `MAIL_FROM` — SMTP settings for emailing copies. **Optional** — leave blank
  to disable email; the app still works and still stores PDFs server-side.
- `ADMIN_PASSWORD` — password for the booth check-in page at `/admin`. Leave blank to
  keep that page disabled.

## Booth check-in / admin page

Volunteers can verify a signed waiver at **`/admin`** (e.g. `https://waiver.yourdomain.com/admin`).

- Protected by HTTP Basic Auth — the browser prompts for a username/password. Any username
  works; the password must match `ADMIN_PASSWORD`.
- Search by **adult name or any child's name**. Matches show a green "✓ Waiver on file"
  badge, the date signed, the listed children (the matching name highlighted), and a
  **View signed PDF** link.
- No match shows a clear "no waiver found" message so the volunteer can have them sign one.

Set `ADMIN_PASSWORD` to a value you share with your volunteers, and run the site over HTTPS
(Basic Auth sends the password with each request).

## Where signed waivers are stored

Everything lives under `data/` (git-ignored):

- `data/waivers.db` — one row per signed waiver (name, minors, email, date, IP, PDF filename).
- `data/pdfs/` — the generated PDF for each signature.

Back up the `data/` folder to keep your records safe.

## Deploying on your VPS (subdomain)

1. Copy the project to the server and run `npm install` (this compiles `better-sqlite3`;
   make sure build tools / a recent Node 18+ are present).
2. Set environment variables (e.g. via `.env`) and start it under a process manager:

   ```bash
   npm install -g pm2
   pm2 start server.js --name waiver-app
   pm2 save
   ```

3. Point your subdomain at the app with a reverse proxy. Example **nginx** block for
   `waiver.yourdomain.com`:

   ```nginx
   server {
       server_name waiver.yourdomain.com;

       location / {
           proxy_pass http://127.0.0.1:3000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

4. Add HTTPS (strongly recommended for a signing app), e.g. with Certbot:
   `sudo certbot --nginx -d waiver.yourdomain.com`

The app trusts `X-Forwarded-*` headers (`trust proxy` is enabled) so the stored IP is the
real client address behind the proxy.

## Customizing the waiver text

The waiver wording lives in two places that must stay in sync:

- On-screen text: `public/index.html`
- PDF text: the `SECTIONS` / `INTRO` constants in `pdf.js`

## Viewing the records

It's a plain SQLite file. For a quick look:

```bash
sqlite3 data/waivers.db "SELECT id, adult_name, minors, email, signed_date, created_at FROM waivers;"
```
