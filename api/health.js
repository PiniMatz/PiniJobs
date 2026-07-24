import { db, getGmailTokens } from './db.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const diagnostics = {
    timestamp: new Date().toISOString(),
    env: {
      FIREBASE_PROJECT_ID: !!process.env.FIREBASE_PROJECT_ID,
      FIREBASE_CLIENT_EMAIL: !!process.env.FIREBASE_CLIENT_EMAIL,
      FIREBASE_PRIVATE_KEY: !!process.env.FIREBASE_PRIVATE_KEY,
      GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
      GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
      WEBAPP_JOBS_TOKEN: !!process.env.WEBAPP_JOBS_TOKEN,
    },
    services: {
      firebase: { status: 'pending' },
      gemini: { status: 'pending' },
      google_oauth: { status: 'pending' }
    },
    overall: 'healthy'
  };

  // 1. Test Firebase Firestore write & read
  try {
    const healthRef = db.collection('config').doc('health_check');
    await healthRef.set({ last_check: new Date().toISOString() }, { merge: true });
    diagnostics.services.firebase = { status: 'ok', details: 'Connected to Firestore' };
  } catch (err) {
    diagnostics.services.firebase = { status: 'error', details: err.message };
    diagnostics.overall = 'degraded';
  }

  // 2. Test Gemini API Connectivity
  if (process.env.GEMINI_API_KEY) {
    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const result = await model.generateContent("Respond with the text 'OK'");
      diagnostics.services.gemini = { status: 'ok', response: result.response.text().trim() };
    } catch (err) {
      diagnostics.services.gemini = { status: 'error', details: err.message };
      diagnostics.overall = 'degraded';
    }
  } else {
    diagnostics.services.gemini = { status: 'missing_key', details: 'GEMINI_API_KEY environment variable is missing' };
    diagnostics.overall = 'degraded';
  }

  // 3. Test Google OAuth Tokens in Database
  try {
    const tokens = await getGmailTokens();
    if (tokens && tokens.refresh_token) {
      diagnostics.services.google_oauth = { status: 'ok', details: 'Refresh token present in Firestore' };
    } else {
      diagnostics.services.google_oauth = { status: 'reconnect_required', details: 'No refresh token stored' };
    }
  } catch (err) {
    diagnostics.services.google_oauth = { status: 'error', details: err.message };
  }

  res.status(200).json(diagnostics);
}
