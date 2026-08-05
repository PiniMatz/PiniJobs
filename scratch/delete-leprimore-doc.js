import { db } from '../api/db.js';

async function deleteLeprimoreDoc() {
  const docId = 'aevmLCwOmSMHHuYoM3YN';
  console.log(`Deleting false application document ${docId}...`);
  await db.collection('applications').doc(docId).delete();
  console.log(`Successfully deleted ${docId} from Firestore.`);
}

deleteLeprimoreDoc().catch(console.error);
