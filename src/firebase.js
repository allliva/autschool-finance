import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBvugSeWhJTZJl82jCOJ1Gksedl6gO9_ns",
  authDomain: "autschool-finance.firebaseapp.com",
  projectId: "autschool-finance",
  storageBucket: "autschool-finance.firebasestorage.app",
  messagingSenderId: "500679497614",
  appId: "1:500679497614:web:e29d0bff8979b6fb05b6df"
};

const firebaseApp = initializeApp(firebaseConfig);
const userCreatorApp = initializeApp(firebaseConfig, "adminUserCreator");

export const auth = getAuth(firebaseApp);
export const userCreatorAuth = getAuth(userCreatorApp);
export const db = getFirestore(firebaseApp);
