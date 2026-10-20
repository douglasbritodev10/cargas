import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getFirestore, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, getDoc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBBnjZgVPOJuQ343aMK6Rzi2zmNkPx1pbE",
  authDomain: "cargas-montagem.firebaseapp.com",
  projectId: "cargas-montagem",
  storageBucket: "cargas-montagem.firebasestorage.app",
  messagingSenderId: "275482066791",
  appId: "1:275482066791:web:243d85ab260f8283cdb9c2"
};

// Inicializa Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, getDoc };