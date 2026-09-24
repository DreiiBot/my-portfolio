import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import './styles.css'
import App from './App.tsx'

const root = document.getElementById('root')!
const app = (
  <StrictMode>
    <App />
  </StrictMode>
)

// Production builds arrive prerendered (see scripts/prerender.mjs); the dev server does not.
if (root.firstElementChild) hydrateRoot(root, app)
else createRoot(root).render(app)
