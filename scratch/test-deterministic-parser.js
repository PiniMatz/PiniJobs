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

function extractCompany(sender, subject, bodySnippet) {
  const fullText = `${sender} ${subject} ${bodySnippet}`;
  
  if (/cyera/i.test(fullText)) return 'Cyera';
  if (/intelligo/i.test(fullText)) return 'Intelligo';
  if (/sentra/i.test(fullText)) return 'Sentra';
  if (/riskified/i.test(fullText)) return 'Riskified';
  if (/sensi/i.test(fullText)) return 'Sensi.AI';
  if (/dun\s*&\s*bradstreet|d&b/i.test(fullText)) return 'Dun & Bradstreet';
  if (/wix/i.test(fullText)) return 'Wix';

  // Extract from sender name e.g. "Idan Gera - Intelligo <...>"
  const matchName = sender.match(/^"?([^"<]+)"?\s*</);
  if (matchName) {
    const namePart = matchName[1].trim();
    if (namePart.includes('-')) {
      const parts = namePart.split('-');
      const possibleCompany = parts[parts.length - 1].trim();
      if (possibleCompany && !/recruiting|careers|notifications|linkedin|digest/i.test(possibleCompany)) {
        return possibleCompany;
      }
    }
  }

  // Extract from email domain e.g. no-reply@careers.cyera.io
  const matchDomain = sender.match(/@(?:careers\.|jobs\.|recruiting\.)?([a-z0-9-]+)\./i);
  if (matchDomain) {
    const domainName = matchDomain[1].toLowerCase();
    if (!['gmail', 'google', 'linkedin', 'teamtailor-mail', 'comeet-notifications', 'greenhouse', 'lever', 'ashbyhq', 'workday', 'smartrecruiters'].includes(domainName)) {
      return domainName.charAt(0).toUpperCase() + domainName.slice(1);
    }
  }

  return null;
}

function classifyText(subject, bodySnippet) {
  const text = `${subject} ${bodySnippet}`.toLowerCase();

  // 1. Terminated / Rejection / Withdrawal
  if (
    text.includes('decided to move forward with other') ||
    text.includes('not moving forward') ||
    text.includes('after careful consideration') ||
    text.includes('pursue other candidates') ||
    text.includes('pursuing other candidates') ||
    text.includes("won't be moving forward") ||
    text.includes("won't be progressing") ||
    text.includes("not be moving forward") ||
    text.includes("bummer it didn't work out") ||
    text.includes('החלטה קלה') ||
    text.includes('להמשיך עם מועמדים אחרים') ||
    text.includes('לא להתקדם') ||
    text.includes('לא צלחה') ||
    text.includes('לא תואם') ||
    text.includes('בחרנו להתקדם')
  ) {
    return { classification: 'terminated', detail: text.includes("didn't work out") ? 'Withdrawn by candidate' : 'Rejected by company' };
  }

  // 2. Offer
  if (text.includes('pleased to offer') || text.includes('job offer') || text.includes('offer letter')) {
    return { classification: 'offer', detail: 'Job offer received' };
  }

  // 3. Home Task / Assessment
  if (
    text.includes('home assignment') ||
    text.includes('take home') ||
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
    text.includes('welcome to')
  ) {
    return { classification: 'applied', detail: 'Application confirmation' };
  }

  return { classification: 'irrelevant', detail: '' };
}

