import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth'
import { getFirestore, collection, doc, getDoc, setDoc, serverTimestamp, enableIndexedDbPersistence } from 'firebase/firestore'

const firebaseConfig = {
    apiKey: "AIzaSyAb7UHFqB449pIdsBDvUoRQxIhYSgzhVqM",
    authDomain: "yajang-free.firebaseapp.com",
    projectId: "yajang-free",
    storageBucket: "yajang-free.firebasestorage.app",
    messagingSenderId: "251377860379",
    appId: "1:251377860379:web:b5b454e2e58060cdc91dbe"
};

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)

export async function enableOffline() {
    try { await enableIndexedDbPersistence(db) } catch (e) { console.warn('오프라인 퍼시스턴스 비활성(중복 탭?):', e?.code) }
}


export async function signInWithGoogle() {
    const provider = new GoogleAuthProvider()
    await signInWithPopup(auth, provider)
}
export async function signOutApp() { await signOut(auth) }

// 컬렉션/도큐먼트 헬퍼
export const wsDocRef = (wsId) => doc(db, 'workspaces', wsId)
export const wsMembersCol = (wsId) => collection(db, 'workspaces', wsId, 'members')
export const wsMemberDoc = (wsId, uid) => doc(db, 'workspaces', wsId, 'members', uid)
export const wsNoticeDocRef = (wsId) => doc(db, 'workspaces', wsId, 'config', 'notice')
export const obsColRef = (wsId) => collection(db, 'workspaces', wsId, 'observations')
export const serverTimestampRef = serverTimestamp

export function serverTimestamp() { return serverTimestampRef() }

// 작업방 부트스트랩(없으면 생성, 멤버 등록, 최초 관리자 자동 지정)
export async function ensureWorkspaceBootstrap(wsId, wsName, uid) {
    const wsRef = wsDocRef(wsId)
    const snap = await getDoc(wsRef)
    if (!snap.exists()) {
        await setDoc(wsRef, { name: wsName || wsId, createdAt: serverTimestamp(), createdBy: uid })
    } else {
        // 이름 변경 반영(옵션)
        const data = snap.data()
        if (wsName && data?.name !== wsName) {
            await setDoc(wsRef, { name: wsName }, { merge: true })
        }
    }
    // 멤버 문서가 없으면 user로 가입
    const mRef = wsMemberDoc(wsId, uid)
    const ms = await getDoc(mRef)
    if (!ms.exists()) {
        await setDoc(mRef, { role: 'user', joinedAt: serverTimestamp() })
    }
    // 관리자가 1명도 없으면 현재 사용자를 admin으로 승격
    // (간단 구현: members/{uid} 의 role 값을 확인하여 admin 없는 경우 변경)
    // 실제로는 보안/감사요건에 따라 관리자 지정 Flow를 별도 구성 권장
    try {
        const adminsRef = collection(db, 'workspaces', wsId, 'members')
        // Firestore Lite에선 where 필요하지만 여기선 간소화(최초엔 멤버 1명)
        // 안전장치: 작업방 생성 직후엔 현재 사용자를 admin으로 승격
        if (!snap.exists()) {
            await setDoc(mRef, { role: 'admin', joinedAt: serverTimestamp() }, { merge: true })
        }
    } catch (e) { }
}

export async function getRoleInWorkspace(wsId, uid) {
    const ms = await getDoc(wsMemberDoc(wsId, uid))
    return ms.exists() ? ms.data()?.role : 'user'
}