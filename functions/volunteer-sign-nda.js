const admin = require('firebase-admin');
const PDFDocument = require('pdfkit');
const { google } = require('googleapis');
const ndaTemplate = require('./nda-template');
const stream = require('stream');

exports.volunteerSignNda = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { name, token } = req.body;
    if (!name || !token) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // Find volunteer by token
        const snap = await admin.firestore().collection('volunteers')
            .where('ndaToken', '==', token).limit(1).get();

        if (snap.empty) {
            return res.status(404).json({ error: 'Invalid or expired token' });
        }

        const doc = snap.docs[0];
        const volunteer = doc.data();

        if (volunteer.ndaSigned) {
            return res.status(409).json({ error: 'NDA already signed' });
        }

        const now = new Date();
        const ip = req.headers['x-forwarded-for'] || req.ip || 'unknown';

        // Generate PDF
        const pdfBuffer = await generateNdaPdf(volunteer.name, name, now, ip);

        // Upload to Drive if folder exists
        if (volunteer.driveFolder && process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
            try {
                // Extract folder ID from URL
                const folderMatch = volunteer.driveFolder.match(/folders\/([^?/]+)/);
                const folderId = folderMatch ? folderMatch[1] : null;

                if (folderId) {
                    const key = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString());
                    const auth = new google.auth.JWT({
                        email: key.client_email,
                        key: key.private_key,
                        scopes: ['https://www.googleapis.com/auth/drive'],
                        subject: process.env.OFFICER_EMAIL || 'officer@scienceandfreedom.com'
                    });
                    const drive = google.drive({ version: 'v3', auth });

                    const bufferStream = new stream.PassThrough();
                    bufferStream.end(pdfBuffer);

                    await drive.files.create({
                        requestBody: {
                            name: `NDA - ${volunteer.name} - Signed ${now.toISOString().split('T')[0]}.pdf`,
                            mimeType: 'application/pdf',
                            parents: [folderId]
                        },
                        media: {
                            mimeType: 'application/pdf',
                            body: bufferStream
                        }
                    });
                }
            } catch (driveErr) {
                console.error('Drive upload failed:', driveErr);
                // Continue — signing still succeeds even if Drive upload fails
            }
        }

        // Update Firestore
        await doc.ref.update({
            ndaSigned: true,
            ndaSignedAt: admin.firestore.FieldValue.serverTimestamp(),
            ndaIp: ip,
            ndaSignedName: name,
            ndaToken: null, // invalidate token
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.status(200).json({ success: true });
    } catch (e) {
        console.error('NDA sign error:', e);
        return res.status(500).json({ error: 'Failed to process signature' });
    }
};

function generateNdaPdf(volunteerName, signedName, signDate, ip) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 60 });
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // Title
        doc.fontSize(18).font('Helvetica-Bold')
            .text(ndaTemplate.title, { align: 'center' });
        doc.moveDown();

        // Intro
        doc.fontSize(11).font('Helvetica')
            .text('This Non-Disclosure Agreement ("Agreement") is entered into by and between ', { continued: true })
            .font('Helvetica-Bold').text('Science and Freedom for Everyone Action Fund', { continued: true })
            .font('Helvetica').text(' ("SAFE Action") and ', { continued: true })
            .font('Helvetica-Bold').text(volunteerName, { continued: true })
            .font('Helvetica').text(' ("Volunteer").');
        doc.moveDown();

        // Sections
        ndaTemplate.sections.forEach(section => {
            doc.fontSize(12).font('Helvetica-Bold').text(section.heading);
            doc.moveDown(0.3);
            doc.fontSize(10).font('Helvetica').text(section.body, { align: 'justify' });
            doc.moveDown();
        });

        // Signature block
        doc.moveDown(2);
        doc.fontSize(12).font('Helvetica-Bold').text('ELECTRONIC SIGNATURE');
        doc.moveDown(0.5);
        doc.fontSize(10).font('Helvetica');
        doc.text('Signed by: ' + signedName);
        doc.text('Date: ' + signDate.toISOString());
        doc.text('IP Address: ' + ip);
        doc.moveDown();
        doc.fontSize(8).text(
            'This document was electronically signed pursuant to the U.S. Electronic Signatures in Global and National Commerce Act (ESIGN Act). ' +
            'The signer typed their full name and confirmed agreement to the terms above.',
            { color: '#666' }
        );

        doc.end();
    });
}
