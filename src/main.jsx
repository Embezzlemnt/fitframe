import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import FramesSite from './FramesSite.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <FramesSite />
  </StrictMode>
)

