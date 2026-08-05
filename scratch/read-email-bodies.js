import { google } from 'googleapis';
import { getGmailTokens } from '../api/db.js';
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

async function readBodies() {
  const tokens = await getGmailTokens();
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'http://localhost:3000/api/auth'
  );
  oauth2Client.setCredentials({ refresh_token: tokens.refresh_token });
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  console.log("=== INTELLIGO EMAIL BODIES ===");
  const intelRes = await gmail.users.messages.list({ userId: 'me', q: 'intelligo after:2026/05/31' });
  if (intelRes.data.messages) {
    for (const m of intelRes.data.messages.slice(0, 5)) {
      const msg = await gmail.users.messages.get({ userId: 'me', id: m.id });
      const headers = msg.data.payload.headers || [];
      const sub = (headers.find(h => h.name.toLowerCase() === 'subject') || {}).value;
      const date = (headers.find(h => h.name.toLowerCase() === 'date') || {}).value;
      const body = getBody(msg.data.payload);
      console.log(`\n--- ID: ${m.id} | Date: ${date} | Subject: ${sub} ---`);
      console.log(body.substring(0, 500));
    }
  }

  console.log("\n=== CYERA EMAIL BODIES ===");
  const cyeraRes = await gmail.users.messages.list({ userId: 'me', q: 'cyera after:2026/05/31' });
  if (cyeraRes.data.messages) {
    for (const m of cyeraRes.data.messages.slice(0, 5)) {
      const msg = await gmail.users.messages.get({ userId: 'me', id: m.id });
      const headers = msg.data.payload.headers || [];
      const sub = (headers.find(h => h.name.toLowerCase() === 'subject') || {}).value;
      const date = (headers.find(h => h.name.toLowerCase() === 'date') || {}).value;
      const body = getBody(msg.data.payload);
      console.log(`\n--- ID: ${m.id} | Date: ${date} | Subject: ${sub} ---`);
      console.log(body.substring(0, 500));
    }
  }
}

readBodies().catch(console.error);
