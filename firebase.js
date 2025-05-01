const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

let firebaseApp;
let db;

try {
  // First try to use environment variables
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
    console.log('Initializing Firebase with environment variables');
    
    // Make sure to properly format the private key
    const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
    
    const firebaseConfig = {
      credential: admin.credential.cert({
        type: process.env.FIREBASE_TYPE,
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: privateKey,
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: process.env.FIREBASE_AUTH_URI,
        token_uri: process.env.FIREBASE_TOKEN_URI,
        auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
        client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
        universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN
      }),
      databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}.firebaseio.com`,
      projectId: process.env.FIREBASE_PROJECT_ID
    };
    
    firebaseApp = admin.initializeApp(firebaseConfig);
  } 
  // Fall back to service account file
  else {
    console.log('Environment variables not found, trying service account file');
  }
  
  // Initialize Firestore
  db = admin.firestore();
  
  // Configure Firestore settings
  db.settings({
    ignoreUndefinedProperties: true
  });
  
  // Test the connection
  db.collection('customers').get()
    .then(snapshot => {
      console.log('Firestore connection successful!');
    })
    .catch(error => {
      console.error('Firestore connection error:', error);
    });
  
} catch (error) {
  console.error('Error initializing Firebase:', error);
  
  // Create a dummy db object that logs errors when used
  db = {
    collection: () => {
      console.error('Firebase not initialized properly. Database operations will fail.');
      return {
        doc: () => ({
          get: () => Promise.reject(new Error('Firebase not initialized')),
          set: () => Promise.reject(new Error('Firebase not initialized')),
          update: () => Promise.reject(new Error('Firebase not initialized')),
          where: () => ({
            get: () => Promise.reject(new Error('Firebase not initialized')),
            limit: () => ({
              get: () => Promise.reject(new Error('Firebase not initialized'))
            })
          })
        }),
        where: () => ({
          get: () => Promise.reject(new Error('Firebase not initialized')),
          limit: () => ({
            get: () => Promise.reject(new Error('Firebase not initialized'))
          })
        })
      };
    }
  };
}

module.exports = { db, admin };