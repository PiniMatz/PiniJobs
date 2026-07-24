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

// Multi-email batch classifier with Multilingual (Hebrew & English) support
async function classifyAndMatchEmailBatch(emailsChunk, existingApps) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('GEMINI_API_KEY environment variable is missing.');
    return [];
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `You are an AI assistant parsing emails for a job application tracker.
Analyze the following array of emails and classify each one.
Current Year: 2026.
Languages: Emails can be in ENGLISH or HEBREW (עברית).

Emails to analyze:
${JSON.stringify(emailsChunk, null, 2)}

Existing tracked applications:
${JSON.stringify(existingApps, null, 2)}

Classification Buckets:
- 'recruiter_outreach': Cold recruiter message, "we have an opening", LinkedIn InMail forward.
- 'confirmation': Application received, "thank you for applying", "we received your application", auto-ack from an ATS (Greenhouse/Lever/Workday/Comeet/Teamtailor/etc).
- 'screening_invite': Recruiter/HR wants a call before technical stage, "quick chat", "phone screen", "intro call with recruiter" (sender is HR/recruiter, not technical/hiring manager).
- 'interview_invite': Technical/onsite/hiring-manager interview scheduled, calendar invite, "technical interview", "onsite", "meet the team", interview with engineer/hiring manager.
- 'home_task': Take-home assignment, coding challenge, assessment link, HackerRank/CodeSignal/Karat invite, deadline to submit work.
- 'offer': Job offer letter, verbal offer follow-up, "pleased to offer", comp details, start date proposal.
- 'terminated': Process ended on either side. Rejection in English ("decided to move forward with other candidates", "not moving forward", "after careful consideration") OR Rejection in Hebrew ("זו לא הייתה החלטה קלה", "החלטנו להמשיך עם מועמדים אחרים", "לא צלחה", "לא להתקדם", "לא תואם") OR candidate withdrawing ("bummer it didn't work out", "withdrawing my application").
- 'irrelevant': Newsletters, marketing, job-board digests without specific application match.

Matching Rules:
- Compare the email sender and content with the list of existing applications.
- If it clearly relates to an existing application (even if company names differ slightly, e.g., "Wix.com" vs "Wix"), provide its "matched_app_id".
- If it is ambiguous (could plausibly match 2+ applications), set "matched_app_id" to null.
- If it is a new application lead or doesn't match any existing, set "matched_app_id" to null.

Provide the response strictly as a JSON array of objects, one for each email in the input order:
[
  {
    "email_id": "string (matches input email_id)",
    "classification": "recruiter_outreach" | "confirmation" | "screening_invite" | "interview_invite" | "home_task" | "offer" | "terminated" | "irrelevant",
    "matched_app_id": "string or null",
    "company": "Company Name (standardized, e.g., 'Cyera', 'Intelligo', 'Sentra', 'Wix')",
    "role_title": "Role Title (standardized)",
    "source": "e.g. 'LinkedIn', 'Referral', or null",
    "due_at": "ISO-8601 Datetime String for scheduled call/interview or assignment submission deadline if found, otherwise null",
    "termination_type": "'rejected_by_company' | 'withdrawn_by_candidate' | null",
    "details": "A brief 1-2 sentence summary of what this email says."
  }
]`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();
    
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.warn("Could not find JSON array payload in Gemini response:", responseText);
      return [];
    }

    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error("Gemini batch classification exception:", err);
    return [];
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  const token = process.env.WEBAPP_JOBS_TOKEN;
  if (token && req.headers.authorization !== `Bearer ${token}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

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
    const tokens = await getGmailTokens();
    if (!tokens || !tokens.refresh_token) {
      res.status(400).json({ error: 'Google OAuth reconnect required. Please click Reconnect Gmail.', reconnect: true });
      return;
    }

    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, getRedirectUri(req));
    oauth2Client.setCredentials({ refresh_token: tokens.refresh_token });

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
    
    const state = await getEmailState();
    const forceReset = req.query.reset === '1' || req.query.reset === 'true';
    const lastScannedTs = forceReset ? null : state.last_scanned_ts;
    const seenIds = forceReset ? [] : (state.seen_ids || []);

    let queryStr = '(application OR apply OR applying OR applied OR interview OR recruiter OR job OR update OR offer OR reject OR candidate OR "got it" OR received OR thanks OR interest OR position OR role OR opportunity OR status OR submitted OR scheduling OR scheduled OR invite OR assessment OR challenge OR feedback OR unfortunately OR regret OR "moving forward" OR consideration OR pursuing OR candidacy OR decision OR process OR "following up" OR "next steps" OR "home assignment" OR "take home" OR greenhouse.io OR lever.co OR ashbyhq.com OR myworkday.com OR smartrecruiters.com OR workday.com OR comeet-notifications.com OR comeet.com OR comeet-mail.com OR teamtailor-mail.com OR teamtailor.com OR breezy.hr OR workablemail.com OR workable.com OR jobvite.com OR bamboohr.com OR pinpointhq.com OR recruitee.com OR personio.com OR hackerrank.com OR codesignal.com OR karat.com OR codility.com OR calendly.com OR intelligo OR sentra OR cyera)';
    
    if (lastScannedTs) {
      const scanDate = new Date(lastScannedTs);
      const year = scanDate.getUTCFullYear();
      const month = String(scanDate.getUTCMonth() + 1).padStart(2, '0');
      const day = String(scanDate.getUTCDate()).padStart(2, '0');
      queryStr += ` after:${year}/${month}/${day}`;
    } else {
      queryStr += ` after:2026/05/31`;
    }

    console.log('Searching Gmail with query:', queryStr);

    // 1. Fetch ALL pages of messages matching the query
    let allMessages = [];
    let pageToken = null;
    do {
      const listRes = await gmail.users.messages.list({
        userId: 'me',
        q: queryStr,
        maxResults: 100,
        pageToken: pageToken
      });
      if (listRes.data.messages) {
        allMessages.push(...listRes.data.messages);
      }
      pageToken = listRes.data.nextPageToken;
    } while (pageToken);

    const newMessages = allMessages.filter(msg => !seenIds.includes(msg.id));
    console.log(`Found ${allMessages.length} total messages across all pages, ${newMessages.length} are new.`);

    // 2. Fetch full payloads for new messages & skip generic social profile view digests
    const fetchedMessages = [];
    const FETCH_BATCH = 10;
    for (let i = 0; i < newMessages.length; i += FETCH_BATCH) {
      const batch = newMessages.slice(i, i + FETCH_BATCH);
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

          // Filter out non-application social digests
          if (subject.includes('people looked at your profile') || subject.includes('profile views')) {
            return;
          }

          const body = getBody(msgRes.data.payload);
          const internalMs = parseInt(msgRes.data.internalDate) || Date.now();
          
          fetchedMessages.push({
            email_id: msgInfo.id,
            sender,
            subject,
            snippet: body.substring(0, 1500),
            internalMs
          });
        } catch (fetchErr) {
          console.error(`Failed to fetch message ID ${msgInfo.id}:`, fetchErr);
        }
      }));
    }

    // 3. Sort messages chronologically from OLDEST to NEWEST
    fetchedMessages.sort((a, b) => a.internalMs - b.internalMs);
    console.log(`Sorted ${fetchedMessages.length} application emails chronologically.`);

    const existingApps = await getApplications();
    const shortAppsList = existingApps.map(a => ({ id: a.id, company: a.company, role_title: a.role_title, status: a.status }));

    const updates = [];
    const updatedSeenIds = [...seenIds];

    // 4. Classify messages in AI batches of 10
    const AI_BATCH_SIZE = 10;
    for (let i = 0; i < fetchedMessages.length; i += AI_BATCH_SIZE) {
      const chunk = fetchedMessages.slice(i, i + AI_BATCH_SIZE);
      const classifications = await classifyAndMatchEmailBatch(chunk, shortAppsList);

      for (const msgItem of chunk) {
        try {
          const result = classifications.find(c => c.email_id === msgItem.email_id) || { classification: 'irrelevant' };
          const emailIsoDate = new Date(msgItem.internalMs).toISOString();
          const emailDateStr = emailIsoDate.split('T')[0];

          if (result.classification !== 'irrelevant') {
            let appId = result.matched_app_id;
            const matchedApp = existingApps.find(a => a.id === appId);
            const targetStatus = getStatusFromClassification(result.classification);

            if (!appId) {
              appId = await upsertApplication({
                company: result.company,
                role_title: result.role_title,
                source: result.source || 'Email',
                status: targetStatus,
                notes: result.details,
                applied_at: emailDateStr,
                updated_at: emailIsoDate
              });
              const newAppObj = { id: appId, company: result.company, role_title: result.role_title, status: targetStatus, updated_at: emailIsoDate, applied_at: emailDateStr };
              existingApps.push(newAppObj);
              shortAppsList.push({ id: appId, company: result.company, role_title: result.role_title, status: targetStatus });
            } else {
              const currentStatus = matchedApp ? matchedApp.status : 'applied';
              const currentUpdatedAtMs = matchedApp && matchedApp.updated_at ? new Date(matchedApp.updated_at).getTime() : 0;

              let shouldUpdateStatus = true;

              // STRICT TERMINATED LOCK:
              // Once an application reaches 'terminated', NO email (even if newer) can move it back out of 'terminated'!
              if (currentStatus === 'terminated') {
                shouldUpdateStatus = false;
              }

              // Forward-only rule: Only update status if incoming email timestamp is newer
              if (msgItem.internalMs <= currentUpdatedAtMs) {
                shouldUpdateStatus = false;
              }

              if (shouldUpdateStatus) {
                await updateApplication(appId, { 
                  status: targetStatus,
                  updated_at: emailIsoDate
                });
                if (matchedApp) {
                  matchedApp.status = targetStatus;
                  matchedApp.updated_at = emailIsoDate;
                }
              }

              if (matchedApp && (!matchedApp.applied_at || emailDateStr < matchedApp.applied_at)) {
                await updateApplication(appId, { applied_at: emailDateStr });
                matchedApp.applied_at = emailDateStr;
              }
            }

            const eventType = getEventType(result.classification, result.due_at);
            let eventDetail = result.details;

            if (result.classification === 'terminated') {
              if (result.termination_type === 'withdrawn_by_candidate') {
                eventDetail = `Withdrawn by candidate: ${result.details}`;
              } else {
                eventDetail = `Rejected by company: ${result.details}`;
              }
            }

            await addEvent(appId, {
              ts: emailIsoDate,
              type: eventType,
              detail: `${eventDetail} (Subject: ${msgItem.subject})`,
              due_at: result.due_at
            });

            updates.push({
              id: appId,
              company: result.company,
              role_title: result.role_title,
              classification: result.classification,
              status: targetStatus,
              details: eventDetail
            });
          }

          updatedSeenIds.push(msgItem.email_id);
        } catch (msgErr) {
          console.error(`Error processing message ID ${msgItem.email_id}:`, msgErr);
        }
      }
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
      processed: fetchedMessages.length,
      updates
    });

  } catch (err) {
    console.error('Error during Gmail sync execution:', err);
    res.status(500).json({ error: err.message });
  }
}

function getStatusFromClassification(cls) {
  switch (cls) {
    case 'recruiter_outreach': return 'applied';
    case 'confirmation': return 'applied';
    case 'screening_invite': return 'screening';
    case 'interview_invite': return 'interview';
    case 'home_task': return 'home_task';
    case 'offer': return 'offer';
    case 'terminated': return 'terminated';
    default: return 'applied';
  }
}

function getEventType(cls, dueAt) {
  switch (cls) {
    case 'recruiter_outreach': return 'email';
    case 'confirmation': return 'email';
    case 'screening_invite': return dueAt ? 'appointment' : 'note';
    case 'interview_invite': return 'appointment';
    case 'home_task': return dueAt ? 'reminder' : 'note';
    case 'offer': return 'email';
    case 'terminated': return 'email';
    default: return 'note';
  }
}
