import React, { useEffect, useMemo, useState } from 'react'
import {
  auth,
  db,
  signInWithGoogle,
  signOutApp,
  ensureWorkspaceBootstrap,
  getRoleInWorkspace,
  wsNoticeDocRef,
  obsColRef,
  serverTimestamp,
  enableOffline,
} from './lib/firebase.js'
import { onAuthStateChanged } from 'firebase/auth'
import { addDoc, collection, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp as svt, setDoc, updateDoc, where } from 'firebase/firestore'
import * as XLSX from 'xlsx'
import { format } from 'date-fns'

const KST = 'Asia/Seoul'

function toDateInputValue(d = new Date()) {
  // yyyy-MM-dd (로컬 기준)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function strToDate(dateStr, timeStr) {
  // dateStr: '2025-03-02', timeStr: '09:30' → JS Date (로컬)
  if (!dateStr) return null
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!timeStr) return new Date(y, m - 1, d, 0, 0, 0, 0)
  const [hh, mm] = timeStr.split(':').map(Number)
  return new Date(y, m - 1, d, hh, mm, 0, 0)
}

function fmtTime(d) {
  if (!d) return ''
  try { return format(d, 'HH:mm') } catch { return '' }
}


function fmtDate(d) {
  if (!d) return ''
  try { return format(d, 'yyyy-MM-dd') } catch { return '' }
}


const RECEIVER_NAMES = ['하이타겟', 'CHC', '탑콘']
const HEIGHT_MODES = ['수직측정', '경사측정']

