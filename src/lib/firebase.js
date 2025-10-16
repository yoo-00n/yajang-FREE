import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAb7UHFqB449pIdsBDvUoRQxIhYSgzhVqM",
  authDomain: "yajang-free.firebaseapp.com",
  projectId: "yajang-free",
  storageBucket: "yajang-free.firebasestorage.app",
  messagingSenderId: "251377860379",
  appId: "1:251377860379:web:b5b454e2e58060cdc91dbe"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);