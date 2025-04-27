const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');
const fs = require('fs');

// Check if service account file exists
const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
let serviceAccount;

try {
  if (fs.existsSync(serviceAccountPath)) {
    serviceAccount = require(serviceAccountPath);
  } else {
    console.error('Firebase service account file not found. Please add serviceAccountKey.json to the project root.');
    process.exit(1);
  }
} catch (error) {
  console.error('Error loading Firebase service account:', error);
  process.exit(1);
}

// Initialize Firebase
const firebaseApp = initializeApp({
  credential: cert(serviceAccount)
});

// Initialize Firestore
const db = getFirestore(firebaseApp);

module.exports = { db };