async function testDeterministic() {
  const tokens = await getGmailTokens();
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'http://localhost:3000/api/auth'
  );
  oauth2Client.setCredentials({ refresh_token: tokens.refresh_token });
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const queryStr = '(application OR apply OR applying OR applied OR interview OR recruiter OR job OR update OR offer OR reject OR candidate OR "got it" OR received OR thanks OR interest OR position OR role OR opportunity OR status OR submitted OR scheduling OR scheduled OR invite OR assessment OR challenge OR feedback OR unfortunately OR regret OR "moving forward" OR consideration OR pursuing OR candidacy OR decision OR process OR "following up" OR "next steps" OR "home assignment" OR "take home" OR greenhouse.io OR lever.co OR ashbyhq.com OR myworkday.com OR smartrecruiters.com OR workday.com OR comeet-notifications.com OR comeet.com OR comeet-mail.com OR teamtailor-mail.com OR teamtailor.com OR breezy.hr OR workablemail.com OR workable.com OR jobvite.com OR bamboohr.com OR pinpointhq.com OR recruitee.com OR personio.com OR hackerrank.com OR codesignal.com OR karat.com OR codility.com OR calendly.com OR intelligo OR sentra OR cyera) after:2026/05/31';

  console.log("Fetching all message headers...");
  let allMessages = [];
  let pageToken = null;

  do {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: queryStr,
      maxResults: 100,
      pageToken: pageToken
    });
    if (res.data.messages) {
      allMessages.push(...res.data.messages);
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  console.log(`Fetched ${allMessages.length} message IDs. Fetching headers in fast parallel batches...`);

  const fetched = [];
  const BATCH_SIZE = 25;

  for (let i = 0; i < allMessages.length; i += BATCH_SIZE) {
    const batch = allMessages.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (msg) => {
      try {
        const msgRes = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
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

        fetched.push({
          id: msg.id,
          sender,
          subject,
          snippet: body,
          internalMs,
          dateStr: new Date(internalMs).toISOString().split('T')[0]
        });
      } catch (err) {
        console.error("Error fetching message", msg.id, err);
      }
    }));
  }

  // Sort chronologically OLDEST to NEWEST
  fetched.sort((a, b) => a.internalMs - b.internalMs);

  console.log(`\nProcessed ${fetched.length} non-digest messages. Running State Machine...\n`);

  const apps = {};

  const statusOrder = {
    applied: 1,
    screening: 2,
    interview: 3,
    home_task: 4,
    offer: 5,
    terminated: 6
  };

  for (const item of fetched) {
    const company = extractCompany(item.sender, item.subject, item.snippet);
    if (!company) continue;

    const res = classifyText(item.subject, item.snippet);
    if (res.classification === 'irrelevant') continue;

    if (!apps[company]) {
      apps[company] = {
        company,
        status: res.classification,
        applied_at: item.dateStr,
        updated_at: item.dateStr,
        updated_ms: item.internalMs,
        events: []
      };
    } else {
      const app = apps[company];

      // Earliest applied_at
      if (item.dateStr < app.applied_at) {
        app.applied_at = item.dateStr;
      }

      // Linear Status Machine
      const currentRank = statusOrder[app.status] || 1;
      const targetRank = statusOrder[res.classification] || 1;

      // Lock Terminated status permanently once reached
      if (app.status !== 'terminated') {
        if (targetRank >= currentRank && item.internalMs > app.updated_ms) {
          app.status = res.classification;
          app.updated_at = item.dateStr;
          app.updated_ms = item.internalMs;
        }
      }
    }

    apps[company].events.push({
      date: item.dateStr,
      subject: item.subject,
      classification: res.classification,
      detail: res.detail
    });
  }

  console.log("=== FINAL DETERMINISTIC BOARD STATE ===");
  console.table(Object.values(apps).map(a => ({
    Company: a.company,
    Status: a.status,
    AppliedAt: a.applied_at,
    LatestUpdate: a.updated_at,
    EventsCount: a.events.length
  })));

  console.log("\n=== DETAILED COMPANY TIMELINES ===");
  for (const [comp, data] of Object.entries(apps)) {
    console.log(`\n🏢 ${comp} [Status: ${data.status.toUpperCase()}] (Applied: ${data.applied_at}, Last Activity: ${data.updated_at})`);
    data.events.forEach(e => console.log(`  - [${e.date}] (${e.classification}) ${e.subject}`));
  }
}

testDeterministic().catch(console.error);
