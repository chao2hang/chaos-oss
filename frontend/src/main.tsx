import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider, MessageProvider } from '@chaos_team/chaos-ui'

import '@chaos_team/chaos-ui/styles.css'
import './index.css'
import App from './App'
import { AuthProvider } from './auth/AuthContext'
import { I18nProvider } from './i18n'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark" storageKey="chaos-theme">
        {/* MessageProvider only renders the sonner Toaster and discards
            children — mount it as a sibling, never wrap the app. */}
        <MessageProvider />
        <BrowserRouter>
          <I18nProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
          </I18nProvider>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
