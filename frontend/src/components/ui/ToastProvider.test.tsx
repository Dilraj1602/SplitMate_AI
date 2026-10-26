import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ToastProvider, useToast } from './ToastProvider'

afterEach(cleanup)
function Actions() {
  const toast = useToast()
  return <><button onClick={() => toast.success('Saved successfully.')}>Show success</button><button onClick={() => toast.error('Unable to save.')}>Show error</button></>
}

describe('global toast notifications', () => {
  it('renders success and error notifications with accessible roles', () => {
    render(<ToastProvider><Actions /></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Show success' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show error' }))
    expect(screen.getByRole('status')).toHaveTextContent('Saved successfully.')
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to save.')
  })

  it('deduplicates repeated notifications and allows dismissal', () => {
    render(<ToastProvider><Actions /></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Show success' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show success' }))
    expect(screen.getAllByRole('status')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
