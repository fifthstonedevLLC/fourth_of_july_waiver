'use strict';

const nodemailer = require('nodemailer');

// Email is optional. If SMTP isn't configured via environment variables the app
// still works fully — it just skips sending copies.
const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_SECURE,
  MAIL_FROM,
} = process.env;

const isConfigured = Boolean(SMTP_HOST && SMTP_PORT && MAIL_FROM);

let transporter = null;
if (isConfigured) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: SMTP_SECURE === 'true' || Number(SMTP_PORT) === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
}

/**
 * Email a copy of the signed waiver. Resolves to false (without throwing) when
 * email isn't configured, so a missing SMTP setup never blocks a signature.
 *
 * @param {object} opts
 * @param {string} opts.to            Recipient email address.
 * @param {string} opts.adultName     Signer's name (used in the message body).
 * @param {Buffer} opts.pdfBuffer     The waiver PDF to attach.
 * @param {string} opts.pdfFilename   Attachment filename.
 * @returns {Promise<boolean>} whether the email was sent.
 */
async function emailWaiverCopy({ to, adultName, pdfBuffer, pdfFilename }) {
  if (!isConfigured || !to) return false;

  await transporter.sendMail({
    from: MAIL_FROM,
    to,
    subject: '2026 Independence Day Celebration — Your Signed Liability Waiver',
    text:
      `Hi ${adultName},\n\n` +
      'Thank you for signing the liability waiver for our 2026 Independence Day Celebration. ' +
      'A copy of your signed waiver is attached for your records!\n\n' +
      'We hope you enjoy the event!',
    attachments: [
      {
        filename: pdfFilename,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });

  return true;
}

module.exports = { emailWaiverCopy, mailIsConfigured: isConfigured };
