import styles from './ImageCard.module.css'

const fmtSize = (b) =>
  b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`

export default function ImageCard({ job, scale, onClick, onDownload, onCancel, onRetry, onDelete }) {
  const { file, previewUrl, status, progress, message, resultSize, elapsed } = job

  const cancellable = status === 'pending' || status === 'processing'

  return (
    <div
      className={[styles.card, styles[status], status === 'done' && styles.clickable].filter(Boolean).join(' ')}
      onClick={onClick}
      title={status === 'done' ? 'Click để so sánh trước/sau' : file.name}
    >
      <div className={styles.thumb}>
        {/* Preview image or placeholder */}
        {previewUrl
          ? <img src={previewUrl} alt={file.name} className={styles.img} draggable={false} />
          : <div className={styles.imgPlaceholder} />
        }

        {/* Cancel button (top-left, shown on hover) */}
        {cancellable && (
          <button
            className={styles.cancelBtn}
            onClick={(e) => { e.stopPropagation(); onCancel() }}
            title="Hủy"
          >✕</button>
        )}

        {/* Delete button (top-right, shown on hover, all statuses) */}
        <button
          className={styles.deleteBtn}
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          title="Xoá"
        >🗑</button>

        {/* Processing overlay */}
        {status === 'processing' && (
          <div className={styles.overlay}>
            <div className={styles.ring}>
              <span className={styles.pct}>{progress}%</span>
            </div>
            <p className={styles.msg}>{message}</p>
          </div>
        )}

        {/* Done badge (top-right) */}
        {status === 'done' && <div className={styles.doneTag}>✓</div>}

        {/* Error overlay */}
        {status === 'error' && <div className={styles.errOverlay}>❌</div>}

        {/* Cancelled overlay */}
        {status === 'cancelled' && <div className={styles.cancelledOverlay}>🚫</div>}

        {/* Hover hint for done */}
        {status === 'done' && <div className={styles.hoverHint}>🔍 So sánh</div>}
      </div>

      <div className={styles.footer}>
        <span className={styles.name} title={file.name}>
          {file.name.length > 20 ? file.name.slice(0, 18) + '…' : file.name}
        </span>

        {status === 'pending' && <span className={styles.chip}>Chờ</span>}

        {status === 'processing' && (
          <div className={styles.bar}>
            <div className={styles.fill} style={{ width: `${progress}%` }} />
          </div>
        )}

        {status === 'done' && (
          <div className={styles.doneRow}>
            {elapsed != null && <span className={styles.meta}>{elapsed.toFixed(1)}s</span>}
            {resultSize != null && <span className={styles.meta}>{fmtSize(resultSize)}</span>}
            <button
              className={styles.dlBtn}
              onClick={(e) => { e.stopPropagation(); onDownload() }}
              title="Tải về JPG"
            >↓</button>
          </div>
        )}

        {status === 'error' && (
          <div className={styles.errRow}>
            <span className={styles.errText}>Lỗi</span>
            {onRetry && (
              <button
                className={styles.retryBtn}
                onClick={(e) => { e.stopPropagation(); onRetry() }}
                title={message || 'Thử lại'}
              >↺ Thử lại</button>
            )}
          </div>
        )}
        {status === 'cancelled' && <span className={styles.cancelledText}>Đã hủy</span>}
      </div>
    </div>
  )
}
