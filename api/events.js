import { addEvent, getUpcomingEvents } from './db.js';

function validateAuth(req, res) {
  const token = process.env.WEBAPP_JOBS_TOKEN;
  if (!token) return true;
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${token}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (!validateAuth(req, res)) return;

  const { method, query } = req;
  const { action, appId } = query;

  try {
    if (method === 'GET') {
      if (action === 'upcoming') {
        const events = await getUpcomingEvents();
        res.status(200).json(events);
      } else {
        res.status(400).json({ error: 'Invalid or missing action parameter' });
      }
    } else if (method === 'POST') {
      if (!appId) {
        res.status(400).json({ error: 'Missing appId parameter' });
        return;
      }
      const eventId = await addEvent(appId, req.body);
      res.status(201).json({ success: true, id: eventId });
    } else {
      res.setHeader('Allow', ['GET', 'POST']);
      res.status(405).end(`Method ${method} Not Allowed`);
    }
  } catch (err) {
    console.error(`Error in /api/events handler:`, err);
    res.status(500).json({ error: err.message });
  }
}
