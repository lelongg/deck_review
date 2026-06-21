// Amber progress gauge that fills as files are cleared (marked viewed). Shows
// an undo control to revert the most recent mark-viewed, one step at a time.
export default function ProgressGauge({ done, total, canUndo, onUndo }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  return (
    <div className="gauge">
      <button
        className="gauge__undo"
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo last mark viewed (u)"
        aria-label="undo last mark viewed"
      >
        ↶
      </button>
      <div
        className="gauge__track"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="gauge__fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="gauge__label">
        {done}/{total} cleared
      </span>
    </div>
  )
}
