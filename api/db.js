import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

if (!admin.apps.length) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (projectId && clientEmail && privateKey) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, '\n'),
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

// Helper to convert Firestore timestamps or documents
const mapDoc = (doc) => {
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
};

/**
 * APPLICATIONS OPERATIONS
 */

// Get all applications, optionally filtering by status
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

// Get single application with its timeline events
export async function getApplication(id) {
  const doc = await firestore.collection('applications').doc(id).get();
  if (!doc.exists) return null;
  const app = mapDoc(doc);
  
  // Get events for this app
  const eventsSnapshot = await firestore.collection('events')
    .where('application_id', '==', id)
    .get();
  
  const events = [];
  eventsSnapshot.forEach(d => {
    events.push(mapDoc(d));
  });
  
  // Sort events by ts descending
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
  
  // Search for existing by lowercase fields
  const appColl = firestore.collection('applications');
  const querySnapshot = await appColl
    .where('company_lower', '==', companyLower)
    .where('role_title_lower', '==', roleLower)
    .limit(1)
    .get();
    
  let docRef;
  let isNew = true;
  let oldStatus = null;
  const now = new Date().toISOString();
  
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
    applied_at: data.applied_at || now.split('T')[0],
    updated_at: now
  };
  
  if (!querySnapshot.empty) {
    const existingDoc = querySnapshot.docs[0];
    docRef = existingDoc.ref;
    isNew = false;
    oldStatus = existingDoc.data().status;
    // Don't overwrite created_at on update
    payload.created_at = existingDoc.data().created_at || now;
  } else {
    docRef = appColl.doc();
    payload.created_at = now;
  }
  
  await docRef.set(payload, { merge: true });
  const appId = docRef.id;
  
  // Log status change if status changed or new
  if (isNew || oldStatus !== payload.status) {
    await addEvent(appId, {
      type: 'status_change',
      detail: isNew ? `Application created with status: ${payload.status}` : `Status changed from ${oldStatus} to ${payload.status}`
    });
  }
  
  return appId;
}

// Update individual fields of an application
export async function updateApplication(id, updates) {
  const docRef = firestore.collection('applications').doc(id);
  const doc = await docRef.get();
  if (!doc.exists) throw new Error('Application not found');
  
  const oldData = doc.data();
  const now = new Date().toISOString();
  
  const payload = {
    ...updates,
    updated_at: now
  };
  
  // Maintain lowercase helper fields if company or role changes
  if (updates.company) {
    payload.company_lower = updates.company.toLowerCase().trim();
  }
  if (updates.role_title) {
    payload.role_title_lower = updates.role_title.toLowerCase().trim();
  }
  
  await docRef.update(payload);
  
  // If status changed, record it
  if (updates.status && updates.status !== oldData.status) {
    await addEvent(id, {
      type: 'status_change',
      detail: `Status changed from ${oldData.status} to ${updates.status}`
    });
  }
  
  return id;
}

// Delete application and all its events
export async function deleteApplication(id) {
  // Delete events first
  const eventsSnapshot = await firestore.collection('events')
    .where('application_id', '==', id)
    .get();
  
  const batch = firestore.batch();
  eventsSnapshot.forEach(doc => {
    batch.delete(doc.ref);
  });
  
  // Delete the application
  batch.delete(firestore.collection('applications').doc(id));
  await batch.commit();
  return true;
}

/**
 * EVENTS OPERATIONS
 */

// Add an event to an application
export async function addEvent(appId, eventData) {
  const coll = firestore.collection('events');
  const now = new Date().toISOString();
  
  const payload = {
    application_id: appId,
    ts: eventData.ts || now,
    type: eventData.type, // note|appointment|reminder|email|learn|status_change
    detail: eventData.detail || '',
    due_at: eventData.due_at || null
  };
  
  const docRef = await coll.add(payload);
  return docRef.id;
}

// Get upcoming events
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
  
  // Sort by due_at ascending
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
