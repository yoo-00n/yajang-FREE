import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, collection, doc, getDoc, setDoc, serverTimestamp, enableIndexedDbPersistence } from 'firebase/firestore';

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

export async function enableOffline() {
  try { await enableIndexedDbPersistence(db); }
  catch (e) { console.warn('오프라인 퍼시스턴스 비활성(중복 탭?):', e?.code); }
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
}
export async function signOutApp() { await signOut(auth); }

// 컬렉션/도큐먼트 헬퍼
export const wsDocRef = (wsId) => doc(db, 'workspaces', wsId);
export const wsMembersCol = (wsId) => collection(db, 'workspaces', wsId, 'members');
export const wsMemberDoc = (wsId, uid) => doc(db, 'workspaces', wsId, 'members', uid);
export const wsNoticeDocRef = (wsId) => doc(db, 'workspaces', wsId, 'config', 'notice');
export const obsColRef = (wsId) => collection(db, 'workspaces', wsId, 'observations');

// serverTimestamp 별칭(프로젝트 전역에서 통일해서 사용)
export { serverTimestamp as svt };

export async function ensureWorkspaceBootstrap(wsId, wsName, uid) {
  const wsRef = wsDocRef(wsId);
  const snap = await getDoc(wsRef);
  const created = !snap.exists();

  if (created) {
    await setDoc(wsRef, { name: wsName || wsId, createdAt: serverTimestamp(), createdBy: uid });
  } else if (wsName && snap.data()?.name !== wsName) {
    await setDoc(wsRef, { name: wsName }, { merge: true });
  }

  const mRef = wsMemberDoc(wsId, uid);
  const ms = await getDoc(mRef);
  if (!ms.exists()) {
    await setDoc(mRef, { role: created ? 'admin' : 'user', joinedAt: serverTimestamp() }, { merge: true });
  }
}

export async function getRoleInWorkspace(wsId, uid) {
  const ms = await getDoc(wsMemberDoc(wsId, uid));
  return ms.exists() ? ms.data()?.role : 'user';
}
