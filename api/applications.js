import { getApplications, getApplication, upsertApplication, updateApplication, deleteApplication } from './db.js';

function validateAuth(req, res) {
  const token = process.env.WEBAPP_JOBS_TOKEN;
  if (!token) {
    return true; // Bypass validation if token is not configured (e.g. local dev)
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${token}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,DELETE,PATCH,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (!validateAuth(req, res)) {
    return;
  }

  const { method, query } = req;
  const { id, status } = query;

  try {
    switch (method) {
      case 'GET':
        if (id) {
          // Get single application with timeline
          const app = await getApplication(id);
          if (!app) {
            res.status(404).json({ error: 'Application not found' });
            return;
          }
          res.status(200).json(app);
        } else {
          // Get list of applications
          const list = await getApplications(status || null);
          res.status(200).json(list);
        }
        break;

      case 'POST':
        // Create new or update (upsert)
        const newId = await upsertApplication(req.body);
        res.status(201).json({ success: true, id: newId });
        break;

      case 'PATCH':
        if (!id) {
          res.status(400).json({ error: 'Missing id parameter' });
          return;
        }
        await updateApplication(id, req.body);
        res.status(200).json({ success: true, id });
        break;

      case 'DELETE':
        if (!id) {
          res.status(400).json({ error: 'Missing id parameter' });
          return;
        }
        await deleteApplication(id);
        res.status(200).json({ success: true });
        break;

      default:
        res.setHeader('Allow', ['GET', 'POST', 'PATCH', 'DELETE']);
        res.status(405).end(`Method ${method} Not Allowed`);
    }
  } catch (err) {
    console.error(`Error in /api/applications handler:`, err);
    res.status(500).json({ error: err.message });
  }
}
