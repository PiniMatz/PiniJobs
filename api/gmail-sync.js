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
        body += html.replace(/<[^>]*>?/gm, ' ');
      } else if (part.parts) {
        body += getBody(part);
      }
    }
  }
  return body;
}

// Company Extraction Engine
function extractCompany(sender, subject, bodySnippet, activeCompaniesList = []) {
  const fullText = `${sender} ${subject} ${bodySnippet}`;
  
  // 1. Check against active companies from database dynamically
  for (const activeComp of activeCompaniesList) {
    if (activeComp && activeComp.length > 1) {
      const regex = new RegExp(`\\b${activeComp.replace(/[-[\]{}()*+?.:^$|\s]/g, '\\$&')}\\b`, 'i');
      if (regex.test(fullText)) {
        return activeComp;
      }
    }
  }

  // 2. Extract from subject patterns e.g. "...@ Hyro" or "...at Hyro" or "Role @ Company"
  const matchSubjectAt = subject.match(/(?:@|at)\s+([A-Z0-9-][A-Za-z0-9\s.-]+?)(?:\s+|$|!|\.)/);
  if (matchSubjectAt) {
    const candidateComp = matchSubjectAt[1].trim();
    if (candidateComp && candidateComp.length > 1 && !/riskified|sentra|cyera|intelligo|senior|product|manager|engineer|developer|role|position/i.test(candidateComp)) {
      return candidateComp.charAt(0).toUpperCase() + candidateComp.slice(1);
    }
  }

  // 3. Extract from sender name e.g. "Idan Gera - Intelligo <...>" or "Hyro <...>"
  const matchName = sender.match(/^"?([^"<]+)"?\s*</);
  if (matchName) {
    const namePart = matchName[1].trim();
    if (namePart.includes('-')) {
      const parts = namePart.split('-');
      const possibleCompany = parts[parts.length - 1].trim();
      if (possibleCompany && !/recruiting|careers|notifications|linkedin|digest|no-reply|noreply|support|join\s*us|joinus|team/i.test(possibleCompany)) {
        return possibleCompany;
      }
    } else if (namePart && !/recruiting|careers|notifications|linkedin|digest|no-reply|noreply|support|join\s*us|joinus|team/i.test(namePart)) {
      return namePart.charAt(0).toUpperCase() + namePart.slice(1);
    }
  }

  // 4. Extract from domain, stripping subdomains like joinus., apply., hiring., talent., careers., jobs.
  const matchDomain = sender.match(/@(?:joinus\.|apply\.|hiring\.|talent\.|careers\.|jobs\.|recruiting\.|workwithus\.|mail\.|email\.|notifications\.)*([a-z0-9-]+)\./i);
  if (matchDomain) {
    const domainName = matchDomain[1].toLowerCase();
    if (!['gmail', 'google', 'linkedin', 'teamtailor-mail', 'comeet-notifications', 'greenhouse', 'lever', 'ashbyhq', 'workday', 'smartrecruiters', '17track', 'claude', 'joinus'].includes(domainName)) {
      return domainName.charAt(0).toUpperCase() + domainName.slice(1);
    }
  }

  return null;
}

