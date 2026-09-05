import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import { bootRenderer } from './state/boot'
import { routeFromSearch } from './state/ui'
import './styles/global.css'

// In dev the StyleX plugin serves the compiled CSS from a virtual module (HMR); production
// builds append it to the emitted CSS asset, so nothing is imported there.
if (import.meta.env.DEV) {
  await import('virtual:stylex:runtime')
  if (!document.querySelector('link[href="/virtual:stylex.css"]')) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = '/virtual:stylex.css'
    document.head.appendChild(link)
  }
}

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

// The body background lives in global.css and has to go before the first paint on the shelf route.
document.body.dataset.view = routeFromSearch(window.location.search)
bootRenderer()

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
