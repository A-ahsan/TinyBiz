import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Stop mouse wheel from changing number input values while scrolling the page.
document.addEventListener(
  'wheel',
  (event) => {
    const active = document.activeElement
    if (active instanceof HTMLInputElement && active.type === 'number') {
      event.preventDefault()
    }
  },
  { passive: false, capture: true },
)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
