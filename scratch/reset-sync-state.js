import { updateEmailState } from '../api/db.js';

async function resetState() {
  console.log("Resetting Gmail sync state in Firestore...");
  await updateEmailState({
    last_scanned_ts: null,
    seen_ids: [],
    last_notified_ts: null,
    status: 'healthy',
    error: null
  });
  console.log("Successfully reset Gmail scan state! Next scan will cover from June 1st, 2026.");
}

resetState().catch(console.error);
