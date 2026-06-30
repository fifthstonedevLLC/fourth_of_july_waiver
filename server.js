'use strict';

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');

const {
  saveWaiver,
  searchWaivers,
  countWaivers,
  pageWaivers,
  deleteWaiver,
  findWaiverByAdultAndDate,
  updateWaiverChildren,
  PDF_DIR,
} = require('./db');
const { generateWaiverPdf } = require('./pdf');
const { emailWaiverCopy, mailIsConfigured } = require('./mailer');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust the reverse proxy (nginx/Caddy) so req.ip is the real client address.
app.set('trust proxy', true);

// Bodies include a base64 signature image, so allow a generous JSON limit.
app.use(express.json({ limit: '5mb' }));

// Serve the front-end.
app.use(express.static(path.join(__dirname, 'public')));

// Serve the signature_pad library straight from node_modules (no build step).
app.use(
  '/vendor/signature_pad.js',
  express.static(path.join(__dirname, 'node_modules', 'signature_pad', 'dist', 'signature_pad.umd.min.js'))
);

// ---- Admin area (booth volunteers verify a signed waiver) ----------------

const ADMIN_DIR = path.join(__dirname, 'admin');

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * HTTP Basic Auth guard for the admin area. Any username is accepted; only the
 * password must match ADMIN_PASSWORD. If no password is configured the admin
 * area is disabled (returns 503) rather than left open.
 */
function adminAuth(req, res, next) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return res
      .status(503)
      .send('Admin area is not configured. Set ADMIN_PASSWORD in the environment to enable it.');
  }

  const header = req.get('authorization') || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const password = decoded.slice(decoded.indexOf(':') + 1);
    if (safeEqual(password, expected)) return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="Waiver Admin", charset="UTF-8"');
  return res.status(401).send('Authentication required.');
}

// Search by adult or child name.
app.get('/api/admin/search', adminAuth, (req, res) => {
  const results = searchWaivers(req.query.q || '');
  res.json({ results });
});

// Browse signed waivers, newest first, a page at a time (booth live feed).
const ADMIN_PAGE_SIZE = 5;
app.get('/api/admin/list', adminAuth, (req, res) => {
  const total = countWaivers();
  const totalPages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const page = Math.min(totalPages, Math.max(1, parseInt(req.query.page, 10) || 1));
  const offset = (page - 1) * ADMIN_PAGE_SIZE;
  res.json({
    total,
    page,
    pageSize: ADMIN_PAGE_SIZE,
    totalPages,
    results: pageWaivers(ADMIN_PAGE_SIZE, offset),
  });
});

// Delete a waiver (e.g. a mistaken entry) so the parent can sign a fresh one.
// Removes the DB row and its stored PDF.
app.delete('/api/admin/waiver/:id', adminAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid waiver id.' });
  }

  const removed = deleteWaiver(id);
  if (!removed) {
    return res.status(404).json({ error: 'Waiver not found.' });
  }

  // Best-effort removal of the stored PDF (filename validated against traversal).
  if (removed.pdf_filename && /^waiver-[a-z0-9-]+-\d+\.pdf$/.test(removed.pdf_filename)) {
    try {
      fs.unlinkSync(path.join(PDF_DIR, removed.pdf_filename));
    } catch (_) { /* already gone — ignore */ }
  }

  res.json({ ok: true });
});

// View a stored signed-waiver PDF (filename validated to prevent path traversal).
app.get('/admin/pdf/:filename', adminAuth, (req, res) => {
  const { filename } = req.params;
  if (!/^waiver-[a-z0-9-]+-\d+\.pdf$/.test(filename)) {
    return res.status(400).send('Invalid file name.');
  }
  const filePath = path.join(PDF_DIR, filename);
  if (!filePath.startsWith(PDF_DIR) || !fs.existsSync(filePath)) {
    return res.status(404).send('Waiver PDF not found.');
  }
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `inline; filename="${filename}"`);
  res.sendFile(filePath);
});

