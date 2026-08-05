import { db } from '../api/db.js';

async function inspectData() {
  console.log("=== FIRESTORE APPLICATIONS ===");
  const appsSnap = await db.collection('applications').get();
  appsSnap.forEach(doc => {
    console.log(doc.id, "=>", doc.data());
  });

  console.log("\n=== FIRESTORE EVENTS ===");
  const eventsSnap = await db.collection('events').get();
  eventsSnap.forEach(doc => {
    console.log(doc.id, "=>", doc.data());
  });

  console.log("\n=== GMAIL STATE ===");
  const stateSnap = await db.collection('config').doc('gmail_state').get();
  console.log(stateSnap.data());
}

inspectData().catch(console.error);
