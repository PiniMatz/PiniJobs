import { getApplications, db } from '../api/db.js';
import handler from '../api/company-prep.js';
import dotenv from 'dotenv';
dotenv.config();

async function testPrepFeature() {
  console.log("=== TESTING RECRUITER PREP FEATURE ===");
  const apps = await getApplications();
  const activeApps = apps.filter(a => a.status !== 'terminated');
  
  console.log(`Found ${activeApps.length} active (non-terminated) applications:`);
  activeApps.forEach(a => console.log(` - [${a.status}] ${a.company}: ${a.role_title}`));

  if (activeApps.length === 0) {
    console.log("No active applications found.");
    return;
  }

  const targetApp = activeApps[0];
  console.log(`\nTesting AI cheat sheet generation for active app ${targetApp.company} (${targetApp.id})...`);

  const req = {
    query: { appId: targetApp.id, refresh: 'true' },
    headers: {
      authorization: `Bearer ${process.env.WEBAPP_JOBS_TOKEN}`
    }
  };

  let jsonResult = null;
  const res = {
    setHeader: () => {},
    status: (code) => {
      console.log(`HTTP Status: ${code}`);
      return {
        json: (data) => {
          jsonResult = data;
        }
      };
    }
  };

  await handler(req, res);
  console.log("Result:", JSON.stringify(jsonResult, null, 2));
}

testPrepFeature().catch(console.error);
