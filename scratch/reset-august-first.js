import { updateEmailState } from '../api/db.js';

async function resetAugustFirst() {
  const augustFirst = '2026-08-01T00:00:00.000Z';
  console.log(`Setting last_scanned_ts to ${augustFirst} and clearing seen_ids...`);
  await updateEmailState({
    last_scanned_ts: augustFirst,
    seen_ids: [],
    last_notified_ts: null,
    status: 'healthy',
    error: null
  });
  console.log("Successfully reset Firestore state for August 1st re-scan!");
}

resetAugustFirst().catch(console.error);
