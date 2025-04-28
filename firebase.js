const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Initialize Firebase
let firebaseApp;

try {
  // Check if we have environment variables for Firebase credentials
  if (process.env.FIREBASE_PROJECT_ID && 
      process.env.FIREBASE_PRIVATE_KEY && 
      process.env.FIREBASE_CLIENT_EMAIL) {
    
    // Use environment variables
    firebaseApp = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL
      })
    });
    
    console.log('Firebase initialized using environment variables');
  } 
  // Fall back to service account file for local development
  // else {
  //   const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
    
  //   if (fs.existsSync(serviceAccountPath)) {
  //     const serviceAccount = require(serviceAccountPath);
      
  //     firebaseApp = initializeApp({
  //       credential: cert(serviceAccount)
  //     });
      
  //     console.log('Firebase initialized using service account file');
  //   } else {
  //     throw new Error('Firebase credentials not found. Please set environment variables or add serviceAccountKey.json');
  //   }
  // }
  
  // Initialize Firestore
  const db = getFirestore(firebaseApp);
  
  module.exports = { db };
} catch (error) {
  console.error('Error initializing Firebase:', error);
  process.exit(1);
}