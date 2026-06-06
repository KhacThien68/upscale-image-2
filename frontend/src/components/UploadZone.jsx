import { useRef, useState } from 'react'
import styles from './UploadZone.module.css'

const ACCEPT = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp']

export default function UploadZone({ onFiles, disabled }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  const handleFiles = (fileList) => {
    const valid = Array.from(fileList).filter(f => ACCEPT.includes(f.type))
    if (valid.length) onFiles(valid)
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    if (!disabled) handleFiles(e.dataTransfer.files)
  }

  return (
    <div
      className={[styles.zone, dragging && styles.dragging, disabled && styles.disabled].filter(Boolean).join(' ')}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => !disabled && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT.join(',')}
        multiple
        style={{ display: 'none' }}
        onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }}
        disabled={disabled}
      />
      <div className={styles.prompt}>
        <span className={styles.icon}>🖼</span>
        <p>Kéo ảnh vào đây</p>
        <p className={styles.hint}>Nhiều ảnh · JPG PNG WebP BMP</p>
      </div>
    </div>
  )
}
