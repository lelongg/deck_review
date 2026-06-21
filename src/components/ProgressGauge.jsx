// Amber progress gauge that fills as files are cleared (marked viewed).
export default function ProgressGauge({ done, total }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  return (
    <div className="gauge" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="gauge__track">
        <div className="gauge__fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="gauge__label">
        {done}/{total} cleared
      </span>
    </div>
  )
}
