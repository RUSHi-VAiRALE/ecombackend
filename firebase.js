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
      process.env.FIREBASE_CLIENT_EMAIL) {
    
    // Use environment variables
    firebaseApp = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey:  "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCVzzkhpG1NvRnO\ntGyu6nvX6qy9TV19dnIKjBKGVlQHWooCkquqlnBpRe6ZJi5y4SsM8b/5azYLO8gx\n0dLhGQEW1MJjjJm9ztm8CgMv7Xj5JymRhky1cCIV1JnUlifgaXKAy7CMIFkjO3DV\ngX2dwxtss2vUTVSnBqXLGYKagYOmO8L67S/ABANkM9V0zG/fmqvmfk0BgLWswtOQ\n/p3pu8DlfqgIobvNCinxJtYpkAEJP/2s3VbWCLgpiekvqDnYBhlnQmRr46V3rKpZ\nY4oONfTYlWoy+2e6Hf/zqpuARZpi7b3EfebsftM7s5tJHuLkjzXjFpU+PlaEGqqy\n7R9yuxp9AgMBAAECggEABafX7iYL0wJUw0HQKT8Eo49NAS02s9dbu9Ezm9W41g7m\nz0Jj77c+kYLd3J3yj/dh4tsM69N5LAMQQ5flIFwLd1CwnAXWrLHun2jjW5UEBaf4\nVkbzMMBbJmbV0zmYp3djpsAfL1MYpQ9dQE+OA1LhKgE7YhL0o1pJZQ8BUr2ZT5Zl\ngvov3HiM0DoqAv36jIj6gw9Mlfo1L7exQGX9VX+pfz/H17LhKM1/h81zFLbRfw//\n7PAgfuf2ORNouU/biBurG+ZFbdKnya4YyjMWz+hDnaL1SESbvJVLcMo8YC28eqZE\nRRW5H7DsKrQd6ffwcIEZoDY+rc9KGfSYqH4g4FCecQKBgQDP+WCPWdYFmYzZBNEW\nODAywHq8nzr2W4DI5xiNS2BwiVCCV5vt9WKMPQ0FYmFf0FN/ixDVbrK2k0vj9GRx\nnEJyYiVjq1TiXRhPJDGuAgDkgqJ4SFvRfJ7i2wa6VT/nck0zSZOckqt2uLAcZLxF\nFBws7wp7QqgjnqFdRGmFf0tEaQKBgQC4Z2B/FT3PW2QIt4O35U4MgHuXJlVaryJi\nHsbT4iWLfBJfnn72w0odSM4spEn5wKiVa0YWsGO8rCoArFkhV1pDi2lURszZc/RP\nUApQ3WEsfViK+cr94RhmmjMmZdU5fwbqL+9s0KNQjEvpdOC81/bKHYAD+QDVP6lI\nfY5x2GFS9QKBgQCqlDbPvPZex2+PvHSmDdXyeo7w0IUy9SAvJ+SqV021X9rp3WOm\njCKVNanNZcDKLnud2/klpdLtDukrAhO0X17cpIVYN3m65HKAzwX0W+5Rfpg1odu1\necpz9QOSp0Nv2P9a9pkczevWx2qjDzigS/tEG5f0O1rfREfD0M3f0eVxKQKBgQCd\nicu5pjcBEG28uLMyBxePvLBZaClhaN+x/eMVH02+BYhY4jpLrHmD3TAumUiNsxcT\nV+sv9Q+wH1Fe897NiigWLmMU2cumNtbQb2vwu8CJ1qgvSsot7QEAntn2AueP0ELj\nDYK5buEnLkSoNO7Oxp4S+/Li8fbROCryQDnSbu5uhQKBgF0/vr0yksKJi/JDsJH4\naYQjMSiRaOxDkfKk5mnE5urjpoZnNNqFnut2wsBUiZ0dv6fFiLgdmlxw4+L5+yvm\nV8x2Kv0oIyZahunJbwjGN3o0/ZW+UTkqxoBg/C1OR/jPTdULBHVHEEHRqoKUUT4S\nRRKhBFSOvQGGuQks/CjJe549\n-----END PRIVATE KEY-----\n",
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

