import { google } from 'googleapis';
import { getGmailTokens } from '../api/db.js';
import dotenv from 'dotenv';
dotenv.config();

async function testPagination() {
  const tokens = await getGmailTokens();
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'http://localhost:3000/api/auth'
  );
  oauth2Client.setCredentials({ refresh_token: tokens.refresh_token });
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const queryStr = '(application OR apply OR applying OR applied OR interview OR recruiter OR job OR update OR offer OR reject OR candidate OR "got it" OR received OR thanks OR interest OR position OR role OR opportunity OR status OR submitted OR scheduling OR scheduled OR invite OR assessment OR challenge OR feedback OR unfortunately OR regret OR "moving forward" OR consideration OR pursuing OR candidacy OR decision OR process OR "following up" OR "next steps" OR "home assignment" OR "take home" OR greenhouse.io OR lever.co OR ashbyhq.com OR myworkday.com OR smartrecruiters.com OR workday.com OR comeet-notifications.com OR comeet.com OR comeet-mail.com OR teamtailor-mail.com OR teamtailor.com OR breezy.hr OR workablemail.com OR workable.com OR jobvite.com OR bamboohr.com OR pinpointhq.com OR recruitee.com OR personio.com OR hackerrank.com OR codesignal.com OR karat.com OR codility.com OR calendly.com OR intelligo OR sentra OR cyera) after:2026/05/31';

  let allMessages = [];
  let pageToken = null;
  let pageCount = 0;

  do {
    pageCount++;
    console.log(`Fetching page ${pageCount}...`);
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

  console.log(`Total messages found across all ${pageCount} pages: ${allMessages.length}`);
}

testPagination().catch(console.error);
