import './assets/main.css'

import {ThemeProvider} from 'next-themes'
import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'

import App from './App'
import {Toaster} from './components/ui/sonner'
import {TooltipProvider} from './components/ui/tooltip'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <TooltipProvider>
        <App />
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>
)
