import { google } from 'googleapis';
import { getGmailTokens, db } from '../api/db.js';
import dotenv from 'dotenv';
dotenv.config();

function getBody(payload) {
  let body = '';
  if (payload.body && payload.body.data) {
    body = Buffer.from(payload.body.data, 'base64').toString('utf-8');
  } else if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body && part.body.data) {
        body += Buffer.from(part.body.data, 'base64').toString('utf-8');
      } else if (part.mimeType === 'text/html' && part.body && part.body.data) {
        const html = Buffer.from(part.body.data, 'base64').toString('utf-8');
        body += html.replace(/<[^>]*>?/gm, ' ');
      } else if (part.parts) {
        body += getBody(part);
      }
    }
  }
  return body;
}

async function inspectLePrimore() {
  const tokens = await getGmailTokens();
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'http://localhost:3000/api/auth'
  );
  oauth2Client.setCredentials({ refresh_token: tokens.refresh_token });
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  console.log("=== SEARCHING GMAIL FOR LEPRIMORE ===");
  const searchRes = await gmail.users.messages.list({
    userId: 'me',
    q: 'LePrimore OR leprimore'
  });

  const messages = searchRes.data.messages || [];
  console.log(`Found ${messages.length} messages for LePrimore.`);

  for (const m of messages) {
    const msg = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
    const headers = msg.data.payload.headers || [];
    const sub = (headers.find(h => h.name.toLowerCase() === 'subject') || {}).value;
    const from = (headers.find(h => h.name.toLowerCase() === 'from') || {}).value;
    const date = (headers.find(h => h.name.toLowerCase() === 'date') || {}).value;
    const body = getBody(msg.data.payload);

    console.log(`\n--------------------------------------------------`);
    console.log(`ID: ${m.id}`);
    console.log(`Date: ${date}`);
    console.log(`From: ${from}`);
    console.log(`Subject: ${sub}`);
    console.log(`Body Snippet:\n${body.substring(0, 1500)}`);
  }

  console.log("\n=== CHECKING FIRESTORE APPLICATIONS FOR LEPRIMORE ===");
  const appsSnap = await db.collection('applications').get();
  appsSnap.forEach(doc => {
    const d = doc.data();
    if (JSON.stringify(d).toLowerCase().includes('leprimore') || JSON.stringify(d).toLowerCase().includes('primore')) {
      console.log(`Found in App Doc ${doc.id}:`, d);
    }
  });
}

inspectLePrimore().catch(console.error);
