import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'
// Syntax-highlighting palette: github-dark supplies the --arb-*-dark color
// variables; arborium-tokens maps arborium's <a-*> token elements to them
// (scoped to .diff, forced dark — see src/arborium-tokens.css).
import '@arborium/arborium/themes/github-dark.css'
import './arborium-tokens.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
