import { useState } from 'react'
import styles from './ModelSelector.module.css'

const MODELS = [
  {
    id: 'realesrgan-x4plus',
    label: 'Ảnh thật · 4×',
    desc: 'Ảnh chụp, chân dung, phong cảnh',
  },
  {
    id: 'realesrgan-x4plus-anime',
    label: 'Anime · 4×',
    desc: 'Illustration, manga, anime, vẽ tay',
  },
  {
    id: 'realesrnet-x4plus',
    label: 'Nhanh · 4×',
    desc: 'Xử lý nhanh hơn, chất lượng tốt',
  },
]

const EDGE_PRESETS = [2048, 4096]

export default function ModelSelector({ model, scale, faceEnhance, useTargetEdge, targetEdge, onChange, disabled }) {
  const [customVal, setCustomVal] = useState('')

  // preset is active only when no custom text is entered
  const activePreset = customVal === ''
    ? (EDGE_PRESETS.includes(targetEdge) ? targetEdge : null)
    : null

  const handlePreset = (val) => {
    setCustomVal('')
    onChange({ targetEdge: val })
  }

  const handleCustomChange = (e) => {
    const raw = e.target.value
    setCustomVal(raw)
    const v = parseInt(raw, 10)
    if (!isNaN(v) && v >= 64) onChange({ targetEdge: v })
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.label}>Model AI</div>
      {MODELS.map((m) => (
        <label
          key={m.id}
          className={[styles.card, model === m.id && styles.active, disabled && styles.disabled]
            .filter(Boolean).join(' ')}
        >
          <input
            type="radio"
            name="model"
            value={m.id}
            checked={model === m.id}
            onChange={() => onChange({ model: m.id })}
            disabled={disabled}
          />
          <div>
            <div className={styles.cardLabel}>{m.label}</div>
            <div className={styles.cardDesc}>{m.desc}</div>
          </div>
        </label>
      ))}

      <div className={styles.label} style={{ marginTop: '1rem' }}>Output Size</div>
      <div className={styles.scaleRow}>
        <button
          type="button"
          className={[styles.scaleBtn, useTargetEdge && styles.scaleActive].filter(Boolean).join(' ')}
          onClick={() => onChange({ useTargetEdge: true })}
          disabled={disabled}
        >
          Cạnh dài
        </button>
        <button
          type="button"
          className={[styles.scaleBtn, !useTargetEdge && styles.scaleActive].filter(Boolean).join(' ')}
          onClick={() => onChange({ useTargetEdge: false })}
          disabled={disabled}
        >
          Scale ×
        </button>
      </div>

      {useTargetEdge ? (
        <>
          <div className={styles.scaleRow}>
            {EDGE_PRESETS.map(val => (
              <button
                key={val}
                type="button"
                className={[styles.scaleBtn, activePreset === val && styles.scaleActive].filter(Boolean).join(' ')}
                onClick={() => handlePreset(val)}
                disabled={disabled}
              >
                {val.toLocaleString()}
              </button>
            ))}
          </div>
          <div className={styles.edgeRow}>
            <input
              type="number"
              className={[styles.edgeInput, activePreset === null && styles.edgeInputActive].filter(Boolean).join(' ')}
              value={customVal}
              placeholder="Tuỳ chỉnh..."
              min={256}
              max={16384}
              step={64}
              disabled={disabled}
              onChange={handleCustomChange}
            />
            <span className={styles.edgeUnit}>px</span>
          </div>
        </>
      ) : (
        <div className={styles.scaleRow}>
          {[2, 4].map((s) => (
            <button
              key={s}
              className={[styles.scaleBtn, scale === s && styles.scaleActive].filter(Boolean).join(' ')}
              onClick={() => onChange({ scale: s })}
              disabled={disabled}
              type="button"
            >
              {s}×
            </button>
          ))}
        </div>
      )}

      <label className={[styles.toggle, disabled && styles.disabled].filter(Boolean).join(' ')}>
        <input
          type="checkbox"
          checked={faceEnhance}
          onChange={(e) => onChange({ faceEnhance: e.target.checked })}
          disabled={disabled}
        />
        <span className={styles.checkmark} />
        <span>Kích nét khuôn mặt <small>(GFPGAN)</small></span>
      </label>
    </div>
  )
}
