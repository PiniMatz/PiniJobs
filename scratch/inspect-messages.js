import { google } from 'googleapis';
import { getGmailTokens } from '../api/db.js';
import dotenv from 'dotenv';
dotenv.config();

async function inspectCyeraAndIntelligo() {
  const tokens = await getGmailTokens();
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'http://localhost:3000/api/auth'
  );
  oauth2Client.setCredentials({ refresh_token: tokens.refresh_token });
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  console.log("=== SEARCHING GMAIL FOR CYERA ===");
  const cyeraRes = await gmail.users.messages.list({
    userId: 'me',
    q: 'cyera after:2026/05/31'
  });
  console.log(`Found ${cyeraRes.data.messages ? cyeraRes.data.messages.length : 0} messages for Cyera.`);
  if (cyeraRes.data.messages) {
    for (const m of cyeraRes.data.messages) {
      const msg = await gmail.users.messages.get({ userId: 'me', id: m.id });
      const headers = msg.data.payload.headers || [];
      const sub = (headers.find(h => h.name.toLowerCase() === 'subject') || {}).value;
      const from = (headers.find(h => h.name.toLowerCase() === 'from') || {}).value;
      const date = (headers.find(h => h.name.toLowerCase() === 'date') || {}).value;
      console.log(`- ID: ${m.id} | Date: ${date} | From: ${from} | Subject: ${sub}`);
    }
  }

  console.log("\n=== SEARCHING GMAIL FOR INTELLIGO ===");
  const intelRes = await gmail.users.messages.list({
    userId: 'me',
    q: 'intelligo after:2026/05/31'
  });
  console.log(`Found ${intelRes.data.messages ? intelRes.data.messages.length : 0} messages for Intelligo.`);
  if (intelRes.data.messages) {
    for (const m of intelRes.data.messages) {
      const msg = await gmail.users.messages.get({ userId: 'me', id: m.id });
      const headers = msg.data.payload.headers || [];
      const sub = (headers.find(h => h.name.toLowerCase() === 'subject') || {}).value;
      const from = (headers.find(h => h.name.toLowerCase() === 'from') || {}).value;
      const date = (headers.find(h => h.name.toLowerCase() === 'date') || {}).value;
      console.log(`- ID: ${m.id} | Date: ${date} | From: ${from} | Subject: ${sub}`);
    }
  }
}

inspectCyeraAndIntelligo().catch(console.error);
