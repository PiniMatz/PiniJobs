import { google } from 'googleapis';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { 
  getEmailState, 
  updateEmailState, 
  getGmailTokens, 
  getApplications, 
  upsertApplication, 
  updateApplication, 
  addEvent 
} from './db.js';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

function getRedirectUri(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    return `${proto}://${host}/api/auth`;
  }
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  return 'http://localhost:3000/api/auth';
}

// Parse plain text or html from Gmail message payload
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
        body += html.replace(/<[^>]*>?/gm, ' '); // Strip HTML tags
      } else if (part.parts) {
        body += getBody(part);
      }
    }
  }
  return body;
}

// Resilient Gemini email classifier with regex JSON extraction & error fallbacks
async function classifyAndMatchEmail(subject, sender, body, existingApps) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('GEMINI_API_KEY environment variable is missing.');
    return { classification: 'irrelevant' };
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `You are an AI assistant parsing emails for a job application tracker.
Analyze the following email and classify/match it.
Current Year: 2026.

Email Details:
Sender: ${sender}
Subject: ${subject}
Body Snippet: ${body.substring(0, 3000)}

Existing tracked applications:
${JSON.stringify(existingApps, null, 2)}

Classification Rules:
- 'confirmation': Candidate applied to a job. (Status becomes 'applied').
- 'interview_invite': Candidate is invited to an interview. (Status becomes 'interview').
- 'assessment': Candidate received a take-home test or screening task. (Status becomes 'screening').
- 'offer': Candidate received a job offer. (Status becomes 'offer').
- 'rejection': Candidate was rejected. (Status becomes 'rejected').
- 'recruiter_outreach': A recruiter reached out directly. (Status becomes 'saved').
- 'irrelevant': Not related to job applications.

Matching Rules:
- Compare the email sender and content with the list of existing applications.
- If it clearly relates to an existing application (even if company names differ slightly, e.g., "Wix.com" vs "Wix"), provide its "matched_app_id".
- If it is a new job application or doesn't match any existing, set "matched_app_id" to null.

Provide the response strictly as a JSON object with this exact structure:
{
  "classification": "confirmation" | "interview_invite" | "assessment" | "offer" | "rejection" | "recruiter_outreach" | "irrelevant",
  "matched_app_id": "string or null",
  "company": "Company Name (standardized, e.g. 'Wix' instead of 'Wix Recruiting')",
  "role_title": "Role Title (standardized)",
  "source": "e.g. 'LinkedIn' or null",
  "due_at": "ISO-8601 Datetime String for the interview/assessment deadline if found, otherwise null",
  "details": "A brief 1-2 sentence summary of what this email says."
}`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();
    
    // Use regex to extract JSON payload safely
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("Could not find JSON payload in Gemini response:", responseText);
      return { classification: 'irrelevant' };
    }

    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error("Gemini classification exception:", err);
    return { classification: 'irrelevant' };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  // Verify auth header if token is set
  const token = process.env.WEBAPP_JOBS_TOKEN;
  if (token && req.headers.authorization !== `Bearer ${token}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // Validate critical environment variables
  const missingEnv = [];
  if (!process.env.GOOGLE_CLIENT_ID) missingEnv.push('GOOGLE_CLIENT_ID');
  if (!process.env.GOOGLE_CLIENT_SECRET) missingEnv.push('GOOGLE_CLIENT_SECRET');
  if (!process.env.GEMINI_API_KEY) missingEnv.push('GEMINI_API_KEY');
  
  if (missingEnv.length > 0) {
    res.status(400).json({ 
      error: `Missing environment variable(s) in Vercel: ${missingEnv.join(', ')}. Please add them in Vercel Project Settings -> Environment Variables.` 
    });
    return;
  }

  try {
    // 1. Get Google OAuth tokens
    const tokens = await getGmailTokens();
    if (!tokens || !tokens.refresh_token) {
      res.status(400).json({ error: 'Google OAuth reconnect required. Please click Reconnect Gmail.', reconnect: true });
      return;
    }

    // 2. Initialize Google OAuth2 client
    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, getRedirectUri(req));
    oauth2Client.setCredentials({ refresh_token: tokens.refresh_token });

    // Validate access token/refresh
    try {
      await oauth2Client.getAccessToken();
    } catch (authErr) {
      console.error('Failed to get access token using refresh token:', authErr);
      
      const state = await getEmailState();
      const now = new Date();
      const lastNotified = state.last_notified_ts ? new Date(state.last_notified_ts) : null;
      const hoursSinceNotify = lastNotified ? (now - lastNotified) / (1000 * 60 * 60) : 999;

      if (hoursSinceNotify >= 20) {
        await updateEmailState({
          ...state,
          last_notified_ts: now.toISOString(),
          status: 'broken',
          error: 'Google OAuth token expired or revoked. Re-authenticate via dashboard.'
        });
      }

      res.status(401).json({ error: 'Google OAuth credentials expired. Please click Reconnect Gmail.', reconnect: true });
      return;
    }

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    // 3. Get scan state
    const state = await getEmailState();
    const lastScannedTs = state.last_scanned_ts;
    const seenIds = state.seen_ids || [];

    // Search query: get messages from last scanned timestamp or June 1st 2026 fallback
    let queryStr = '(subject:(application OR interview OR recruiter OR job OR update OR offer OR reject OR candidate) OR "job application" OR "thank you for applying")';
    if (lastScannedTs) {
      const scanDate = new Date(lastScannedTs);
      const unixSecs = Math.floor(scanDate.getTime() / 1000);
      queryStr += ` after:${unixSecs}`;
    } else {
      const juneFirstSecs = Math.floor(new Date('2026-06-01T00:00:00Z').getTime() / 1000);
      queryStr += ` after:${juneFirstSecs}`;
    }

    console.log('Searching Gmail with query:', queryStr);
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: queryStr,
      maxResults: 100
    });

    const messages = listRes.data.messages || [];
    const newMessages = messages.filter(msg => !seenIds.includes(msg.id));
    console.log(`Found ${messages.length} messages, ${newMessages.length} are new.`);

    // Fetch existing apps for fuzzy matching
    const existingApps = await getApplications();
    const shortAppsList = existingApps.map(a => ({ id: a.id, company: a.company, role_title: a.role_title }));

    const updates = [];
    const updatedSeenIds = [...seenIds];

    // Process messages in parallel batches of 5
    const BATCH_SIZE = 5;
    for (let i = 0; i < newMessages.length; i += BATCH_SIZE) {
      const batch = newMessages.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (msgInfo) => {
        try {
          const msgRes = await gmail.users.messages.get({
            userId: 'me',
            id: msgInfo.id,
            format: 'full'
          });

          const headers = msgRes.data.payload.headers || [];
          const subject = (headers.find(h => h.name.toLowerCase() === 'subject') || {}).value || '';
          const sender = (headers.find(h => h.name.toLowerCase() === 'from') || {}).value || '';
          const body = getBody(msgRes.data.payload);

          // Classify using Gemini
          const result = await classifyAndMatchEmail(subject, sender, body, shortAppsList);
          console.log(`Email ID ${msgInfo.id} classified as ${result.classification}`, result);

          if (result.classification !== 'irrelevant') {
            let appId = result.matched_app_id;
            
            if (!appId) {
              appId = await upsertApplication({
                company: result.company,
                role_title: result.role_title,
                source: result.source || 'Email',
                status: getStatusFromClassification(result.classification),
                notes: result.details
              });
              shortAppsList.push({ id: appId, company: result.company, role_title: result.role_title });
            } else {
              const targetStatus = getStatusFromClassification(result.classification);
              await updateApplication(appId, {
                status: targetStatus
              });
            }

            await addEvent(appId, {
              type: getEventTypeFromClassification(result.classification),
              detail: `${result.details} (Subject: ${subject})`,
              due_at: result.due_at
            });

            updates.push({
              id: appId,
              company: result.company,
              role_title: result.role_title,
              classification: result.classification,
              details: result.details
            });
          }

          updatedSeenIds.push(msgInfo.id);
        } catch (msgErr) {
          console.error(`Error processing email message ID ${msgInfo.id}:`, msgErr);
        }
      }));
    }

    if (updatedSeenIds.length > 1000) {
      updatedSeenIds.splice(0, updatedSeenIds.length - 1000);
    }

    const nowStr = new Date().toISOString();
    await updateEmailState({
      last_scanned_ts: nowStr,
      seen_ids: updatedSeenIds,
      last_notified_ts: null,
      status: 'healthy',
      error: null
    });

    res.status(200).json({
      status: 'success',
      scanned_at: nowStr,
      processed: newMessages.length,
      updates
    });

  } catch (err) {
    console.error('Error during Gmail sync execution:', err);
    res.status(500).json({ error: err.message });
  }
}

function getStatusFromClassification(cls) {
  switch (cls) {
    case 'confirmation': return 'applied';
    case 'interview_invite': return 'interview';
    case 'assessment': return 'screening';
    case 'offer': return 'offer';
    case 'rejection': return 'rejected';
    case 'recruiter_outreach': return 'saved';
    default: return 'applied';
  }
}

function getEventTypeFromClassification(cls) {
  switch (cls) {
    case 'confirmation': return 'email';
    case 'interview_invite': return 'appointment';
    case 'assessment': return 'reminder';
    case 'offer': return 'status_change';
    case 'rejection': return 'status_change';
    case 'recruiter_outreach': return 'email';
    default: return 'note';
  }
}
