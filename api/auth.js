import { google } from 'googleapis';
import { updateGmailTokens } from './db.js';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

function getRedirectUri(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  
  // If running on Vercel (or any non-localhost host), force the live production URI
  if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    return `${proto}://${host}/api/auth`;
  }

  // Fallback for local development
  if (process.env.GOOGLE_REDIRECT_URI) {
    return process.env.GOOGLE_REDIRECT_URI;
  }
  return 'http://localhost:3000/api/auth';
}

export default async function handler(req, res) {
  const { code } = req.query;
  const redirectUri = getRedirectUri(req);

  const oauth2Client = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    redirectUri
  );

  // If 'code' parameter is present, handle Google OAuth callback
  if (code) {
    try {
      const { tokens } = await oauth2Client.getToken(code);
      await updateGmailTokens(tokens);
      const targetUrl = process.env.FRONTEND_URL || '/';
      res.redirect(targetUrl);
    } catch (err) {
      console.error('Error exchanging code for tokens:', err);
      res.status(500).send(`Authentication failed: ${err.message}`);
    }
    return;
  }

  // Otherwise, initiate login redirect
  const scopes = ['https://www.googleapis.com/auth/gmail.readonly'];
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes
  });
  
  res.redirect(url);
}
