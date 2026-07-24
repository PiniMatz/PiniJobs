import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

async function run() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Error: GEMINI_API_KEY is not configured in environment variables.");
    return;
  }

  console.log("Initializing Gemini API test...");
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const mockEmail = {
    sender: "recruiting@wix.com",
    subject: "Wix.com — Interview Invite for Senior Full Stack Engineer",
    body: "Hi Pini,\n\nWe were impressed by your background and would like to invite you to a 45-minute technical screen on Monday, July 27, 2026 at 11:30 AM.\n\nPlease confirm if this time works for you.\n\nBest,\n recruiter name"
  };

  const existingApps = [
    { id: "app-1", company: "Google", role_title: "Software Engineer" },
    { id: "app-2", company: "Wix", role_title: "Senior Full Stack Engineer" }
  ];

  const prompt = `You are an AI assistant parsing emails for a job application tracker.
Analyze the following email and classify/match it.
Current Year: 2026.

Email Details:
Sender: ${mockEmail.sender}
Subject: ${mockEmail.subject}
Body Snippet: ${mockEmail.body}

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

Provide the response strictly as a JSON object with this exact structure (no markdown wrappers, no extra text):
{
  "classification": "confirmation" | "interview_invite" | "assessment" | "offer" | "rejection" | "recruiter_outreach" | "irrelevant",
  "matched_app_id": "string or null",
  "company": "Company Name (standardized, e.g. 'Wix' instead of 'Wix Recruiting')",
  "role_title": "Role Title (standardized)",
  "source": "e.g. 'LinkedIn' or null",
  "due_at": "ISO-8601 Datetime String for the interview/assessment deadline if found, otherwise null",
  "details": "A brief 1-2 sentence summary of what this email says."
}`;

  try {
    console.log("Sending query to Gemini...");
    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();
    console.log("Raw Response from Gemini:\n", responseText);

    const cleanJson = responseText.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(cleanJson);
    console.log("\nParsed JSON successfully!");
    console.log(JSON.stringify(parsed, null, 2));

    if (parsed.classification === 'interview_invite' && parsed.matched_app_id === 'app-2') {
      console.log("\nGemini Classification & Matching test PASSED!");
    } else {
      console.warn("\nWarning: Output didn't match expected values, but JSON parsing succeeded.");
    }
  } catch (err) {
    console.error("Gemini API test FAILED:", err);
  }
}

run();
