import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '@hyprsh/design/tokens.css'
import '@hyprsh/design/styles.css'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './geist.css'

createRoot(document.getElementById('root')!).render(<App />)
