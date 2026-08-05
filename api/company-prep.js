import { GoogleGenerativeAI } from '@google/generative-ai';
import { getApplications, updateApplication, db } from './db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  const token = process.env.WEBAPP_JOBS_TOKEN;
  if (token && req.headers.authorization !== `Bearer ${token}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ 
      error: 'GEMINI_API_KEY is missing in environment variables. Please add GEMINI_API_KEY to Vercel project settings.' 
    });
    return;
  }

  const { appId } = req.query;
  if (!appId) {
    res.status(400).json({ error: 'Missing appId query parameter' });
    return;
  }

  try {
    const apps = await getApplications();
    const app = apps.find(a => a.id === appId);

    if (!app) {
      res.status(404).json({ error: 'Application not found' });
      return;
    }

    if (app.status === 'terminated') {
      res.status(400).json({ error: 'Cannot generate prep sheet for terminated application' });
      return;
    }

    // Return cached prep_summary if present, not force-refreshed, AND contains Hebrew translations
    const forceRefresh = req.query.refresh === 'true' || req.query.refresh === '1';
    const isBilingual = app.prep_summary && app.prep_summary.elevator_pitch_he;
    if (app.prep_summary && !forceRefresh && isBilingual) {
      res.status(200).json({ status: 'success', prep_summary: app.prep_summary });
      return;
    }

    // Try fetching text content from job URL or company domain if present
    let externalContext = '';
    const targetUrl = app.url || (app.company ? `https://www.${app.company.toLowerCase().replace(/[^a-z0-9]/g, '')}.com` : '');

    if (targetUrl) {
      try {
        const fetchRes = await fetch(targetUrl, { 
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: AbortSignal.timeout(4000) 
        }).catch(() => null);

        if (fetchRes && fetchRes.ok) {
          const html = await fetchRes.text();
          const cleanText = html.replace(/<script\b[^<]*>[\s\S]*?<\/script>/gi, '')
                                .replace(/<style\b[^<]*>[\s\S]*?<\/style>/gi, '')
                                .replace(/<[^>]*>?/gm, ' ')
                                .replace(/\s+/g, ' ')
                                .substring(0, 3000);
          externalContext = `Web Content snippet: ${cleanText}`;
        }
      } catch (e) {
        console.log('External fetch failed, proceeding with LLM knowledge:', e.message);
      }
    }

    // Build prompt for Gemini
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const prompt = `
You are an expert executive career coach helping a candidate prepare for an initial recruiter screening call for the company "${app.company}" for the role "${app.role_title || 'Senior Product Manager'}".

Additional Context:
- Notes: ${app.notes || 'None'}
- Job URL: ${app.url || 'Not provided'}
- External Snippet: ${externalContext || 'Not provided'}

Task: Generate a concise, high-impact screening cheat sheet. Provide content in English and also provide an accurate Hebrew translation for each section right below. Formatted strictly as valid JSON with the following key structure:
{
  "elevator_pitch": "2-sentence quick summary of what the company does and why it matters in English",
  "elevator_pitch_he": "Hebrew translation of elevator pitch (תקציר החברה בעברית)",
  "company_overview": [
    "Overview point 1 in English",
    "Overview point 2 in English",
    "Overview point 3 in English"
  ],
  "company_overview_he": [
    "נקודה 1 בעברית",
    "נקודה 2 בעברית",
    "נקודה 3 בעברית"
  ],
  "job_highlights": [
    "Key responsibility 1 in English",
    "Key responsibility 2 in English",
    "Mandatory skill 1 in English",
    "Mandatory skill 2 in English"
  ],
  "job_highlights_he": [
    "אחריות עיקרית 1 בעברית",
    "אחריות עיקרית 2 בעברית",
    "דרישה/מיומנות 1 בעברית",
    "דרישה/מיומנות 2 בעברית"
  ],
  "why_us_pitch": "2-sentence answer for 'Why are you interested in this position & company?' in English",
  "why_us_pitch_he": "תרגום עברי למענה על 'למה דווקא החברה הזו'",
  "questions_for_recruiter": [
    "Smart question 1 in English",
    "Smart question 2 in English",
    "Smart question 3 in English"
  ],
  "questions_for_recruiter_he": [
    "שאלה חכמה 1 למגייס/ת בעברית",
    "שאלה חכמה 2 למגייס/ת בעברית",
    "שאלה חכמה 3 למגייס/ת בעברית"
  ],
  "key_tech_tags": ["Tag1", "Tag2", "Tag3", "Tag4"],
  "useful_links": [
    { "title": "Company Website", "url": "https://www.${app.company.toLowerCase().replace(/[^a-z0-9]/g, '')}.com" },
    ${app.url ? `{ "title": "Job Posting Link", "url": "${app.url}" }` : ''}
  ]
}

IMPORTANT: Respond ONLY with raw valid JSON without markdown wrapping or commentary.
`;

    const result = await model.generateContent(prompt);
    const rawText = result.response.text();
    
    // Parse JSON
    let prepSummary;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      prepSummary = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    } catch (parseErr) {
      console.error('Failed to parse Gemini output:', rawText);
      prepSummary = {
        elevator_pitch: `${app.company} operates in the tech sector, focusing on innovative product solutions for its target market.`,
        company_overview: `• Leading technology provider\n• Product offerings tailored to business & enterprise needs\n• High-growth engineering and product team`,
        job_highlights: [
          `Lead product strategy and execution for ${app.role_title || 'Senior Product Manager'}`,
          'Collaborate with engineering, design, and business stakeholders',
          'Deep expertise in data-driven product development and roadmapping'
        ],
        why_us_pitch: `I am excited about ${app.company}'s vision and see a strong alignment with my Senior Product Manager background driving high-impact product roadmaps.`,
        questions_for_recruiter: [
          'What are the primary business priorities driving this role right now?',
          'What is the structure of the product & engineering teams I would be collaborating with?',
          'What does the upcoming interview process look like from here?'
        ],
        key_tech_tags: ['Product Management', 'Strategy', 'Roadmapping', 'Agile']
      };
    }

    // Save prep_summary to Firestore application document
    await updateApplication(appId, { prep_summary: prepSummary });

    res.status(200).json({ status: 'success', prep_summary: prepSummary });

  } catch (err) {
    console.error('Error generating company prep:', err);
    res.status(500).json({ error: err.message });
  }
}
