import { updateEmailState } from '../api/db.js';

async function setWatermark() {
  const augustFirst = '2026-08-01T00:00:00.000Z';
  console.log(`Setting Gmail scan watermark in Firestore to ${augustFirst}...`);
  await updateEmailState({
    last_scanned_ts: augustFirst,
    last_notified_ts: null,
    status: 'healthy',
    error: null
  });
  console.log(`Successfully updated last_scanned_ts to August 1st, 2026!`);
}

setWatermark().catch(console.error);
