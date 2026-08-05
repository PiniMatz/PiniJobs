import { db } from '../api/db.js';

async function fixJoinusDoc() {
  console.log("Checking Firestore for applications named 'Joinus' or 'joinus'...");
  const appsSnap = await db.collection('applications').get();
  
  let fixedCount = 0;
  for (const doc of appsSnap.docs) {
    const d = doc.data();
    if (d.company_lower === 'joinus' || d.company === 'Joinus' || d.company === 'Join us') {
      console.log(`Fixing app doc ${doc.id}: ${d.company} -> Hyro`);
      await db.collection('applications').doc(doc.id).update({
        company: 'Hyro',
        company_lower: 'hyro'
      });
      fixedCount++;
    }
  }

  console.log(`Finished! Updated ${fixedCount} application document(s) from Joinus to Hyro.`);
}

fixJoinusDoc().catch(console.error);
