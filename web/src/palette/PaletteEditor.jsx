import { useState, useRef } from 'react'
import { slotToHex, hexToSlot, identity332 } from './clut.js'

const STORAGE_KEY = 'titan.cluts'

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function isValidPalette(arr) {
  return Array.isArray(arr) && arr.length === 256 && arr.every(h => typeof h === 'string' && /^#[0-9a-fA-F]{6}$/.test(h))
}

export default function PaletteEditor({ clutData, clutTexture }) {
  const [open, setOpen] = useState(false)
  const [version, setVersion] = useState(0)
  const [selected, setSelected] = useState(0)
  const [name, setName] = useState('')
  const [saved, setSaved] = useState(loadSaved)
  const fileInputRef = useRef(null)

  const bump = () => setVersion(v => v + 1)
  const touch = () => {
    clutTexture.needsUpdate = true
    bump()
  }

  const handleSwatchChange = (i, hex) => {
    hexToSlot(clutData, i, hex)
    touch()
  }

  const handleSave = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const palette = []
    for (let i = 0; i < 256; i++) palette.push(slotToHex(clutData, i))
    const next = { ...saved, [trimmed]: palette }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setSaved(next)
  }

  const handleLoad = (paletteName) => {
    const palette = saved[paletteName]
    if (!isValidPalette(palette)) return
    for (let i = 0; i < 256; i++) hexToSlot(clutData, i, palette[i])
    touch()
  }

  const handleDelete = (paletteName) => {
    const next = { ...saved }
    delete next[paletteName]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setSaved(next)
  }

  const handleReset = () => {
    clutData.set(identity332())
    touch()
  }

  const handleExport = () => {
    const palette = []
    for (let i = 0; i < 256; i++) palette.push(slotToHex(clutData, i))
    const blob = new Blob([JSON.stringify(palette)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'palette.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportFile = (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result)
        if (!isValidPalette(parsed)) return
        for (let i = 0; i < 256; i++) hexToSlot(clutData, i, parsed[i])
        touch()
      } catch {
        // ignore garbage
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  if (!open) {
    return (
      <button style={styles.toggleButton} onClick={() => setOpen(true)}>
        palette
      </button>
    )
  }

  const r = (selected >> 5) & 7
  const g = (selected >> 2) & 7
  const b = selected & 3

  return (
    <div style={styles.panel}>
      <style>{`
        .titan-palette-swatch { width: 14px; height: 14px; padding: 0; border: 1px solid #000; cursor: pointer; }
        .titan-palette-swatch.selected { outline: 1px solid #fff; outline-offset: 1px; }
        .titan-palette-input { background: #0d0f12; color: #ccc; border: 1px solid #333; border-radius: 3px; font-family: monospace; font-size: 11px; padding: 2px 4px; }
        .titan-palette-btn { background: #24292e; color: #ccc; border: 1px solid #3a3f45; border-radius: 3px; font-family: monospace; font-size: 11px; padding: 2px 6px; cursor: pointer; }
        .titan-palette-btn:hover { background: #2d333a; }
      `}</style>

      <div style={styles.header}>
        <span>palette</span>
        <button className="titan-palette-btn" onClick={() => setOpen(false)}>x</button>
      </div>

      <div style={styles.body}>
        <div
          style={styles.grid}
          onClick={(e) => {
            const idx = e.target.getAttribute('data-idx')
            if (idx != null) setSelected(Number(idx))
          }}
        >
          {Array.from({ length: 256 }, (_, i) => (
            <button
              key={i}
              data-idx={i}
              className={'titan-palette-swatch' + (i === selected ? ' selected' : '')}
              style={{ background: slotToHex(clutData, i) }}
              title={'slot ' + i}
            />
          ))}
        </div>

        <div style={styles.editColumn}>
          <div>slot {selected} (r{r} g{g} b{b})</div>
          <input
            type="color"
            value={slotToHex(clutData, selected)}
            onChange={(e) => handleSwatchChange(selected, e.target.value)}
          />

          <div style={styles.row}>
            <input
              className="titan-palette-input"
              placeholder="palette name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="titan-palette-btn" onClick={handleSave}>save</button>
          </div>

          <div style={styles.savedList}>
            {Object.keys(saved).length === 0 && <div style={styles.dim}>no saved palettes</div>}
            {Object.keys(saved).map(n => (
              <div key={n} style={styles.row}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n}</span>
                <button className="titan-palette-btn" onClick={() => handleLoad(n)}>load</button>
                <button className="titan-palette-btn" onClick={() => handleDelete(n)}>del</button>
              </div>
            ))}
          </div>

          <div style={styles.row}>
            <button className="titan-palette-btn" onClick={handleReset}>reset</button>
            <button className="titan-palette-btn" onClick={handleExport}>export</button>
            <button className="titan-palette-btn" onClick={() => fileInputRef.current.click()}>import</button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              onChange={handleImportFile}
            />
          </div>

          <div style={styles.dim}>applies in rgb332 colour mode</div>
        </div>
      </div>
    </div>
  )
}

const styles = {
  toggleButton: {
    position: 'fixed',
    left: 12,
    bottom: 12,
    zIndex: 10,
    background: '#181c20',
    color: '#ccc',
    border: '1px solid #333',
    borderRadius: 4,
    fontFamily: 'monospace',
    fontSize: 11,
    padding: '4px 8px',
    cursor: 'pointer',
  },
  panel: {
    position: 'fixed',
    left: 12,
    bottom: 12,
    zIndex: 10,
    background: '#181c20',
    color: '#ccc',
    border: '1px solid #333',
    borderRadius: 4,
    fontFamily: 'monospace',
    fontSize: 11,
    padding: 8,
    width: 380,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  body: {
    display: 'flex',
    gap: 8,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(16, 14px)',
    gridTemplateRows: 'repeat(16, 14px)',
    gap: 1,
    flexShrink: 0,
  },
  editColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  row: {
    display: 'flex',
    gap: 4,
    alignItems: 'center',
  },
  savedList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    maxHeight: 80,
    overflowY: 'auto',
  },
  dim: {
    color: '#666',
    fontSize: 10,
  },
}
