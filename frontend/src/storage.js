const DB_NAME = 'upscaler_v1'
const STORE = 'blobs'
const LS_KEY = 'upscaler_jobs'

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function putBlob(key, blob) {
  const db = await openDB()
  const buf = await blob.arrayBuffer()
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put({ buf, type: blob.type }, key)
    tx.oncomplete = res
    tx.onerror = rej
  })
}

async function getBlob(key) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key)
    req.onsuccess = () => {
      const r = req.result
      resolve(r ? new Blob([r.buf], { type: r.type }) : null)
    }
    req.onerror = () => reject(req.error)
  })
}

async function deleteBlob(key) {
  const db = await openDB()
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = res
    tx.onerror = rej
  })
}

export const savePreview = (localId, file) => putBlob(`pre:${localId}`, file)
export const saveResult  = (localId, blob) => putBlob(`res:${localId}`, blob)

export async function loadPreview(localId) {
  const blob = await getBlob(`pre:${localId}`)
  return blob ? URL.createObjectURL(blob) : null
}

export async function loadResult(localId) {
  const blob = await getBlob(`res:${localId}`)
  return blob ? URL.createObjectURL(blob) : null
}

export async function deleteJobBlobs(localId) {
  await Promise.allSettled([
    deleteBlob(`pre:${localId}`),
    deleteBlob(`res:${localId}`),
  ])
}

export function persistJobs(jobs) {
  const data = jobs
    .filter(j => j.jobId) // chỉ lưu những job đã gửi lên server
    .map(({ localId, jobId, file, status, progress, message, elapsed, resultSize, imgDims }) => ({
      localId, jobId,
      fileName: file?.name ?? '',
      status, progress, message, elapsed, resultSize, imgDims,
    }))
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)) } catch {}
}

export function restoreJobs() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') } catch { return [] }
}

export async function clearAllStorage() {
  localStorage.removeItem(LS_KEY)
  const db = await openDB()
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    tx.oncomplete = res
    tx.onerror = rej
  })
}
