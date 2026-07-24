import { db, updateEmailState } from '../api/db.js';

async function cleanFirestore() {
  console.log("Cleaning old test data from Firestore...");

  // 1. Delete all applications
  const appsSnapshot = await db.collection('applications').get();
  const appBatch = db.batch();
  appsSnapshot.forEach(doc => appBatch.delete(doc.ref));
  await appBatch.commit();
  console.log(`Deleted ${appsSnapshot.size} old application documents.`);

  // 2. Delete all events
  const eventsSnapshot = await db.collection('events').get();
  const eventBatch = db.batch();
  eventsSnapshot.forEach(doc => eventBatch.delete(doc.ref));
  await eventBatch.commit();
  console.log(`Deleted ${eventsSnapshot.size} old event documents.`);

  // 3. Reset email scan state
  await updateEmailState({
    last_scanned_ts: null,
    seen_ids: [],
    last_notified_ts: null,
    status: 'healthy',
    error: null
  });
  console.log("Reset Gmail scan watermark to null (June 1st full scan).");

  console.log("Firestore cleanup complete!");
}

cleanFirestore().catch(console.error);
