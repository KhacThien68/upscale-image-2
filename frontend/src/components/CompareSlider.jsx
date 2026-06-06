import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './CompareSlider.module.css'

export default function CompareSlider({ before, after }) {
  const [pos, setPos] = useState(50)
  const containerRef = useRef(null)
  const dragging = useRef(false)

  const clamp = (v) => Math.max(1, Math.min(99, v))

  const updateFromClient = useCallback((clientX) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setPos(clamp(((clientX - rect.left) / rect.width) * 100))
  }, [])

  const onMouseDown = (e) => { dragging.current = true; updateFromClient(e.clientX) }
  const onTouchStart = (e) => { dragging.current = true; updateFromClient(e.touches[0].clientX) }

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return
      updateFromClient(e.clientX ?? e.touches?.[0]?.clientX)
    }
    const onUp = () => { dragging.current = false }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove)
    window.addEventListener('touchend', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
    }
  }, [updateFromClient])

  return (
    <div
      ref={containerRef}
      className={styles.container}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
    >
      <img src={before} className={styles.img} draggable={false} alt="before" />

      <div
        className={styles.afterWrapper}
        style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
      >
        <img src={after} className={styles.img} draggable={false} alt="after" />
      </div>

      <div className={styles.divider} style={{ left: `${pos}%` }}>
        <div className={styles.handle}>
          <span>◀</span>
          <span>▶</span>
        </div>
      </div>

      <span className={`${styles.badge} ${styles.badgeBefore}`}>Gốc</span>
      <span className={`${styles.badge} ${styles.badgeAfter}`}>AI</span>
    </div>
  )
}
