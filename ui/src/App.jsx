import { useState, useRef, useEffect } from 'react'
import './App.css'

const API_URL = import.meta.env.VITE_API_BASE || 'http://localhost:3001'

function App() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)
  const [sessionId] = useState('default') // Use fixed session for persistence
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    inputRef.current?.focus()
    // Try to load saved newsletter, fallback to template
    loadSavedNewsletter()
  }, [])

  const sendMessage = async (e) => {
    e.preventDefault()
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setLoading(true)

    try {
      // Use streaming endpoint for real-time section updates
      const response = await fetch(`${API_URL}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage, sessionId })
      })

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finalMessage = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') continue
            
            try {
              const event = JSON.parse(data)
              
              switch (event.type) {
                case 'status':
                  setMessages(prev => {
                    const last = prev[prev.length - 1]
                    if (last?.role === 'status') {
                      return [...prev.slice(0, -1), { role: 'status', content: event.message }]
                    }
                    return [...prev, { role: 'status', content: event.message }]
                  })
                  break
                  
                case 'section_complete':
                  if (event.html) setHtml(event.html)
                  if (event.message) {
                    setMessages(prev => [...prev, { role: 'assistant', content: event.message }])
                  }
                  break
                  
                case 'tool_start':
                  setMessages(prev => {
                    const last = prev[prev.length - 1]
                    if (last?.role === 'status') {
                      return [...prev.slice(0, -1), { role: 'status', content: `Running ${event.tool}...` }]
                    }
                    return [...prev, { role: 'status', content: `Running ${event.tool}...` }]
                  })
                  break
                  
                case 'complete':
                  if (event.html) setHtml(event.html)
                  finalMessage = event.message || ''
                  break
                  
                case 'error':
                  setMessages(prev => [...prev, { role: 'error', content: event.message }])
                  break
              }
            } catch (parseErr) {
              // Ignore parse errors for incomplete JSON
            }
          }
        }
      }
      
      // Remove status messages and add final response
      setMessages(prev => {
        const filtered = prev.filter(m => m.role !== 'status')
        if (finalMessage) {
          let chatMessage = finalMessage.replace(/```html[\s\S]*?```/g, '✅ [HTML updated in preview]')
          return [...filtered, { role: 'assistant', content: chatMessage }]
        }
        return filtered
      })
      
    } catch (err) {
      setMessages(prev => [...prev, { role: 'error', content: `Connection error: ${err.message}` }])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e) => {
    // Submit on Enter without Shift
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(e)
    }
  }

  const copyHtml = async () => {
    try {
      await navigator.clipboard.writeText(html)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const clearSession = async () => {
    try {
      await fetch(`${API_URL}/api/session/${sessionId}`, { method: 'DELETE' })
      setMessages([])
      setHtml('')
      loadTemplate() // Reset to template
    } catch (err) {
      console.error('Failed to clear session:', err)
    }
  }

  const loadTemplate = async () => {
    try {
      const response = await fetch(`${API_URL}/api/template`)
      const data = await response.json()
      setHtml(data.html)
    } catch (err) {
      console.error('Failed to load template:', err)
    }
  }

  const saveNewsletter = async () => {
    try {
      const response = await fetch(`${API_URL}/api/newsletter/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, html, messages })
      })
      const data = await response.json()
      if (data.success) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      }
    } catch (err) {
      console.error('Failed to save newsletter:', err)
    }
  }

  const loadSavedNewsletter = async () => {
    try {
      const response = await fetch(`${API_URL}/api/newsletter/load?sessionId=${sessionId}`)
      const data = await response.json()
      if (data.success && data.html) {
        setHtml(data.html)
        if (data.messages) {
          setMessages(data.messages)
        }
      }
    } catch (err) {
      console.error('Failed to load saved newsletter:', err)
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-title">
          <img src="/logic-apps-logo.svg" alt="Logic Apps" className="header-logo" />
          <h1>Logic Apps Aviators Newsletter Editor</h1>
        </div>
        <div className="header-actions">
          <button onClick={saveNewsletter} className={`btn btn-primary ${saved ? 'saved' : ''}`}>
            {saved ? '✓ Saved!' : '💾 Save'}
          </button>
          <button onClick={clearSession} className="btn btn-secondary">
            Clear Session
          </button>
        </div>
      </header>

      <main className="main">
        <section className="chat-panel">
          <div className="panel-header">
            <h2>💬 Chat</h2>
          </div>
          <div className="messages">
            {messages.length === 0 && (
              <div className="welcome-message">
                <p>Welcome! I can help you create the newsletter.</p>
                <p>Try saying:</p>
                <ul>
                  <li>"Create the newsletter for February 2026"</li>
                  <li>"Compute the date window for March 2026"</li>
                  <li>"Get the email with subject Ace Aviator"</li>
                </ul>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`message ${msg.role}`}>
                <div className="message-content">
                  {msg.role === 'user' && <span className="role">You:</span>}
                  {msg.role === 'assistant' && <span className="role">Agent:</span>}
                  {msg.role === 'error' && <span className="role">Error:</span>}
                  <div className="text">{msg.content}</div>
                </div>
              </div>
            ))}
            {loading && (
              <div className="message assistant loading">
                <div className="message-content">
                  <span className="role">Agent:</span>
                  <div className="text">Thinking...</div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          <form onSubmit={sendMessage} className="input-form">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
              disabled={loading}
              rows={3}
            />
            <button type="submit" disabled={loading || !input.trim()}>
              Send
            </button>
          </form>
        </section>

        <section className="preview-panel">
          <div className="panel-header">
            <h2>📄 Newsletter Preview</h2>
            <button 
              onClick={copyHtml} 
              className={`btn btn-primary ${copied ? 'copied' : ''}`}
              disabled={!html}
            >
              {copied ? '✓ Copied!' : '📋 Copy HTML'}
            </button>
          </div>
          <div className="preview-container">
            {html ? (
              <div 
                className="preview-content"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            ) : (
              <div className="preview-empty">
                <p>Newsletter preview will appear here.</p>
                <p>Start a conversation to generate content.</p>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
