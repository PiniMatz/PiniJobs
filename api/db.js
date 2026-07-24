import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

if (!admin.apps.length) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (projectId && clientEmail && privateKey) {
    privateKey = privateKey.trim();
    if ((privateKey.startsWith('"') && privateKey.endsWith('"')) || 
        (privateKey.startsWith("'") && privateKey.endsWith("'"))) {
      privateKey = privateKey.substring(1, privateKey.length - 1);
    }
    privateKey = privateKey.replace(/\\n/g, '\n');

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  } else {
    try {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
    } catch (e) {
      console.warn("Firebase Admin failed to initialize. Please configure environment variables.");
    }
  }
}

const firestore = admin.firestore();
export { firestore as db };

const mapDoc = (doc) => {
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
};

/**
 * APPLICATIONS OPERATIONS
 */

export async function getApplications(statusFilter = null) {
  const coll = firestore.collection('applications');
  const snapshot = await coll.get();
  let list = [];
  snapshot.forEach(doc => {
    list.push(mapDoc(doc));
  });
  
  if (statusFilter) {
    list = list.filter(app => app.status === statusFilter);
  }
  
  // Sort by updated_at descending
  list.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
  return list;
}

export async function getApplication(id) {
  const doc = await firestore.collection('applications').doc(id).get();
  if (!doc.exists) return null;
  const app = mapDoc(doc);
  
  const eventsSnapshot = await firestore.collection('events')
    .where('application_id', '==', id)
    .get();
  
  const events = [];
  eventsSnapshot.forEach(d => {
    events.push(mapDoc(d));
  });
  
  events.sort((a, b) => new Date(b.ts) - new Date(a.ts));
  
  return { ...app, events };
}

// Upsert application based on company + role (lowercase match)
export async function upsertApplication(data) {
  const company = data.company ? data.company.trim() : '';
  const roleTitle = data.role_title ? data.role_title.trim() : '';
  
  if (!company || !roleTitle) {
    throw new Error('Company and Role Title are required.');
  }

  const companyLower = company.toLowerCase();
  const roleLower = roleTitle.toLowerCase();
  
  const appColl = firestore.collection('applications');
  const querySnapshot = await appColl
    .where('company_lower', '==', companyLower)
    .where('role_title_lower', '==', roleLower)
    .limit(1)
    .get();
    
  let docRef;
  let isNew = true;
  let oldStatus = null;
  const nowIso = data.updated_at || new Date().toISOString();
  const appliedDate = data.applied_at || nowIso.split('T')[0];
  
  const payload = {
    company,
    role_title: roleTitle,
    company_lower: companyLower,
    role_title_lower: roleLower,
    source: data.source || '',
    url: data.url || '',
    location: data.location || '',
    salary: data.salary || '',
    contact: data.contact || '',
    status: data.status || 'applied',
    notes: data.notes || '',
    description: data.description || '',
    requirements: data.requirements || '',
    applied_at: appliedDate,
    updated_at: nowIso
  };
  
  if (!querySnapshot.empty) {
    const existingDoc = querySnapshot.docs[0];
    docRef = existingDoc.ref;
    isNew = false;
    const existingData = existingDoc.data();
    oldStatus = existingData.status;
    
    // Preserve earliest applied_at date
    if (existingData.applied_at && existingData.applied_at < appliedDate) {
      payload.applied_at = existingData.applied_at;
    }
    payload.created_at = existingData.created_at || nowIso;
  } else {
    docRef = appColl.doc();
    payload.created_at = nowIso;
  }
  
  await docRef.set(payload, { merge: true });
  const appId = docRef.id;
  
  if (isNew || oldStatus !== payload.status) {
    await addEvent(appId, {
      ts: nowIso,
      type: 'status_change',
      detail: isNew ? `Application created with status: ${payload.status}` : `Status changed from ${oldStatus} to ${payload.status}`
    });
  }
  
  return appId;
}

export async function updateApplication(id, updates) {
  const docRef = firestore.collection('applications').doc(id);
  const doc = await docRef.get();
  if (!doc.exists) throw new Error('Application not found');
  
  const oldData = doc.data();
  const nowIso = updates.updated_at || new Date().toISOString();
  
  const payload = {
    ...updates,
    updated_at: nowIso
  };
  
  if (updates.company) {
    payload.company_lower = updates.company.toLowerCase().trim();
  }
  if (updates.role_title) {
    payload.role_title_lower = updates.role_title.toLowerCase().trim();
  }
  
  await docRef.update(payload);
  
  if (updates.status && updates.status !== oldData.status) {
    await addEvent(id, {
      ts: nowIso,
      type: 'status_change',
      detail: `Status changed from ${oldData.status} to ${updates.status}`
    });
  }
  
  return id;
}

export async function deleteApplication(id) {
  const eventsSnapshot = await firestore.collection('events')
    .where('application_id', '==', id)
    .get();
  
  const batch = firestore.batch();
  eventsSnapshot.forEach(doc => {
    batch.delete(doc.ref);
  });
  
  batch.delete(firestore.collection('applications').doc(id));
  await batch.commit();
  return true;
}

/**
 * EVENTS OPERATIONS
 */

export async function addEvent(appId, eventData) {
  const coll = firestore.collection('events');
  const nowIso = eventData.ts || new Date().toISOString();
  
  const payload = {
    application_id: appId,
    ts: nowIso,
    type: eventData.type,
    detail: eventData.detail || '',
    due_at: eventData.due_at || null
  };
  
  const docRef = await coll.add(payload);
  return docRef.id;
}

export async function getUpcomingEvents() {
  const nowStr = new Date().toISOString();
  const coll = firestore.collection('events');
  const snapshot = await coll.get();
  
  const list = [];
  snapshot.forEach(doc => {
    const data = mapDoc(doc);
    if (data.due_at && data.due_at >= nowStr) {
      list.push(data);
    }
  });
  
  list.sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
  return list;
}

/**
 * EMAIL & SYNC STATE
 */

export async function getEmailState() {
  const doc = await firestore.collection('config').doc('gmail_state').get();
  if (!doc.exists) {
    return {
      last_scanned_ts: null,
      seen_ids: [],
      last_notified_ts: null
    };
  }
  return doc.data();
}

export async function updateEmailState(updates) {
  const docRef = firestore.collection('config').doc('gmail_state');
  await docRef.set(updates, { merge: true });
}

/**
 * GOOGLE OAUTH TOKENS
 */

export async function getGmailTokens() {
  const doc = await firestore.collection('auth').doc('gmail_tokens').get();
  if (!doc.exists) return null;
  return doc.data();
}

export async function updateGmailTokens(tokens) {
  const docRef = firestore.collection('auth').doc('gmail_tokens');
  await docRef.set(tokens, { merge: true });
}
