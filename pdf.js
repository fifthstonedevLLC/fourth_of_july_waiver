'use strict';

const PDFDocument = require('pdfkit');

// The full waiver body, broken into titled sections. Kept here as the single
// source of truth so the on-screen text and the PDF stay in sync.
const TITLE = 'WAIVER OF LIABILITY AND ASSUMPTION OF RISK AGREEMENT';
const SUBTITLE = '"4th Annual 4th of July Celebration"';

const INTRO =
  'This Waiver of Liability and Assumption of Risk Agreement ("Agreement") is entered into ' +
  'by the undersigned individual ("Participant") in consideration of being permitted to use ' +
  'sparklers, novelty fireworks, and other potentially hazardous devices ("Activities") ' +
  'during the 4th Annual 4th of July Celebration ("Event"), hosted by Philip & Susan ' +
  'Harberts on July 3, 2026 at 1323 Carol Ct, Cedar Falls, IA 50613.';

const SECTIONS = [
  {
    heading: 'ASSUMPTION OF RISK',
    body:
      'I acknowledge and understand that participating in the use of sparklers and other ' +
      'novelty fireworks involves inherent risks, including but not limited to burns, fire ' +
      'hazards, personal injury, property damage, and other potential dangers. I voluntarily ' +
      'assume full responsibility for any risks of loss, damage, or personal injury, including ' +
      'death, that may be sustained by me or any minors under my supervision as a result of ' +
      'participating in these Activities.',
  },
  {
    heading: 'WAIVER AND RELEASE',
    body:
      'I, on behalf of myself, my heirs, assigns, personal representatives, and next of kin, ' +
      'hereby release, waive, discharge, and hold harmless the Event organizers, hosts, ' +
      'volunteers, sponsors, property owners, and any affiliated individuals or entities ' +
      '("Released Parties") from any and all liability, claims, demands, actions, or causes of ' +
      'action arising out of or related to any loss, damage, injury, or death that may be ' +
      'sustained by me or any minors under my supervision as a result of participating in the ' +
      'Activities, whether caused by negligence or otherwise.',
  },
  {
    heading: 'INDEMNIFICATION',
    body:
      'I agree to indemnify and hold harmless the Released Parties from any claims, suits, ' +
      'liabilities, or expenses (including reasonable attorney’s fees) that may arise due to ' +
      'my participation or the participation of minors under my supervision in the Activities.',
  },
  {
    heading: 'AUTHORITY TO SIGN AND PARENTAL CONSENT',
    body:
      'I certify that I am at least 18 years of age and have full legal capacity to enter ' +
      'into this Agreement. If I am signing on behalf of any minor children, I represent and ' +
      'warrant that I am the parent or legal guardian of those minors with full authority to ' +
      'execute this Agreement on their behalf, and I agree that this Agreement binds me, those ' +
      'minors, and our respective heirs, assigns, personal representatives, and next of kin.',
  },
  {
    heading: 'EMERGENCY MEDICAL TREATMENT',
    body:
      'In the event of injury or illness, I authorize the Event organizers and hosts to secure ' +
      'such emergency medical treatment as may be necessary for me or for any minor under my ' +
      'supervision. I understand that the Released Parties are not obligated to provide medical ' +
      'care, and I accept full responsibility for any medical expenses incurred.',
  },
  {
    heading: 'ALCOHOL AND IMPAIRMENT',
    body:
      'I understand that alcoholic beverages may be present at the Event. I agree that I will ' +
      'not handle, light, or use sparklers, fireworks, or other Activities while impaired by ' +
      'alcohol or any other substance, and I will not permit any minor under my supervision to ' +
      'do so. I voluntarily assume all risks arising from the consumption of alcohol and from ' +
      'the conduct of other participants at the Event.',
  },
  {
    heading: 'PERSONAL PROPERTY',
    body:
      'I understand and agree that the Released Parties are not responsible for any loss, theft, ' +
      'or damage to personal property — including vehicles, mobile phones, and other belongings ' +
      '— brought to or left at the Event.',
  },
  {
    heading: 'SAFETY COMPLIANCE',
    body:
      'I acknowledge and agree to follow all safety guidelines and instructions provided by ' +
      'the Event organizers regarding the handling and disposal of sparklers and other novelty ' +
      'fireworks. I understand that failure to comply with these safety measures may result in ' +
      'my removal from the Event.',
  },
  {
    heading: 'GOVERNING LAW AND SEVERABILITY',
    body:
      'This Agreement shall be governed by and construed in accordance with the laws of the ' +
      'State of Iowa. I intend this Agreement to be as broad and inclusive as is permitted by ' +
      'Iowa law. If any portion of this Agreement is held to be invalid or unenforceable, the ' +
      'remainder shall continue in full force and effect.',
  },
  {
    heading: 'ACKNOWLEDGMENT OF UNDERSTANDING',
    body:
      'I HAVE READ THIS AGREEMENT, FULLY UNDERSTAND ITS TERMS, AND SIGN IT FREELY AND ' +
      'VOLUNTARILY WITHOUT ANY INDUCEMENT. I UNDERSTAND THAT I AM GIVING UP SUBSTANTIAL ' +
      'RIGHTS, INCLUDING MY RIGHT TO SUE.',
  },
];

