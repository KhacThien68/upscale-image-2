import { useCallback, useEffect, useRef, useState } from 'react'
import CompareSlider from './components/CompareSlider'
import ImageCard from './components/ImageCard'
import ModelSelector from './components/ModelSelector'
import UploadZone from './components/UploadZone'
import { clearAllStorage, deleteJobBlobs, savePreview, saveResult } from './storage'
import styles from './App.module.css'

let _seq = 0
const uid = () => `j${++_seq}_${Date.now()}`

const WS_URL = (jobId) => `ws://${location.host}/ws/${jobId}`

export default function App() {
  const [jobs, setJobs] = useState([])
  const [options, setOptions] = useState({
    model: 'realesrnet-x4plus',
    scale: 4,
    faceEnhance: true,
    useTargetEdge: true,
    targetEdge: 2048,
  })
  const [selectedId, setSelectedId] = useState(null)

  const wsRefs      = useRef({})  // localId -> WebSocket
  const cancelledRef = useRef(new Set())
  const savedDirHandle = useRef(null)

  const updateJob = useCallback((localId, patch) => {
    setJobs(prev => prev.map(j => j.localId === localId ? { ...j, ...patch } : j))
  }, [])

  const closeWS = useCallback((localId) => {
    const ws = wsRefs.current[localId]
    if (ws) {
      ws.onmessage = null
      ws.onerror = null
      ws.onclose = null
      ws.close()
      delete wsRefs.current[localId]
    }
  }, [])

  const connectWS = useCallback((localId, jobId, onComplete) => {
    closeWS(localId)

    const ws = new WebSocket(WS_URL(jobId))
    wsRefs.current[localId] = ws

    ws.onmessage = async (evt) => {
      let data
      try { data = JSON.parse(evt.data) } catch { return }

      if (data.type === 'ping') return

      updateJob(localId, { progress: data.progress ?? 0, message: data.message ?? '' })

      if (data.status === 'done') {
        closeWS(localId)
        try {
          const rRes = await fetch(`/api/result/${jobId}`)
          const blob = await rRes.blob()
          saveResult(localId, blob)
          updateJob(localId, {
            status: 'done',
            progress: 100,
            resultUrl: URL.createObjectURL(blob),
            resultSize: data.result_size ?? blob.size,
            elapsed: data.elapsed,
          })
        } catch (err) {
          updateJob(localId, { status: 'error', message: err.message })
        }
        onComplete?.()
      } else if (data.status === 'error') {
        closeWS(localId)
        updateJob(localId, { status: 'error', message: data.message })
        onComplete?.()
      } else if (data.status === 'cancelled') {
        closeWS(localId)
        updateJob(localId, { status: 'cancelled' })
        onComplete?.()
      }
    }

    ws.onerror = () => {
      closeWS(localId)
      updateJob(localId, { status: 'error', message: 'Mất kết nối WebSocket' })
      onComplete?.()
    }

    ws.onclose = () => {
      delete wsRefs.current[localId]
    }
  }, [updateJob, closeWS])

  const runJob = useCallback(async (job, opts, onComplete) => {
    if (cancelledRef.current.has(job.localId)) { onComplete?.(); return }

    updateJob(job.localId, { status: 'processing', progress: 0, message: 'Đang tải ảnh lên...' })
    const form = new FormData()
    form.append('file', job.file)
    form.append('model', opts.model)
    form.append('scale', String(opts.scale))
    form.append('face_enhance', String(opts.faceEnhance))
    form.append('target_edge', String(opts.useTargetEdge ? opts.targetEdge : 0))
    try {
      const res = await fetch('/api/upscale', { method: 'POST', body: form })
      if (!res.ok) throw new Error(await res.text())
      const { job_id } = await res.json()
      updateJob(job.localId, { jobId: job_id })
      connectWS(job.localId, job_id, onComplete)
    } catch (err) {
      updateJob(job.localId, { status: 'error', message: err.message })
      onComplete?.()
    }
  }, [updateJob, connectWS])

  const cancelJob = useCallback(async (localId, jobId) => {
    cancelledRef.current.add(localId)
    closeWS(localId)
    updateJob(localId, { status: 'cancelled', progress: 0, message: '' })
    deleteJobBlobs(localId)
    if (jobId) {
      try { await fetch(`/api/cancel/${jobId}`, { method: 'POST' }) } catch {}
    }
  }, [closeWS, updateJob])

  // Fix StrictMode bug: side effects phải ở ngoài setJobs updater
  const handleUpscaleAll = useCallback(() => {
    const pending = jobs.filter(j => j.status === 'pending')
    if (!pending.length) return
    const run = (i) => { if (i < pending.length) runJob(pending[i], options, () => run(i + 1)) }
    run(0)
  }, [jobs, options, runJob])

  const handleDownload = useCallback((job) => {
    if (!job.resultUrl) return
    const base = job.file.name.replace(/\.[^.]+$/, '')
    const a = document.createElement('a')
    a.href = job.resultUrl
    a.download = `${base}_${options.scale}x_upscaled.jpg`
    a.click()
  }, [options.scale])

  const handleDownloadAll = useCallback(async () => {
    const done = jobs.filter(j => j.status === 'done' && j.resultUrl)
    if (!done.length) return

    const baseName = name => name.replace(/\.[^.]+$/, '')
    const resultName = job => `${baseName(job.file.name)}_${options.scale}x_upscaled.jpg`

    if (!window.showDirectoryPicker) {
      done.forEach(job => handleDownload(job))
      return
    }

    // Kiểm tra xem handle đã lưu còn dùng được không
    let dirHandle = savedDirHandle.current
    if (dirHandle) {
      const perm = await dirHandle.queryPermission({ mode: 'readwrite' })
      if (perm !== 'granted') dirHandle = null
    }

    // Chỉ hỏi nếu chưa có handle hợp lệ — dialog tự mở tại thư mục nguồn
    if (!dirHandle) {
      const firstHandle = done.find(j => j.fileHandle)?.fileHandle
      try {
        dirHandle = await window.showDirectoryPicker({
          mode: 'readwrite',
          ...(firstHandle ? { startIn: firstHandle } : {}),
        })
        savedDirHandle.current = dirHandle
      } catch (e) {
        if (e.name !== 'AbortError') done.forEach(job => handleDownload(job))
        return
      }
    }

    const saveDir = await dirHandle.getDirectoryHandle('Anh chinh sua', { create: true })

    for (const job of done) {
      try {
        const blob = await fetch(job.resultUrl).then(r => r.blob())
        const fh = await saveDir.getFileHandle(resultName(job), { create: true })
        const writable = await fh.createWritable()
        await writable.write(blob)
        await writable.close()
      } catch {}
    }
  }, [jobs, handleDownload, options.scale])

  const handleDelete = useCallback(async (localId, jobId) => {
    closeWS(localId)
    cancelledRef.current.add(localId)
    setJobs(prev => {
      const job = prev.find(j => j.localId === localId)
      if (job) {
        if (job.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(job.previewUrl)
        if (job.resultUrl?.startsWith('blob:')) URL.revokeObjectURL(job.resultUrl)
      }
      return prev.filter(j => j.localId !== localId)
    })
    deleteJobBlobs(localId)
    if (jobId) {
      try { await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' }) } catch {}
    }
  }, [closeWS])

  const handleRetry = useCallback((job) => {
    if (!(job.file instanceof File)) return
    cancelledRef.current.delete(job.localId)
    deleteJobBlobs(job.localId)
    updateJob(job.localId, { jobId: null, resultUrl: null, resultSize: null, elapsed: null })
    runJob(job, options, () => {})
  }, [updateJob, runJob, options])

  const handleClearAll = useCallback(async () => {
    Object.keys(wsRefs.current).forEach(id => closeWS(id))
    setJobs(prev => {
      prev.forEach(j => {
        if (j.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(j.previewUrl)
        if (j.resultUrl?.startsWith('blob:')) URL.revokeObjectURL(j.resultUrl)
      })
      return []
    })
    setSelectedId(null)
    cancelledRef.current.clear()
    savedDirHandle.current = null
    await clearAllStorage()
    try { await fetch('/api/jobs/all', { method: 'DELETE' }) } catch {}
  }, [closeWS])

  const addFiles = useCallback((files, handles = []) => {
    const newJobs = files.map((file, i) => {
      const localId = uid()
      savePreview(localId, file)
      return {
        localId, file,
        fileHandle: handles[i] ?? null,
        previewUrl: URL.createObjectURL(file),
        imgDims: null,
        status: 'pending',
        progress: 0, message: '',
        jobId: null, resultUrl: null, resultSize: null, elapsed: null,
      }
    })
    newJobs.forEach(job => {
      const img = new Image()
      img.onload = () =>
        setJobs(prev => prev.map(j =>
          j.localId === job.localId ? { ...j, imgDims: { w: img.naturalWidth, h: img.naturalHeight } } : j
        ))
      img.src = job.previewUrl
    })
    setJobs(prev => [...prev, ...newJobs])
  }, [])

  // Xoá toàn bộ dữ liệu cũ khi reload trang
  useEffect(() => {
    clearAllStorage().catch(() => {})
    fetch('/api/jobs/all', { method: 'DELETE' }).catch(() => {})
  }, []) // eslint-disable-line

  // Close modal on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setSelectedId(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Cleanup
  useEffect(() => () => {
    Object.values(wsRefs.current).forEach(ws => {
      ws.onmessage = null; ws.onerror = null; ws.onclose = null; ws.close()
    })
    jobs.forEach(j => {
      if (j.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(j.previewUrl)
      if (j.resultUrl?.startsWith('blob:')) URL.revokeObjectURL(j.resultUrl)
    })
  }, [])

  const pendingCount    = jobs.filter(j => j.status === 'pending').length
  const processingCount = jobs.filter(j => j.status === 'processing').length
  const doneCount       = jobs.filter(j => j.status === 'done').length
  const selectedJob     = selectedId ? jobs.find(j => j.localId === selectedId) : null

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.logo}>🔮</span>
          <h1>AI Image Upscaler</h1>
        </div>
        <div className={styles.badges}>
          <span className={styles.badge}>RTX 3060</span>
          <span className={styles.badge}>Real-ESRGAN</span>
          <span className={styles.badge}>GFPGAN</span>
          {processingCount > 0 && (
            <span className={`${styles.badge} ${styles.badgeActive}`}>
              <span className={styles.dot} /> {processingCount} đang xử lý
            </span>
          )}
        </div>
      </header>

      <div className={styles.main}>
        <aside className={styles.sidebar}>
          <UploadZone onFiles={addFiles} disabled={false} />

          <ModelSelector
            model={options.model}
            scale={options.scale}
            faceEnhance={options.faceEnhance}
            useTargetEdge={options.useTargetEdge}
            targetEdge={options.targetEdge}
            onChange={(c) => setOptions(p => ({ ...p, ...c }))}
            disabled={processingCount > 0}
          />

          <button
            className={styles.btnUpscale}
            onClick={handleUpscaleAll}
            disabled={pendingCount === 0 || processingCount > 0}
          >
            {processingCount > 0 ? (
              <><span className={styles.spinner} /> {processingCount} ảnh đang xử lý</>
            ) : (
              `⚡ Upscale ${pendingCount} ảnh`
            )}
          </button>

          {jobs.length > 0 && (
            <>
              <div className={styles.summary}>
                <span>{doneCount}/{jobs.length} hoàn thành</span>
                {jobs.some(j => j.status === 'error') && (
                  <span className={styles.errCount}>{jobs.filter(j => j.status === 'error').length} lỗi</span>
                )}
                {jobs.some(j => j.status === 'cancelled') && (
                  <span className={styles.cancelCount}>{jobs.filter(j => j.status === 'cancelled').length} đã hủy</span>
                )}
              </div>
              {doneCount > 0 && (
                <button className={styles.btnDownloadAll} onClick={handleDownloadAll}>
                  ↓ Tải xuống tất cả ({doneCount})
                </button>
              )}
              <button className={styles.btnClearAll} onClick={handleClearAll}>
                🗑 Xoá hết
              </button>
            </>
          )}
        </aside>

        <section className={styles.content}>
          {jobs.length === 0 ? (
            <div className={styles.placeholder}>
              <span>🖼</span>
              <p>Upload ảnh và nhấn Upscale</p>
              <p className={styles.hint}>Hỗ trợ nhiều ảnh · Xử lý tuần tự · Xuất JPG</p>
            </div>
          ) : (
            <div className={styles.grid}>
              {jobs.map(job => (
                <ImageCard
                  key={job.localId}
                  job={job}
                  scale={options.scale}
                  onClick={() => job.status === 'done' && setSelectedId(job.localId)}
                  onDownload={() => handleDownload(job)}
                  onCancel={() => cancelJob(job.localId, job.jobId)}
                  onRetry={job.file instanceof File ? () => handleRetry(job) : null}
                  onDelete={() => handleDelete(job.localId, job.jobId)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Compare Modal */}
      {selectedJob?.resultUrl && (
        <div className={styles.modal} onClick={() => setSelectedId(null)}>
          <div className={styles.modalBox} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle}>{selectedJob.file.name}</span>
              <div className={styles.modalActions}>
                {selectedJob.imgDims && (() => {
                  const { w, h } = selectedJob.imgDims
                  let ow, oh
                  if (options.useTargetEdge) {
                    const s = options.targetEdge / Math.max(w, h)
                    ow = Math.round(w * s); oh = Math.round(h * s)
                  } else {
                    ow = w * options.scale; oh = h * options.scale
                  }
                  return <span className={styles.modalMeta}>{ow}×{oh}</span>
                })()}
                {selectedJob.elapsed != null && (
                  <span className={styles.modalMeta}>⏱ {selectedJob.elapsed.toFixed(1)}s</span>
                )}
                {selectedJob.resultSize != null && (
                  <span className={styles.modalMeta}>
                    {selectedJob.resultSize < 1048576
                      ? `${(selectedJob.resultSize / 1024).toFixed(0)} KB`
                      : `${(selectedJob.resultSize / 1048576).toFixed(1)} MB`}
                  </span>
                )}
                <button className={styles.btnDl} onClick={() => handleDownload(selectedJob)}>
                  ↓ Tải JPG
                </button>
                <button className={styles.modalClose} onClick={() => setSelectedId(null)}>✕</button>
              </div>
            </div>
            <CompareSlider before={selectedJob.previewUrl} after={selectedJob.resultUrl} />
          </div>
        </div>
      )}
    </div>
  )
}
