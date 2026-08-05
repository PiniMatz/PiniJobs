import handler from '../api/company-prep.js';
import { getApplications } from '../api/db.js';
import dotenv from 'dotenv';
dotenv.config();

async function debugEndpoint() {
  console.log("=== DEBUGGING API/COMPANY-PREP ENDPOINT ===");
  const apps = await getApplications();
  const activeApps = apps.filter(a => a.status !== 'terminated');
  const targetApp = activeApps[0];

  console.log(`Testing with App ID: ${targetApp.id} (${targetApp.company})`);

  const req = {
    query: { appId: targetApp.id, refresh: 'true' },
    headers: {
      authorization: `Bearer ${process.env.WEBAPP_JOBS_TOKEN}`
    }
  };

  const res = {
    setHeader: (k, v) => console.log(`[Header] ${k}: ${v}`),
    status: (code) => {
      console.log(`[HTTP Status] ${code}`);
      return {
        json: (data) => console.log(`[JSON Output]`, data)
      };
    }
  };

  try {
    await handler(req, res);
  } catch (err) {
    console.error("Endpoint Handler Crashed:", err);
  }
}

debugEndpoint().catch(console.error);