/**
 * Generate the signed waiver PDF.
 *
 * @param {object} data
 * @param {string} data.adultName        Supervising adult's full name.
 * @param {string[]} data.minors         List of minor names.
 * @param {string} data.signedDate       Display date (e.g. "July 4, 2026").
 * @param {string} [data.signedTime]     Display time (e.g. "2:43 PM CDT").
 * @param {Buffer} data.signatureBuffer  PNG image buffer of the drawn signature.
 * @returns {Promise<Buffer>} resolves with the finished PDF as a Buffer.
 */
function generateWaiverPdf(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 60 });
    const chunks = [];

    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ---- Title ----
    doc.font('Helvetica-Bold').fontSize(14).text(TITLE, { align: 'left' });
    doc.moveDown(0.2);
    doc.fontSize(12).text(SUBTITLE);
    doc.moveDown(0.8);

    // ---- Intro ----
    doc.font('Helvetica').fontSize(10.5).text(INTRO, { align: 'left', lineGap: 2 });
    doc.moveDown(0.6);

    // ---- Sections ----
    for (const section of SECTIONS) {
      doc.font('Helvetica-Bold').fontSize(10.5).text(section.heading);
      doc.moveDown(0.15);
      doc.font('Helvetica').fontSize(10.5).text(section.body, { align: 'left', lineGap: 2 });
      doc.moveDown(0.6);
    }

    // ---- Participant details (start on a fresh page for clarity) ----
    doc.addPage();

    doc.font('Helvetica-Bold').fontSize(12).text('Minor(s) Participating (First & Last):');
    doc.moveDown(0.5);

    doc.font('Helvetica').fontSize(11);
    if (data.minors && data.minors.length) {
      data.minors.forEach((name, i) => {
        doc.text(`${i + 1}.  ${name}`);
        doc.moveDown(0.2);
      });
    } else {
      doc.fillColor('#555').text('(None listed)').fillColor('black');
    }

    doc.moveDown(1);
    doc.moveTo(doc.x, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
    doc.moveDown(0.8);

    // ---- Supervising adult ----
    doc.font('Helvetica-Bold').fontSize(12).text('Supervising Adult:');
    doc.moveDown(0.6);

    doc.font('Helvetica').fontSize(11);
    doc.text(`Parent/Guardian Name:  ${data.adultName}`);
    doc.moveDown(0.8);

    // Signature label + image.
    doc.text('Parent/Guardian Signature:');
    doc.moveDown(0.3);

    const sigX = doc.x;
    const sigY = doc.y;
    const sigWidth = 240;
    const sigHeight = 90;

    if (data.signatureBuffer) {
      try {
        doc.image(data.signatureBuffer, sigX, sigY, {
          fit: [sigWidth, sigHeight],
          align: 'left',
          valign: 'top',
        });
      } catch (err) {
        doc.fillColor('red').text('[signature image could not be rendered]').fillColor('black');
      }
    }

    // Underline beneath the signature.
    const lineY = sigY + sigHeight + 4;
    doc.moveTo(sigX, lineY).lineTo(sigX + sigWidth + 60, lineY).stroke();

    doc.y = lineY + 12;
    doc.x = doc.page.margins.left;
    doc.font('Helvetica').fontSize(11).text(`Date:  ${data.signedDate}`);
    if (data.signedTime) {
      doc.moveDown(0.3);
      doc.text(`Time Signed:  ${data.signedTime}`);
    }

    doc.end();
  });
}

module.exports = { generateWaiverPdf, TITLE, SUBTITLE, INTRO, SECTIONS };
