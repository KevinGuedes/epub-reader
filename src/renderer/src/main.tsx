import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// StrictMode is intentionally not used: it double-invokes effects in development, which would parse and
// render every book twice while epub.js is still loading it.
createRoot(document.getElementById('root')!).render(<App />)
