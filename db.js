'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
const PDF_DIR = path.join(DATA_DIR, 'pdfs');

// Ensure storage directories exist.
fs.mkdirSync(PDF_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'waivers.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS waivers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    adult_name    TEXT    NOT NULL,
    minors        TEXT    NOT NULL DEFAULT '[]',   -- JSON array of names
    email         TEXT,
    signed_date   TEXT    NOT NULL,                -- date shown on the waiver (YYYY-MM-DD)
    pdf_filename  TEXT    NOT NULL,
    ip            TEXT,
    user_agent    TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

const insertStmt = db.prepare(`
  INSERT INTO waivers (adult_name, minors, email, signed_date, pdf_filename, ip, user_agent)
  VALUES (@adult_name, @minors, @email, @signed_date, @pdf_filename, @ip, @user_agent)
`);

/**
 * Persist a waiver record.
 * @param {object} record
 * @returns {number} the new row id
 */
function saveWaiver(record) {
  const info = insertStmt.run({
    adult_name: record.adultName,
    minors: JSON.stringify(record.minors || []),
    email: record.email || null,
    signed_date: record.signedDate,
    pdf_filename: record.pdfFilename,
    ip: record.ip || null,
    user_agent: record.userAgent || null,
  });
  return info.lastInsertRowid;
}

function listWaivers() {
  return db.prepare('SELECT * FROM waivers ORDER BY created_at DESC').all();
}

const getStmt = db.prepare('SELECT * FROM waivers WHERE id = ?');

/** Fetch a single waiver row by id, or null if it doesn't exist. */
function getWaiver(id) {
  return getStmt.get(id) || null;
}

const deleteStmt = db.prepare('DELETE FROM waivers WHERE id = ?');

/**
 * Delete a waiver by id. Returns the deleted row (so the caller can remove the
 * associated PDF), or null if no such waiver existed.
 */
function deleteWaiver(id) {
  const row = getStmt.get(id);
  if (!row) return null;
  deleteStmt.run(id);
  return row;
}

const recentStmt = db.prepare(`
  SELECT id, adult_name, minors, email, signed_date, pdf_filename, created_at
  FROM waivers
  ORDER BY created_at DESC
  LIMIT @limit
`);

/** Total number of signed waivers on file. */
function countWaivers() {
  return db.prepare('SELECT COUNT(*) AS n FROM waivers').get().n;
}

/** Most recent waivers (minors parsed to an array), newest first. */
function recentWaivers(limit = 100) {
  return recentStmt.all({ limit }).map((row) => ({
    ...row,
    minors: JSON.parse(row.minors || '[]'),
  }));
}

const pageStmt = db.prepare(`
  SELECT id, adult_name, minors, email, signed_date, pdf_filename, created_at
  FROM waivers
  ORDER BY created_at DESC, id DESC
  LIMIT @limit OFFSET @offset
`);

/**
 * A page of waivers, newest first. The `id DESC` tiebreaker keeps ordering
 * stable (and truly newest-on-top) when several are signed in the same second.
 */
function pageWaivers(limit, offset) {
  return pageStmt.all({ limit, offset }).map((row) => ({
    ...row,
    minors: JSON.parse(row.minors || '[]'),
  }));
}

const findByAdultDateStmt = db.prepare(`
  SELECT id, adult_name, minors, email, signed_date, pdf_filename, created_at
  FROM waivers
  WHERE LOWER(adult_name) = LOWER(@adultName) AND signed_date = @signedDate
  ORDER BY created_at DESC
  LIMIT 1
`);

/**
 * Find an existing waiver for the same supervising adult on the same date.
 * Used to detect a repeat sign-in (so we can offer to add children to the
 * waiver already on file instead of creating a duplicate).
 *
 * @param {string} adultName
 * @param {string} signedDate  ISO date (YYYY-MM-DD)
 * @returns {object|null} the matching row (minors parsed) or null
 */
function findWaiverByAdultAndDate(adultName, signedDate) {
  const row = findByAdultDateStmt.get({ adultName, signedDate });
  if (!row) return null;
  return { ...row, minors: JSON.parse(row.minors || '[]') };
}

const updateChildrenStmt = db.prepare(`
  UPDATE waivers
  SET minors = @minors, pdf_filename = @pdf_filename, email = @email
  WHERE id = @id
`);

/**
 * Replace the children list (and regenerated PDF) on an existing waiver, e.g.
 * after merging in additional minors. Email is updated to whatever the caller
 * passes (existing value preserved by the caller when none was re-entered).
 */
function updateWaiverChildren({ id, minors, pdfFilename, email }) {
  updateChildrenStmt.run({
    id,
    minors: JSON.stringify(minors || []),
    pdf_filename: pdfFilename,
    email: email || null,
  });
}

const searchStmt = db.prepare(`
  SELECT id, adult_name, minors, email, signed_date, pdf_filename, created_at
  FROM waivers
  WHERE adult_name LIKE @like ESCAPE '\\' OR minors LIKE @like ESCAPE '\\'
  ORDER BY created_at DESC
  LIMIT 50
`);

/**
 * Search waivers by supervising adult name or any minor's name.
 * Minors are stored as a JSON array string, so a LIKE match catches names
 * anywhere in that list. The caller parses `minors` back into an array.
 *
 * @param {string} query
 * @returns {Array<object>} matching rows (minors parsed to an array)
 */
function searchWaivers(query) {
  const trimmed = (query || '').trim();
  if (!trimmed) return [];

  // Escape LIKE wildcards so a user typing % or _ doesn't broaden the match.
  const escaped = trimmed.replace(/[\\%_]/g, '\\$&');
  const rows = searchStmt.all({ like: `%${escaped}%` });

  return rows.map((row) => ({
    ...row,
    minors: JSON.parse(row.minors || '[]'),
  }));
}

module.exports = {
  db,
  saveWaiver,
  listWaivers,
  searchWaivers,
  countWaivers,
  recentWaivers,
  pageWaivers,
  getWaiver,
  deleteWaiver,
  findWaiverByAdultAndDate,
  updateWaiverChildren,
  DATA_DIR,
  PDF_DIR,
};
