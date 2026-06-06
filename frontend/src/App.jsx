import { useCallback, useEffect, useRef, useState } from 'react'
import CompareSlider from './components/CompareSlider'
import ImageCard from './components/ImageCard'
import ModelSelector from './components/ModelSelector'
import UploadZone from './components/UploadZone'
import { deleteJobBlobs, loadPreview, loadResult, persistJobs, restoreJobs, savePreview, saveResult } from './storage'
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
    targetEdge: 2042,
  })
  const [selectedId, setSelectedId] = useState(null)

  const wsRefs      = useRef({})  // localId -> WebSocket
  const cancelledRef = useRef(new Set())

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

  const addFiles = useCallback((files) => {
    const newJobs = files.map(file => {
      const localId = uid()
      savePreview(localId, file)
      return {
        localId, file,
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

  // Persist jobs khi status thay đổi (không persist progress liên tục)
  const statusSig = jobs.map(j => `${j.localId}:${j.status}:${j.jobId ?? ''}`).join('|')
  useEffect(() => { if (jobs.length) persistJobs(jobs) }, [statusSig]) // eslint-disable-line

  // Restore jobs từ localStorage + IndexedDB khi reload
  useEffect(() => {
    const saved = restoreJobs()
    if (!saved.length) return

    const restored = saved.map(r => ({
      localId: r.localId,
      file: { name: r.fileName },
      previewUrl: null,
      imgDims: r.imgDims ?? null,
      status: r.status,
      progress: r.progress ?? 0,
      message: r.message ?? '',
      jobId: r.jobId,
      resultUrl: null,
      resultSize: r.resultSize ?? null,
      elapsed: r.elapsed ?? null,
    }))

    setJobs(restored)

    restored.forEach(async (job) => {
      const previewUrl = await loadPreview(job.localId)
      if (previewUrl)
        setJobs(prev => prev.map(j => j.localId === job.localId ? { ...j, previewUrl } : j))

      if (job.status === 'done') {
        const resultUrl = await loadResult(job.localId)
        if (resultUrl)
          setJobs(prev => prev.map(j => j.localId === job.localId ? { ...j, resultUrl } : j))
      } else if (job.status === 'processing' && job.jobId) {
        connectWS(job.localId, job.jobId)
      }
    })
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
            <div className={styles.summary}>
              <span>{jobs.filter(j => j.status === 'done').length}/{jobs.length} hoàn thành</span>
              {jobs.some(j => j.status === 'error') && (
                <span className={styles.errCount}>{jobs.filter(j => j.status === 'error').length} lỗi</span>
              )}
              {jobs.some(j => j.status === 'cancelled') && (
                <span className={styles.cancelCount}>{jobs.filter(j => j.status === 'cancelled').length} đã hủy</span>
              )}
            </div>
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
