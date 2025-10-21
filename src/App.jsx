import React, { useEffect, useState } from "react";
import { auth, db } from "./lib/firebase";
window.auth = auth;

import {
  signInAnonymously,
  onAuthStateChanged,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import {
  doc, getDoc, setDoc, collection, addDoc, serverTimestamp,
  query, where, onSnapshot, orderBy, updateDoc
} from "firebase/firestore";

/* ========= 공용 유틸 ========= */
// 프로젝트 비번 해시 생성용(브라우저 Web Crypto)
async function sha256(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
const STATIC_SALT = "pnu-v1"; // 바꾸면 기존 프로젝트 joinCodeHash 재설정 필요

function useAuth() {
  const [user, setUser] = useState(null);
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  return user;
}

/* ========= 메인 App ========= */
export default function App() {
  const user = useAuth();
  const SUPER_ADMINS = new Set(["sZyql3B9HaedVxlzB8jknCBWPfy2"]);
  const isSuper = !!user && SUPER_ADMINS.has(user.uid);
  const [projectId, setProjectId] = useState(localStorage.getItem("pid") || "");
  const [observerName, setObserverName] = useState(localStorage.getItem("observerName") || "");
  const [role, setRole] = useState(localStorage.getItem("role") || "none");
  const [joinPassword, setJoinPassword] = useState("");
  const [projectMeta, setProjectMeta] = useState(null);
  const [canCreate, setCanCreate] = useState(false);   // orgRoles 전역 권한
  const [authBusy, setAuthBusy] = useState(false);
  const isSignedIn = !!user;
  const displayName = user?.displayName || "(미로그인)";
  const joinedProject = !!user && role !== "none";

  // 로그인 후 전역 매니저 권한(orgRoles) 확인
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "orgRoles", user.uid));
        setCanCreate(!!snap.exists() && snap.data().canCreateProject === true);
      } catch { setCanCreate(false); }
    })();
  }, [user]);

  // 프로젝트 선택 바뀔 때 내 역할 불러오기
  useEffect(() => {
    if (!user || !projectId) return;
    setRole("none");
    const mref = doc(db, "projects", projectId, "members", user.uid);
    getDoc(mref).then(snap => {
      if (snap.exists()) {
        const r = snap.data().role || "observer";
        setRole(r);
        localStorage.setItem("role", r);
        if (snap.data().observerName) {
          setObserverName(snap.data().observerName);
          localStorage.setItem("observerName", snap.data().observerName);
        }
      } else {
        setRole("none");
        localStorage.removeItem("role");
      }
    }).catch(() => { });
  }, [user, projectId]);

  // 프로젝트 메타(표시 이름 등)
  useEffect(() => {
    if (!projectId) return;
    getDoc(doc(db, "projects", projectId)).then(s => {
      setProjectMeta(s.exists() ? s.data() : null);
    }).catch(() => setProjectMeta(null));
  }, [projectId]);

  // 관리자/담당자 로그인/로그아웃 버튼
  async function handleLogin() {
    setAuthBusy(true);
    try {
      if (auth.currentUser && auth.currentUser.isAnonymous) {
        await signOut(auth);
      }
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
    } catch { /* noop */ }
    finally { setAuthBusy(false); }
  }
  async function handleLogout() {
    setAuthBusy(true);
    try { await signOut(auth); }
    finally {
      setAuthBusy(false);
      setRole("none");
      localStorage.removeItem("role");
    }
  }

  // 참여(회원가입 겸 익명 로그인)
  async function handleJoin(e) {
    e.preventDefault();
    if (!projectId || !observerName || !joinPassword) {
      alert("프로젝트ID / 관측자명 / 프로젝트 비밀번호를 입력하세요.");
      return;
    }

    // 익명 로그인(참여 시점에만)
    if (!auth.currentUser) await signInAnonymously(auth);
    const uid = auth.currentUser.uid;

    // joinHash 생성(비번|프로젝트ID|STATIC_SALT)
    const joinHash = await sha256(`${joinPassword}|${projectId}|${STATIC_SALT}`);

    // members/{uid} 생성 시도(규칙에서 secret/join.joinCodeHash 비교)
    const mref = doc(db, "projects", projectId, "members", uid);
    await setDoc(mref, {
      role: "observer",
      observerName,
      joinHash,
      joinedAt: serverTimestamp()
    });

    // 화면 편의
    await updateProfile(auth.currentUser, { displayName: observerName });
    localStorage.setItem("pid", projectId);
    localStorage.setItem("observerName", observerName);
    setJoinPassword("");
    alert("프로젝트에 참여했습니다.");
  }

  return (
    <div className="container">
      {/* 헤더 */}
      <div className="row" style={{ alignItems: "center", marginBottom: 8 }}>
        <div className="col">
          <div className="small" style={{ opacity: .8 }}>
            누구나 접속 가능 · 프로젝트ID+비밀번호 공유 · 관측자명은 임의로 입력
          </div>
        </div>
        <div className="col" style={{ textAlign: "right" }}>
          {isSignedIn ? (
            <>
              <span className="small" style={{ marginRight: 8 }}>
                {displayName} <span className="badge">{role === "none" ? "게스트" : role}</span>
              </span>
              <button onClick={handleLogout} disabled={authBusy}>로그아웃</button>
            </>
          ) : (
            <button onClick={handleLogin} disabled={authBusy}>로그인(관리자/담당자)</button>
          )}
        </div>
      </div>

      {/* 참여 / 로그인 박스 */}
      <div className="row">
        <div className="col">
          <div className="card">
            <h1>프로젝트 참여</h1>
            <form onSubmit={handleJoin} className="row">
              <div className="col">
                <label>프로젝트 ID</label>
                <input value={projectId} onChange={e => setProjectId(e.target.value.trim())} placeholder="예: nw-2025-a" />
              </div>
              <div className="col">
                <label>관측자명</label>
                <input value={observerName} onChange={e => setObserverName(e.target.value)} placeholder="예: 홍길동" />
              </div>
              <div className="col">
                <label>프로젝트 비밀번호</label>
                <input value={joinPassword} onChange={e => setJoinPassword(e.target.value)} placeholder="예: lxlx1004" type="password" />
              </div>
              <div className="col">
                <label>&nbsp;</label>
                <button type="submit">프로젝트 참여</button>
              </div>
            </form>
            <hr />
            <div className="small">
              로그인 UID: {user?.uid || "-"} &nbsp;&nbsp;|&nbsp;&nbsp;
              역할: <span className="badge">{role === "none" ? "게스트" : role}</span><br />
              현재 프로젝트: {projectId || "-"} {projectMeta?.name ? <span className="small">({projectMeta.name})</span> : null}
            </div>
          </div>
        </div>
      </div>

      {/* 프로젝트 참여 후: 야장 입력 */}
      {joinedProject ? (
        <>
          <div className="row" style={{ marginTop: 16 }}>
            <div className="col">
              <RecordsPanel projectId={projectId} role={role} observerName={observerName} />
            </div>
          </div>
        </>
      ) : (
        <div className="row" style={{ marginTop: 16 }}>
          <div className="col">
            <div className="card small">
              프로젝트에 참여하면, 관측자는 <b>자기 데이터만</b> 보이고, 담당자/관리자는 <b>전체 데이터</b>를 조회할 수 있습니다.
            </div>
          </div>
        </div>
      )}

      {/* 로그인한 상태(멤버 아니어도) 권한 있으면 관리 패널 노출 */}
      {isSignedIn && (
        <div className="row" style={{ marginTop: 16 }}>
          {(role === "manager" || role === "admin" || canCreate) && (
            <div className="col">
              <ManagerPanel projectId={projectId} />
            </div>
          )}
          {(role === "admin" || isSuper) && (
            <div className="col">
              <AdminPanel projectId={projectId} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ========= 관측자/담당자 공통: 레코드 작성/조회 ========= */
function RecordsPanel({ projectId, role, observerName }) {
  const [form, setForm] = useState({ pointName: "", startAt: "", endAt: "", memo: "" });
  const [rows, setRows] = useState([]);

  useEffect(() => {
    if (!auth.currentUser || !projectId) return;
    const colRef = collection(db, "projects", projectId, "records");
    const q = (role === "manager" || role === "admin")
      ? query(colRef, orderBy("createdAt", "desc"))
      : query(colRef, where("observerUid", "==", auth.currentUser.uid), orderBy("createdAt", "desc"));
    const off = onSnapshot(q, snap => {
      setRows(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => off();
  }, [projectId, role]);

  async function saveRecord(e) {
    e.preventDefault();
    if (!auth.currentUser || !projectId) return;
    const colRef = collection(db, "projects", projectId, "records");
    await addDoc(colRef, {
      observerUid: auth.currentUser.uid,
      observerName: observerName || auth.currentUser.displayName || "",
      pointName: form.pointName || "",
      startAt: form.startAt || "",
      endAt: form.endAt || "",
      memo: form.memo || "",
      createdAt: serverTimestamp()
    });
    setForm({ pointName: "", startAt: "", endAt: "", memo: "" });
  }

  return (
    <div className="card">
      <h1>야장 입력</h1>
      <form onSubmit={saveRecord} className="row">
        <div className="col">
          <label>관측점명</label>
          <input value={form.pointName} onChange={e => setForm(v => ({ ...v, pointName: e.target.value }))} />
        </div>
        <div className="col">
          <label>관측시작시간</label>
          <input type="datetime-local" value={form.startAt} onChange={e => setForm(v => ({ ...v, startAt: e.target.value }))} />
        </div>
        <div className="col">
          <label>관측종료시간</label>
          <input type="datetime-local" value={form.endAt} onChange={e => setForm(v => ({ ...v, endAt: e.target.value }))} />
        </div>
        <div className="col">
          <label>메모</label>
          <input value={form.memo} onChange={e => setForm(v => ({ ...v, memo: e.target.value }))} />
        </div>
        <div className="col">
          <label>&nbsp;</label>
          <button type="submit">저장</button>
        </div>
      </form>

      <hr />
      <div className="small">목록 (최근순) — {role === "manager" || role === "admin" ? "전체" : "내 문서"}</div>
      <table>
        <thead>
          <tr>
            <th>관측자</th><th>관측점명</th><th>시작</th><th>종료</th><th>메모</th><th>소유</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td>{r.observerName || "-"}</td>
              <td>{r.pointName || "-"}</td>
              <td>{r.startAt || "-"}</td>
              <td>{r.endAt || "-"}</td>
              <td>{r.memo || "-"}</td>
              <td className="small">{r.observerUid?.slice(0, 6)}…</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ========= 매니저: 프로젝트 생성 ========= */
function ManagerPanel({ projectId }) {
  const [newProjectId, setNewProjectId] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [projName, setProjName] = useState("");

  async function createProject() {
    if (!newProjectId || !newPwd) {
      alert("프로젝트ID와 비밀번호를 입력하세요."); return;
    }
    const joinCodeHash = await sha256(`${newPwd}|${newProjectId}|${STATIC_SALT}`);

    // 공개 메타
    await setDoc(doc(db, "projects", newProjectId), {
      name: projName || newProjectId,
      createdAt: serverTimestamp()
    }, { merge: true });

    // 비공개 해시 저장
    await setDoc(doc(db, "projects", newProjectId, "secret", "join"), {
      joinCodeHash,
      createdAt: serverTimestamp()
    }, { merge: true });

    alert("새 프로젝트를 생성했습니다.");
    setNewProjectId(""); setNewPwd(""); setProjName("");
  }

  return (
    <div className="card">
      <h1>담당자 도구</h1>
      <div className="row">
        <div className="col">
          <label>새 프로젝트 ID</label>
          <input value={newProjectId} onChange={e => setNewProjectId(e.target.value)} placeholder="예: 남원2025-1" />
        </div>
        <div className="col">
          <label>프로젝트 이름</label>
          <input value={projName} onChange={e => setProjName(e.target.value)} placeholder="예: 남원 지적기준점" />
        </div>
        <div className="col">
          <label>비밀번호</label>
          <input value={newPwd} onChange={e => setNewPwd(e.target.value)} type="text" placeholder="예: lxlx1004" />
        </div>
        <div className="col">
          <label>&nbsp;</label>
          <button onClick={createProject}>새 프로젝트 생성</button>
        </div>
      </div>
    </div>
  );
}

/* ========= 최고관리자: 비번 변경/역할 부여 ========= */
function AdminPanel({ projectId }) {
  const [projName, setProjName] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [targetUid, setTargetUid] = useState("");
  const [newRole, setNewRole] = useState("manager");

  async function setProjectPassword() {
    if (!projectId || !newPwd) { alert("프로젝트ID/새 비밀번호 입력"); return; }
    const joinCodeHash = await sha256(`${newPwd}|${projectId}|${STATIC_SALT}`);

    await setDoc(doc(db, "projects", projectId), {
      name: projName || projectId,
      updatedAt: serverTimestamp()
    }, { merge: true });

    await setDoc(doc(db, "projects", projectId, "secret", "join"), {
      joinCodeHash,
      updatedAt: serverTimestamp()
    }, { merge: true });

    setNewPwd("");
    alert("프로젝트 비밀번호(해시)를 설정/갱신했습니다.");
  }

  async function grantRole() {
    if (!projectId || !targetUid) { alert("대상 UID가 필요합니다."); return; }
    const mref = doc(db, "projects", projectId, "members", targetUid);
    const snap = await getDoc(mref);
    if (!snap.exists()) { alert("해당 UID 멤버가 아직 참여하지 않았습니다."); return; }
    await updateDoc(mref, { role: newRole });
    alert(`역할을 ${newRole}로 변경했습니다.`);
  }

  return (
    <div className="card">
      <h1>최고관리자 도구</h1>
      <div className="row">
        <div className="col">
          <label>프로젝트 표시 이름(선택)</label>
          <input value={projName} onChange={e => setProjName(e.target.value)} placeholder="예: 남원-2025-1차" />
        </div>
        <div className="col">
          <label>새 프로젝트 비밀번호</label>
          <input type="text" value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="예: lxlx1004-ridge-2025" />
        </div>
        <div className="col">
          <label>&nbsp;</label>
          <button onClick={setProjectPassword}>비밀번호 설정/변경</button>
        </div>
      </div>

      <hr />

      <div className="row">
        <div className="col">
          <label>역할 변경 대상 UID</label>
          <input value={targetUid} onChange={e => setTargetUid(e.target.value)} placeholder="참여 후 획득한 UID" />
        </div>
        <div className="col">
          <label>역할</label>
          <select value={newRole} onChange={e => setNewRole(e.target.value)}>
            <option value="manager">manager (담당자)</option>
            <option value="observer">observer (관측자)</option>
            <option value="admin">admin (최고관리자)</option>
          </select>
        </div>
        <div className="col">
          <label>&nbsp;</label>
          <button onClick={grantRole}>역할 부여/변경</button>
        </div>
      </div>

      <div className="small" style={{ marginTop: 8 }}>
        ⚠ 역할 변경은 규칙상 최고관리자만 가능합니다. (규칙: <code>isSuperAdmin()</code>)
      </div>
    </div>
  )
}
