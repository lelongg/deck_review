import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'
// Syntax-highlighting palette: github-dark/light supply the --arb-*-dark /
// --arb-*-light color variables; arborium-tokens maps arborium's <a-*> token
// elements to them, following the OS color scheme (see arborium-tokens.css).
import '@arborium/arborium/themes/github-dark.css'
import '@arborium/arborium/themes/github-light.css'
import './arborium-tokens.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
