import admin from 'firebase-admin';

let firebaseApp: admin.app.App;

// Initialize Firebase Admin
export function initializeFirebase() {
  if (!process.env.FIREBASE_ADMIN_CREDENTIALS) {
    throw new Error('Missing FIREBASE_ADMIN_CREDENTIALS environment variable');
  }

  try {
    // Parse the service account credentials
    const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_CREDENTIALS);

    if (!admin.apps || admin.apps.length === 0) {
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log('Firebase Admin SDK initialized successfully');
    } else {
      firebaseApp = admin.app();
    }
  } catch (error) {
    console.error('Error initializing Firebase Admin:', error);
    throw error;
  }
}

// Get Firestore database
export function getFirestore() {
  if (!firebaseApp) {
    initializeFirebase();
  }
  return admin.firestore();
}

// Collection references
export const USERS_COLLECTION = 'users';
export const TRADES_COLLECTION = 'trades';
export const COLLECTIONS_COLLECTION = 'collections';

// Helper function to convert Firestore data to plain objects
export function convertFirestoreData<T>(doc: admin.firestore.DocumentSnapshot): T | null {
  if (!doc.exists) return null;
  
  const data = doc.data();
  if (!data) return null;
  
  // Convert numeric id stored as string back to number if needed
  let id: string | number = doc.id;
  if (!isNaN(Number(id))) {
    id = Number(id);
  }
  
  return {
    ...data,
    id,
    // Convert Firestore Timestamps to JavaScript Dates
    ...(data.createdAt && { createdAt: data.createdAt.toDate() }),
    ...(data.entryDate && { entryDate: data.entryDate.toDate() }),
    ...(data.exitDate && { exitDate: data.exitDate.toDate() }),
  } as T;
}

// Helper function to convert Firestore collection data to array of objects
export function convertFirestoreCollection<T>(
  snapshot: admin.firestore.QuerySnapshot
): T[] {
  if (snapshot.empty) return [];
  
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    if (!data) return {} as T;
    
    // Convert numeric id stored as string back to number if needed
    let id: string | number = doc.id;
    if (!isNaN(Number(id))) {
      id = Number(id);
    }
    
    return {
      ...data,
      id,
      // Convert Firestore Timestamps to JavaScript Dates
      ...(data.createdAt && { createdAt: data.createdAt.toDate() }),
      ...(data.entryDate && { entryDate: data.entryDate.toDate() }),
      ...(data.exitDate && { exitDate: data.exitDate.toDate() }),
    } as T;
  });
}