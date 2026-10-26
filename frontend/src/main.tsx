import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './app/providers'
import { AuthProvider } from './app/auth'
import { router } from './app/router'
import { ToastProvider } from './components/ui/ToastProvider'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider><AuthProvider><RouterProvider router={router} /></AuthProvider></ToastProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