// Deterministic Multilingual Classification Engine
function classifyText(subject, bodySnippet) {
  const text = `${subject} ${bodySnippet}`.toLowerCase();

  // 0. Marketing / Hotel / Spa / Travel Exclusions
  if (
    text.includes('hotel & spa') ||
    text.includes('loyalty program') ||
    text.includes('package offers') ||
    text.includes('gift vouchers') ||
    text.includes('gastronomic programs') ||
    text.includes('room category')
  ) {
    return { classification: 'irrelevant', detail: '' };
  }

  // 1. Terminated / Rejection / Withdrawal
  if (
    text.includes('decided to move forward with other') ||
    text.includes('decided not to move forward') ||
    text.includes('not moving forward') ||
    text.includes('after careful consideration') ||
    text.includes('pursue other candidates') ||
    text.includes('pursuing other candidates') ||
    text.includes("won't be moving forward") ||
    text.includes("won't be progressing") ||
    text.includes("not be moving forward") ||
    text.includes("bummer it didn't work out") ||
    text.includes('application status') && text.includes('status update') ||
    text.includes('החלטה קלה') ||
    text.includes('להמשיך עם מועמדים אחרים') ||
    text.includes('לא להתקדם') ||
    text.includes('לא צלחה') ||
    text.includes('לא תואם') ||
    text.includes('בחרנו להתקדם')
  ) {
    return { 
      classification: 'terminated', 
      termination_type: text.includes("didn't work out") ? 'withdrawn_by_candidate' : 'rejected_by_company',
      detail: text.includes("didn't work out") ? 'Withdrawn by candidate' : 'Rejected by company' 
    };
  }

  // 2. Offer
  if (text.includes('pleased to offer') || text.includes('job offer') || text.includes('offer letter')) {
    return { classification: 'offer', detail: 'Job offer received' };
  }

  // 3. Home Task / Assessment (Strict context matching)
  if (
    text.includes('home assignment') ||
    /\btake-home\b|\btake home assignment\b|\btake home test\b|\btake home task\b|\btake home challenge\b/i.test(text) ||
    text.includes('coding challenge') ||
    text.includes('assessment link') ||
    text.includes('hackerrank') ||
    text.includes('codesignal') ||
    text.includes('karat') ||
    text.includes('codility')
  ) {
    return { classification: 'home_task', detail: 'Home assignment / assessment' };
  }

  // 4. Interview
  if (
    text.includes('video interview') ||
    text.includes('technical interview') ||
    text.includes('onsite interview') ||
    text.includes('interview with') ||
    text.includes('meet the team') ||
    text.includes('interview scheduled') ||
    text.includes('zoom interview')
  ) {
    return { classification: 'interview', detail: 'Interview scheduled' };
  }

  // 5. Screening
  if (
    text.includes('phone interview') ||
    text.includes('phone screen') ||
    text.includes('intro call') ||
    text.includes('quick chat') ||
    text.includes('speak to you soon') ||
    text.includes('when should we chat') ||
    text.includes('following up') ||
    text.includes('next steps')
  ) {
    return { classification: 'screening', detail: 'Screening / Intro call' };
  }

  // 6. Application Confirmation / Outreach
  if (
    text.includes('received your application') ||
    text.includes('thanks for applying') ||
    text.includes('thank you for applying') ||
    text.includes('application received') ||
    text.includes('we got it') ||
    text.includes("you've been recommended") ||
    text.includes("you've been referred") ||
    text.includes('welcome to our candidate') ||
    text.includes('welcome to our talent')
  ) {
    return { classification: 'applied', detail: 'Application confirmation' };
  }

  return { classification: 'irrelevant', detail: '' };
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
      error: `Missing environment variable(s) in Vercel: ${missingEnv.join(', ')}.` 
    });
    return;
  }

  try {
    const tokens = await getGmailTokens();
    if (!tokens || !tokens.refresh_token) {
      res.status(400).json({ error: 'Google OAuth reconnect required.', reconnect: true });
      return;
    }

    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, getRedirectUri(req));
    oauth2Client.setCredentials({ refresh_token: tokens.refresh_token });

    try {
      await oauth2Client.getAccessToken();
    } catch (authErr) {
      res.status(401).json({ error: 'Google OAuth credentials expired.', reconnect: true });
      return;
    }

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // DYNAMIC INJECTION: Fetch active (non-terminated) company names from database
    const existingApps = await getApplications();
    const activeApps = existingApps.filter(a => a.status !== 'terminated');
    const activeCompanyNames = [...new Set(activeApps.map(a => a.company ? a.company.trim() : '').filter(Boolean))];

    let dynamicCompanyTokens = '';
    if (activeCompanyNames.length > 0) {
      dynamicCompanyTokens = ' OR ' + activeCompanyNames.map(c => `"${c}"`).join(' OR ');
    }

    const state = await getEmailState();
    const forceReset = req.query.reset === '1' || req.query.reset === 'true';
    const lastScannedTs = forceReset ? null : state.last_scanned_ts;
    const seenIds = forceReset ? [] : (state.seen_ids || []);

    // Comprehensive Query with Dynamic Active Company Token Injection
    let queryStr = `(application OR apply OR applying OR applied OR interview OR recruiter OR job OR update OR offer OR reject OR candidate OR "got it" OR received OR thanks OR interest OR position OR role OR opportunity OR status OR submitted OR scheduling OR scheduled OR invite OR assessment OR challenge OR feedback OR unfortunately OR regret OR "moving forward" OR consideration OR pursuing OR candidacy OR decision OR process OR "following up" OR "next steps" OR "home assignment" OR "take home" OR "decided not to" OR greenhouse.io OR lever.co OR ashbyhq.com OR myworkday.com OR smartrecruiters.com OR workday.com OR comeet-notifications.com OR comeet.com OR comeet-mail.com OR teamtailor-mail.com OR teamtailor.com OR breezy.hr OR workablemail.com OR workable.com OR jobvite.com OR bamboohr.com OR pinpointhq.com OR recruitee.com OR personio.com OR hackerrank.com OR codesignal.com OR karat.com OR codility.com OR calendly.com${dynamicCompanyTokens})`;
    
    if (lastScannedTs) {
      const scanDate = new Date(lastScannedTs);
      const year = scanDate.getUTCFullYear();
      const month = String(scanDate.getUTCMonth() + 1).padStart(2, '0');
      const day = String(scanDate.getUTCDate()).padStart(2, '0');
      queryStr += ` after:${year}/${month}/${day}`;
    } else {
      queryStr += ` after:2026/05/31`;
    }

    console.log('Searching Gmail with dynamic query:', queryStr);

    // 1. Traverse ALL pages using nextPageToken
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

    // 2. Fetch full payloads in fast parallel batches of 25
    const fetchedMessages = [];
    const FETCH_BATCH = 25;
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

          if (subject.includes('people looked at your profile') || subject.includes('profile views')) {
            return;
          }

          const body = getBody(msgRes.data.payload);
          const internalMs = parseInt(msgRes.data.internalDate) || Date.now();

          fetchedMessages.push({
            email_id: msgInfo.id,
            sender,
            subject,
            snippet: body,
            internalMs,
            emailIsoDate: new Date(internalMs).toISOString(),
            emailDateStr: new Date(internalMs).toISOString().split('T')[0]
          });
        } catch (fetchErr) {
          console.error(`Failed to fetch message ID ${msgInfo.id}:`, fetchErr);
        }
      }));
    }

    // 3. Sort messages chronologically from OLDEST to NEWEST
    fetchedMessages.sort((a, b) => a.internalMs - b.internalMs);

    const updates = [];
    const updatedSeenIds = [...seenIds];

    const statusOrder = {
      applied: 1,
      screening: 2,
      interview: 3,
      home_task: 4,
      offer: 5,
      terminated: 6
    };

    // 4. Run Deterministic State Machine sequentially
    for (const msgItem of fetchedMessages) {
      try {
        const company = extractCompany(msgItem.sender, msgItem.subject, msgItem.snippet, activeCompanyNames);
        if (!company || ['Email', 'Mail', 'Us', 'Eu', 'Bounce4'].includes(company)) {
          updatedSeenIds.push(msgItem.email_id);
          continue;
        }

        const clsRes = classifyText(msgItem.subject, msgItem.snippet);
        if (clsRes.classification === 'irrelevant') {
          updatedSeenIds.push(msgItem.email_id);
          continue;
        }

        const matchedApp = existingApps.find(a => a.company_lower === company.toLowerCase());
        let appId;

        if (!matchedApp) {
          appId = await upsertApplication({
            company: company,
            role_title: 'Senior Product Manager',
            source: 'Email',
            status: clsRes.classification,
            notes: `${clsRes.detail}: ${msgItem.subject}`,
            applied_at: msgItem.emailDateStr,
            updated_at: msgItem.emailIsoDate
          });
          const newAppObj = { id: appId, company, company_lower: company.toLowerCase(), status: clsRes.classification, updated_at: msgItem.emailIsoDate, applied_at: msgItem.emailDateStr };
          existingApps.push(newAppObj);
        } else {
          appId = matchedApp.id;
          const currentStatus = matchedApp.status || 'applied';
          const currentUpdatedAtMs = matchedApp.updated_at ? new Date(matchedApp.updated_at).getTime() : 0;
          
          const currentRank = statusOrder[currentStatus] || 1;
          const targetRank = statusOrder[clsRes.classification] || 1;

          let shouldUpdateStatus = true;

          // STRICT TERMINATED LOCK:
          if (currentStatus === 'terminated') {
            shouldUpdateStatus = false;
          }

          // Forward-only progression:
          if (targetRank < currentRank || msgItem.internalMs <= currentUpdatedAtMs) {
            shouldUpdateStatus = false;
          }

          if (shouldUpdateStatus) {
            await updateApplication(appId, { 
              status: clsRes.classification,
              updated_at: msgItem.emailIsoDate
            });
            matchedApp.status = clsRes.classification;
            matchedApp.updated_at = msgItem.emailIsoDate;
          }

          if (!matchedApp.applied_at || msgItem.emailDateStr < matchedApp.applied_at) {
            await updateApplication(appId, { applied_at: msgItem.emailDateStr });
            matchedApp.applied_at = msgItem.emailDateStr;
          }
        }

        const eventType = getEventType(clsRes.classification);
        let eventDetail = `${clsRes.detail} (Subject: ${msgItem.subject})`;

        await addEvent(appId, {
          ts: msgItem.emailIsoDate,
          type: eventType,
          detail: eventDetail
        });

        updates.push({
          id: appId,
          company: company,
          classification: clsRes.classification,
          status: matchedApp ? matchedApp.status : clsRes.classification,
          details: eventDetail
        });

        updatedSeenIds.push(msgItem.email_id);
      } catch (msgErr) {
        console.error(`Error processing message ID ${msgItem.email_id}:`, msgErr);
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

function getEventType(cls) {
  switch (cls) {
    case 'recruiter_outreach': return 'email';
    case 'confirmation': return 'email';
    case 'screening': return 'appointment';
    case 'interview': return 'appointment';
    case 'home_task': return 'reminder';
    case 'offer': return 'email';
    case 'terminated': return 'email';
    default: return 'note';
  }
}
