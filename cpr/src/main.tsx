import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AssessmentProvider } from './services/AssessmentContext.tsx'
import { LocalStorageAssessmentService } from './services/LocalStorageAssessmentService.ts'

/**
 * To swap in a real backend, replace LocalStorageAssessmentService with your
 * implementation of AssessmentService (REST, SharePoint, IndexedDB, etc.)
 * and pass it here. No other code changes required.
 */
const service = new LocalStorageAssessmentService()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AssessmentProvider service={service}>
      <App />
    </AssessmentProvider>
  </StrictMode>,
)
