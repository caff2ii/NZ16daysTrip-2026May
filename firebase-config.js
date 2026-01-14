// Import Firebase SDK functions
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set, onValue, push, remove, get } 
    from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// TODO: 請在這裡填入您的 Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyD-oE2hrLQvDdIv5IByPtRXplUKYZ06Wu4",
  authDomain: "nz16daystrip-2026may.firebaseapp.com",
  databaseURL: "https://nz16daystrip-2026may-default-rtdb.firebaseio.com",
  projectId: "nz16daystrip-2026may",
  storageBucket: "nz16daystrip-2026may.firebasestorage.app",
  messagingSenderId: "257175026430",
  appId: "1:257175026430:web:e855dcfca4a2aad9f503af",
  measurementId: "G-NF656CF63F"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Export functions for use in main.js
export { db, ref, set, onValue, push, remove, get };
