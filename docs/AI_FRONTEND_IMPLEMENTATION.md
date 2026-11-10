# AI Frontend Implementation

`frontend/src/pages/AIAssistantPage.tsx` is a route inside the existing authenticated app at `/app/assistant`. It uses the established API client, authentication token, and design tokens.

The page loads the caller’s most recent persisted conversation, sends subsequent messages with its conversation ID, and displays structured assistant replies. It provides loading and error states, clickable group/member/expense clarification choices, and previews with confirm/cancel controls. Confirmation reports a result only after the backend returns the persisted entity; settlement proposals are marked as waiting for the other member.

Voice uses the browser microphone and `MediaRecorder`, shows recording/stop state, uploads to the local transcription endpoint, then places recognized text in the editable textarea. Users can review and edit before sending. The same typed-message path submits the transcript. Microphone permission, unsupported browser, transcription, and API errors are shown to the user.
