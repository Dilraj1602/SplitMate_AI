import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { api, ApiError } from '../services/api'
import { AIAssistantPage } from './AIAssistantPage'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function renderAssistant() {
  vi.spyOn(api, 'get').mockResolvedValue({ data: [] } as never)
  return render(<MemoryRouter><AIAssistantPage /></MemoryRouter>)
}

describe('AI assistant', () => {
  it('sends a chat message, displays clarification, prepares a preview, and confirms the saved result', async () => {
    const post = vi.spyOn(api, 'post')
      .mockResolvedValueOnce({ data: { conversation_id: 'conversation-1', message: 'Which group should I use?', missing_fields: ['group'] } } as never)
      .mockResolvedValueOnce({ data: { conversation_id: 'conversation-1', message: 'Ready to add dinner.', pending_action_id: 'action-1', action_preview: { action: 'Create expense', group: 'Goa Trip', description: 'Dinner', amount: '1200.00', currency: 'INR', payer: 'Alice', split_type: 'Equal', expense_date: '2026-11-10', participants: [{ name: 'Alice', amount: '600.00' }, { name: 'Rahul', amount: '600.00' }] } } } as never)
      .mockResolvedValueOnce({ data: { result: { description: 'Dinner', total_amount: '1200.00', currency: 'INR' } } } as never)
    renderAssistant()
    const user = userEvent.setup()
    const textarea = screen.getByLabelText('Message the assistant')
    await user.type(textarea, 'Add dinner for 1200')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('Which group should I use?')).toBeInTheDocument()
    expect(screen.getByText('Needed: group')).toBeInTheDocument()
    await user.clear(textarea)
    await user.type(textarea, 'Goa Trip')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('Ready to add dinner.')).toBeInTheDocument()
    expect(screen.getByText('INR 1200.00')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Confirm action/ }))
    expect(await screen.findByText(/Dinner — INR 1200.00 was recorded successfully/)).toBeInTheDocument()
    expect(post).toHaveBeenLastCalledWith('/ai/actions/action-1/confirm')
  })

  it('cancels a pending action and displays server errors', async () => {
    const post = vi.spyOn(api, 'post')
      .mockResolvedValueOnce({ data: { conversation_id: 'conversation-1', message: 'Review this expense.', pending_action_id: 'action-2', action_preview: { action: 'Create expense', group: 'Trip', description: 'Lunch', amount: '500.00', currency: 'INR', payer: 'Alice', split_type: 'Equal', expense_date: '2026-11-10', participants: [] } } } as never)
      .mockResolvedValueOnce({ data: { status: 'cancelled' } } as never)
    renderAssistant()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Message the assistant'), 'Add lunch')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByText('Review this expense.')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('The pending action was cancelled.')).toBeInTheDocument()
    expect(post).toHaveBeenLastCalledWith('/ai/actions/action-2/cancel')

    post.mockRejectedValueOnce(new ApiError('Ollama is unavailable.', 503))
    await user.type(screen.getByLabelText('Message the assistant'), 'How much do I owe?')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ollama is unavailable.')
  })

  it('transcribes a recording into the editable message box', async () => {
    class FakeRecorder {
      state = 'inactive'
      mimeType = 'audio/webm'
      ondataavailable?: (event: { data: Blob }) => void
      onstop?: () => void
      stream = { getTracks: () => [{ stop: vi.fn() }] }
      start() { this.state = 'recording' }
      stop() {
        this.ondataavailable?.({ data: new Blob(['audio'], { type: this.mimeType }) })
        this.state = 'inactive'
        this.onstop?.()
      }
    }
    vi.stubGlobal('MediaRecorder', FakeRecorder)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) } })
    vi.spyOn(api, 'upload').mockResolvedValue({ data: { transcript: 'I paid 1200 rupees for dinner.' } } as never)
    renderAssistant()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Record voice' }))
    await user.click(screen.getByRole('button', { name: 'Stop recording' }))
    expect(await screen.findByLabelText('Message the assistant')).toHaveValue('I paid 1200 rupees for dinner.')
    expect(screen.getByText('Transcript is editable. Review it before sending.')).toBeInTheDocument()
  })
})
