import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import FramesSite, { AboutUs } from './FramesSite.jsx'

export function App() {
  const [path,setPath] = useState(window.location.pathname)

  useEffect(() => {
    const updatePath = () => setPath(window.location.pathname)
    window.addEventListener('popstate', updatePath)
    return () => window.removeEventListener('popstate', updatePath)
  }, [])

  return path === '/about-us' ? <AboutUs /> : <FramesSite />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)