export default function App() {
  const [user, setUser] = useState(null)
  const [wsId, setWsId] = useState('default')
  const [wsName, setWsName] = useState('기본 작업방')
  const [role, setRole] = useState('user') // 'admin' | 'user'
  const [notice, setNotice] = useState('')
  const [noticeLoading, setNoticeLoading] = useState(false)
  const [noticeUnsub, setNoticeUnsub] = useState(null)


  const [rows, setRows] = useState([])
  const [rowsUnsub, setRowsUnsub] = useState(null)
  const [onlyMine, setOnlyMine] = useState(true) // 기본: 내 데이터만 보기 (요구사항)


  const [showForm, setShowForm] = useState(false)
  const [editingDocId, setEditingDocId] = useState(null)
  const [form, setForm] = useState({
    obsDate: toDateInputValue(new Date()),
    start: '',
    end: '',
    receiverNo: '',
    receiverName: RECEIVER_NAMES[0],
    heightMode: HEIGHT_MODES[0],
    observer: '',
    stationName: '',
  })
  const [saving, setSaving] = useState(false)
  const [saveState, setSaveState] = useState('') // '', '저장됨', '동기화 대기', '오류'

  // 오프라인 퍼시스턴스
  useEffect(() => { enableOffline() }, [])


  // 인증 상태
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u)
    })
    return () => unsub()
  }, [])

  // 작업방 변경 시 부트스트랩 + 권한/공지 구독 + 목록 구독
  useEffect(() => {
    if (!user || !wsId) return
    (async () => {
      await ensureWorkspaceBootstrap(wsId, wsName, user.uid)
      const roleNow = await getRoleInWorkspace(wsId, user.uid)
      setRole(roleNow || 'user')
      // 공지 구독
      noticeUnsub && noticeUnsub()
      const noticeRef = wsNoticeDocRef(wsId)
      const unsubN = onSnapshot(noticeRef, (snap) => {
        const d = snap.data()
        setNotice(d?.text || '')
      })
      setNoticeUnsub(() => unsubN)


      // 목록 구독 (기본: 내 문서만 보기)
      subscribeRows(onlyMine, wsId, user.uid)
    })()
    return () => {
      noticeUnsub && noticeUnsub()
      rowsUnsub && rowsUnsub()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, wsId])

  // onlyMine 토글 시 재구독 (관리자는 전체 보기 가능, 일반 사용자는 강제 onlyMine)
  useEffect(() => {
    if (!user || !wsId) return
    const effectiveOnlyMine = role === 'admin' ? onlyMine : true
    subscribeRows(effectiveOnlyMine, wsId, user.uid)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyMine, role])

  function subscribeRows(onlyMineParam, wsIdParam, uid) {
    rowsUnsub && rowsUnsub()
    const col = obsColRef(wsIdParam)
    let q
    if (onlyMineParam) {
      q = query(col, where('createdBy', '==', uid), orderBy('startTime', 'asc'))
    } else {
      q = query(col, orderBy('observer', 'asc'), orderBy('startTime', 'asc'))
    }
    const unsub = onSnapshot(q, (snap) => {
      const list = []
      snap.forEach((doc) => {
        const d = doc.data()
        list.push({ id: doc.id, ...d })
      })
      setRows(list)
    })
    setRowsUnsub(() => unsub)
  }

  function resetForm() {
    setForm({
      obsDate: toDateInputValue(new Date()),
      start: '',
      end: '',
      receiverNo: '',
      receiverName: RECEIVER_NAMES[0],
      heightMode: HEIGHT_MODES[0],
      observer: user?.displayName || '',
      stationName: '',
    })
    setEditingDocId(null)
  }

  function openNew() {
    resetForm()
    setShowForm(true)
  }


  function openEdit(row) {
    setEditingDocId(row.id)
    setForm({
      obsDate: fmtDate(row.obsDate?.toDate?.() || row.obsDate || new Date()),
      start: fmtTime(row.startTime?.toDate?.() || row.startTime),
      end: fmtTime(row.endTime?.toDate?.() || row.endTime),
      receiverNo: row.receiverNo || '',
      receiverName: row.receiverName || RECEIVER_NAMES[0],
      heightMode: row.heightMode || HEIGHT_MODES[0],
      observer: row.observer || '',
      stationName: row.stationName || '',
    })
    setShowForm(true)
  }

  async function saveForm() {
    if (!user) return
    setSaving(true)
    setSaveState('')
    try {
      // 값 변환
      const obsDate = form.obsDate ? strToDate(form.obsDate) : null
      const startTime = form.start ? strToDate(form.obsDate, form.start) : null
      const endTime = form.end ? strToDate(form.obsDate, form.end) : null


      const payload = {
        observer: form.observer || '',
        obsDate: obsDate ? new Date(obsDate) : null,
        startTime: startTime ? new Date(startTime) : null,
        endTime: endTime ? new Date(endTime) : null,
        receiverNo: form.receiverNo || '',
        receiverName: form.receiverName || '',
        heightMode: form.heightMode || '',
        stationName: form.stationName || '',
        createdBy: user.uid,
        updatedAt: serverTimestamp(),
      }
      if (!editingDocId) {
        payload.createdAt = serverTimestamp()
      }


      const col = obsColRef(wsId)
      if (editingDocId) {
        await updateDoc(doc(col, editingDocId), payload)
      } else {
        await addDoc(col, payload)
      }
      setSaveState('저장됨')
      setShowForm(false)
    } catch (e) {
      console.error(e)
      setSaveState('오류')
    } finally {
      setSaving(false)
      setTimeout(() => setSaveState(''), 2000)
    }
  }

  async function saveNotice() {
    if (!user) return
    setNoticeLoading(true)
    try {
      const ref = wsNoticeDocRef(wsId)
      await setDoc(ref, { text: notice, updatedAt: serverTimestamp(), updatedBy: user.uid }, { merge: true })
    } catch (e) {
      console.error(e)
    } finally {
      setNoticeLoading(false)
    }
  }

  function exportXLSX() {
    // 현재 목록(rows)을 기준으로 엑셀 생성
    // 컬럼: 관측자, 관측점명, 관측일자(yyyy-mm-dd), 관측시작시간(hh:mm), 관측종료시간(hh:mm), 수신기번호, 수신기명, 기계높이(모드)
    const data = rows.map((r) => {
      const dDate = r.obsDate?.toDate?.() || r.obsDate || null
      const dStart = r.startTime?.toDate?.() || r.startTime || null
      const dEnd = r.endTime?.toDate?.() || r.endTime || null
      return {
        관측자: r.observer || '',
        관측점명: r.stationName || '',
        관측일자: dDate || '',
        관측시작시간: dStart || '',
        관측종료시간: dEnd || '',
        수신기번호: r.receiverNo || '',
        수신기명: r.receiverName || '',
        기계높이: r.heightMode || '',
      }
    })

    // 시트 생성
    const ws = XLSX.utils.json_to_sheet(data)


    // 날짜/시간 서식 적용
    // 날짜: yyyy-mm-dd, 시간: hh:mm
    const range = XLSX.utils.decode_range(ws['!ref'])
    for (let R = range.s.r + 1; R <= range.e.r; ++R) {
      // 관측일자 (C)
      const cDate = ws[XLSX.utils.encode_cell({ r: R, c: 2 })]
      if (cDate && cDate.v instanceof Date) {
        cDate.t = 'd'; cDate.z = 'yyyy-mm-dd'
      }
      // 관측시작시간 (D)
      const cStart = ws[XLSX.utils.encode_cell({ r: R, c: 3 })]
      if (cStart && cStart.v instanceof Date) {
        cStart.t = 'd'; cStart.z = 'hh:mm'
      }
      // 관측종료시간 (E)
      const cEnd = ws[XLSX.utils.encode_cell({ r: R, c: 4 })]
      if (cEnd && cEnd.v instanceof Date) {
        cEnd.t = 'd'; cEnd.z = 'hh:mm'
      }
    }

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '야장')
    const now = format(new Date(), 'yyyyMMdd_HHmm')
    XLSX.writeFile(wb, `야장_내보내기_${now}.xlsx`)
  }

  return (
    <div className="wrap">
      <header className="header">
        <div className="brand">야장 프리</div>
        <div className="grow" />
        {user ? (
          <div className="auth">
            <span className="me">{user.displayName || user.email}</span>
            <button className="btn ghost" onClick={signOutApp}>로그아웃</button>
          </div>
        ) : (
          <button className="btn" onClick={signInWithGoogle}>Google 로그인</button>
        )}
      </header>


      <main className="container">
        {/* 작업방 선택/수정 */}
        <section className="card">
          <div className="row">
            <label>작업방 ID</label>
            <input value={wsId} onChange={(e) => setWsId(e.target.value.trim())} placeholder="예: ws-namwon-2025" />
            <label>이름</label>
            <input value={wsName} onChange={(e) => setWsName(e.target.value)} placeholder="표시 이름" />
            <span className="hint">변경 시 자동 생성/부트스트랩됩니다.</span>
          </div>
          <div className="row">
            <span className="role-badge">내 권한: {role}</span>
            {role === 'admin' && (
              <label className="toggle">
                <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
                <span>내 데이터만 보기</span>
              </label>
            )}
            {role !== 'admin' && (
              <span className="hint">다른 사용자 데이터는 목록에 표시되지 않습니다.</span>
            )}
            <div className="grow" />
            <button className="btn" onClick={openNew} disabled={!user}>야장 입력</button>
            <button className="btn" onClick={exportXLSX} disabled={rows.length === 0}>엑셀 내보내기</button>
          </div>
        </section>

        {/* 공지 영역 */}
        <section className="card notice">
          <div className="row">
            <label>공지(당일 일정/연락처/지침)</label>
            <textarea
              value={notice}
              onChange={(e) => setNotice(e.target.value)}
              placeholder="예) 점 당 관측 시간 60분, 관리자 010-0000-0000"
              disabled={role !== 'admin'}
            />
          </div>
          {role === 'admin' && (
            <div className="row end">
              <button className="btn" onClick={saveNotice} disabled={noticeLoading}>{noticeLoading ? '저장중...' : '공지 저장'}</button>
            </div>
          )}
        </section>

        {/* 조회 테이블 */}
        <section className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>관측점명</th>
                  <th>관측시작시간</th>
                  <th>관측종료시간</th>
                  <th>야장 수정</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const s = r.startTime?.toDate?.() || r.startTime
                  const e = r.endTime?.toDate?.() || r.endTime
                  return (
                    <tr key={r.id}>
                      <td>{r.stationName || '-'}</td>
                      <td>{s ? fmtTime(s) : '-'}</td>
                      <td>{e ? fmtTime(e) : '-'}</td>
                      <td><button className="btn ghost" onClick={() => openEdit(r)}>열기</button></td>
                    </tr>
                  )
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="empty">표시할 데이터가 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* 입력/수정 모달 */}
      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editingDocId ? '야장 수정' : '야장 입력'}</h3>
            <div className="grid">
              <label>관측일자</label>
              <input type="date" value={form.obsDate} onChange={(e) => setForm({ ...form, obsDate: e.target.value })} />


              <label>관측시작시간</label>
              <input type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />


              <label>관측종료시간</label>
              <input type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />


              <label>수신기 번호</label>
              <input value={form.receiverNo} onChange={(e) => setForm({ ...form, receiverNo: e.target.value })} placeholder="예: RX-001" />


              <label>수신기명</label>
              <select value={form.receiverName} onChange={(e) => setForm({ ...form, receiverName: e.target.value })}>
                {RECEIVER_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>


              <label>기계 높이</label>
              <select value={form.heightMode} onChange={(e) => setForm({ ...form, heightMode: e.target.value })}>
                {HEIGHT_MODES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>


              <label>관측자</label>
              <input value={form.observer} onChange={(e) => setForm({ ...form, observer: e.target.value })} placeholder="본인 이름" />


              <label>관측점명</label>
              <input value={form.stationName} onChange={(e) => setForm({ ...form, stationName: e.target.value })} placeholder="예: NMW-001" />
            </div>
            <div className="row end">
              <button className="btn ghost" onClick={() => setShowForm(false)}>닫기</button>
              <button className="btn" onClick={saveForm} disabled={saving}>{saving ? '저장중...' : '저장'}</button>
            </div>
            {saveState && <div className="muted">{saveState}</div>}
          </div>
        </div>
      )}

      <footer className="footer">© {new Date().getFullYear()} 야장 프리</footer>
    </div>
  )
}