// Admin page + its assets (everything under /admin requires auth).
app.use('/admin', adminAuth, express.static(ADMIN_DIR));

const MAX_MINORS = 8;
const SIGNATURE_PREFIX = 'data:image/png;base64,';

// The event is in Cedar Falls, IA — show/record signing times in Central time
// regardless of the server's own clock/timezone.
const EVENT_TIMEZONE = 'America/Chicago';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Fast, bounded structural check that a buffer is a well-formed PNG: it walks
 * the chunk table and verifies every declared length stays inside the buffer.
 * This rejects malformed PNGs up front so they never reach pdfkit's parser,
 * which can spin for ~30s on a chunk length that overruns the buffer.
 */
function isValidPng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8 + 12 + 12) return false; // sig + IHDR + IEND
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) return false;

  let pos = 8;
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    // The chunk's data plus its 4-byte CRC must fit within the buffer.
    if (len > buf.length - pos - 12) return false;
    const type = buf.toString('ascii', pos + 4, pos + 8);
    if (pos === 8 && type !== 'IHDR') return false; // first chunk must be IHDR
    if (type === 'IEND') return true;
    pos += 12 + len;
  }
  return false; // never reached a valid IEND
}

function cleanName(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function makePdfFilename(adultName) {
  const safeName = adultName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `waiver-${safeName || 'participant'}-${Date.now()}.pdf`;
}

/**
 * Merge incoming children into an existing list, de-duplicating by name
 * (case-insensitive) and respecting the MAX_MINORS cap. Returns the combined
 * list plus the names that were actually added (those that were new and fit).
 */
function mergeChildLists(existing, incoming) {
  const seen = new Set(existing.map((n) => n.toLowerCase()));
  const room = Math.max(0, MAX_MINORS - existing.length);
  const added = [];
  for (const name of incoming) {
    const key = name.toLowerCase();
    if (seen.has(key) || added.length >= room) continue;
    seen.add(key);
    added.push(name);
  }
  return { combined: existing.concat(added), added };
}

async function maybeEmailCopy({ wantsEmail, email, adultName, pdfBuffer, pdfFilename }) {
  let emailed = false;
  let emailError = false;
  if (wantsEmail && email) {
    try {
      emailed = await emailWaiverCopy({ to: email, adultName, pdfBuffer, pdfFilename });
    } catch (err) {
      emailError = true;
      console.error('Failed to email waiver copy:', err.message);
    }
  }
  return { emailed, emailError };
}

/**
 * POST /api/waiver
 * Accepts the signed waiver data, generates + stores the PDF, optionally emails
 * a copy, and returns the PDF bytes for the browser to download.
 */
app.post('/api/waiver', async (req, res) => {
  try {
    const adultName = cleanName(req.body.adultName);
    const wantsEmail = Boolean(req.body.wantsEmail);
    const email = wantsEmail ? cleanName(req.body.email) : '';
    const signature = req.body.signature;

    const minors = Array.isArray(req.body.minors)
      ? req.body.minors.map(cleanName).filter(Boolean).slice(0, MAX_MINORS)
      : [];

    // ---- Validation ----
    if (!adultName) {
      return res.status(400).json({ error: 'Parent/Guardian name is required.' });
    }
    if (typeof signature !== 'string' || !signature.startsWith(SIGNATURE_PREFIX)) {
      return res.status(400).json({ error: 'A signature is required.' });
    }
    if (wantsEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }

    const signatureBuffer = Buffer.from(signature.slice(SIGNATURE_PREFIX.length), 'base64');

    // Reject malformed signature images before they reach pdfkit (see isValidPng).
    if (!isValidPng(signatureBuffer)) {
      return res.status(400).json({ error: 'The signature image was invalid. Please clear it and sign again.' });
    }

    // Signing date + time, in the event's local (Central) time so the record is
    // correct no matter where the server runs. The ISO date (used for the
    // repeat-sign-in check and storage) is also computed in Central time.
    const now = new Date();
    const signedDateDisplay = now.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: EVENT_TIMEZONE,
    });
    const signedTimeDisplay = now.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: EVENT_TIMEZONE,
      timeZoneName: 'short',
    });
    const signedDateIso = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: EVENT_TIMEZONE,
    }).format(now);

    // ---- Repeat sign-in check ----
    // If this adult already signed today, don't silently create a duplicate.
    // Unless the signer has confirmed they want to add to it, report the
    // existing waiver and which (if any) of the submitted children are new.
    const existing = findWaiverByAdultAndDate(adultName, signedDateIso);
    const addToExisting = Boolean(req.body.addToExisting);

    if (existing && !addToExisting) {
      const onFile = new Set(existing.minors.map((n) => n.toLowerCase()));
      const newChildren = minors.filter((n) => !onFile.has(n.toLowerCase()));
      return res.status(409).json({
        duplicate: true,
        existing: { adultName: existing.adult_name, minors: existing.minors },
        newChildren,
      });
    }

    // ---- Merge branch: add the new children to the waiver already on file ----
    if (existing && addToExisting) {
      const { combined, added } = mergeChildLists(existing.minors, minors);

      const pdfBuffer = await generateWaiverPdf({
        adultName,
        minors: combined,
        signedDate: signedDateDisplay,
        signedTime: signedTimeDisplay,
        signatureBuffer,
      });

      const pdfFilename = makePdfFilename(adultName);
      fs.writeFileSync(path.join(PDF_DIR, pdfFilename), pdfBuffer);
      // Drop the superseded PDF so we don't leave orphans on disk.
      try {
        fs.unlinkSync(path.join(PDF_DIR, existing.pdf_filename));
      } catch (_) { /* old file already gone — ignore */ }

      const emailToStore = (wantsEmail && email) ? email : (existing.email || null);
      updateWaiverChildren({
        id: existing.id,
        minors: combined,
        pdfFilename,
        email: emailToStore,
      });

      const { emailed, emailError } = await maybeEmailCopy({
        wantsEmail,
        email,
        adultName,
        pdfBuffer,
        pdfFilename,
      });

      return res.json({
        ok: true,
        merged: true,
        addedChildren: added,
        minors: combined,
        emailRequested: wantsEmail && Boolean(email),
        emailed,
        emailError,
      });
    }

    // ---- New waiver: generate PDF, persist to disk + DB ----
    const pdfBuffer = await generateWaiverPdf({
      adultName,
      minors,
      signedDate: signedDateDisplay,
      signedTime: signedTimeDisplay,
      signatureBuffer,
    });

    const pdfFilename = makePdfFilename(adultName);
    fs.writeFileSync(path.join(PDF_DIR, pdfFilename), pdfBuffer);

    saveWaiver({
      adultName,
      minors,
      email: email || null,
      signedDate: signedDateIso,
      pdfFilename,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    // ---- Optional email copy (never blocks the response on failure) ----
    const { emailed, emailError } = await maybeEmailCopy({
      wantsEmail,
      email,
      adultName,
      pdfBuffer,
      pdfFilename,
    });

    // The signed waiver is stored server-side; we no longer return it for
    // download. Tell the client whether a copy was emailed.
    return res.json({
      ok: true,
      emailRequested: wantsEmail && Boolean(email),
      emailed,
      emailError,
    });
  } catch (err) {
    console.error('Error processing waiver:', err);
    return res.status(500).json({ error: 'Something went wrong while processing the waiver.' });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, emailConfigured: mailIsConfigured });
});

app.listen(PORT, () => {
  console.log(`Waiver app listening on http://localhost:${PORT}`);
  console.log(`Email copies: ${mailIsConfigured ? 'ENABLED' : 'disabled (SMTP not configured)'}`);
});
