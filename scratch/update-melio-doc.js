import { db } from '../api/db.js';

async function updateMelioDoc() {
  const docId = 'ge5YkEIs7r67zIjuyrPw';
  const isoDate = '2026-08-05T07:00:10.000Z';
  console.log(`Updating Melio doc ${docId} to terminated...`);
  
  await db.collection('applications').doc(docId).update({
    status: 'terminated',
    updated_at: isoDate
  });

  await db.collection('applications').doc(docId).collection('events').add({
    ts: isoDate,
    type: 'email',
    detail: 'Rejected by company (Subject: Senior Product Manager opportunity at Melio)'
  });

  console.log("Successfully updated Melio to terminated and logged rejection event!");
}

updateMelioDoc().catch(console.error);
