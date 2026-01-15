import { useState, useRef, useEffect } from 'react'
import { Send, Bot, User, ExternalLink, Loader2, Image as ImageIcon, ChevronDown } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import Button from '@/components/Button'
import { cn } from '@/lib/utils'

interface ImageData {
  url: string
  sourceTitle: string
  relevance: number
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  sources?: Array<{
    title: string
    url: string
    section: string
  }>
  images?: ImageData[]
  totalImages?: number
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [apiKeyLoading, setApiKeyLoading] = useState(true)
  const [loadingMoreImages, setLoadingMoreImages] = useState<number | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Get actual API key from settings for internal UI use
    fetch('/api/settings/actual-keys')
      .then(res => res.json())
      .then(data => {
        // We need the chat API key, not the LLM key
      })
      .catch(() => {})
      .finally(() => setApiKeyLoading(false))
    
    // Also try to get the API key from settings
    fetch('/api/settings/chat-api-key')
      .then(res => res.json())
      .then(data => {
        if (data.apiKey) {
          setApiKey(data.apiKey)
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async () => {
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey || 'demo', // Will fail without proper key
        },
        body: JSON.stringify({
          message: userMessage,
          conversationId,
        }),
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        console.error('Chat error:', res.status, errorData)
        throw new Error(errorData.message || errorData.error || 'Failed to get response')
      }

      const data = await res.json()
      setConversationId(data.conversationId)
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: data.answer,
          sources: data.sources,
          images: data.images,
          totalImages: data.totalImages,
        },
      ])
    } catch (error) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: 'Sorry, I encountered an error. Please check your API key in Settings.',
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const loadMoreImages = async (messageIndex: number) => {
    if (!conversationId || loadingMoreImages !== null) return
    
    const message = messages[messageIndex]
    if (!message.images || !message.totalImages) return
    
    setLoadingMoreImages(messageIndex)
    
    try {
      const res = await fetch(`/api/chat/${conversationId}/images?offset=${message.images.length}&limit=5`, {
        headers: {
          'x-api-key': apiKey || 'demo',
        },
      })
      
      if (res.ok) {
        const data = await res.json()
        setMessages(prev => prev.map((msg, idx) => {
          if (idx === messageIndex && msg.images) {
            return {
              ...msg,
              images: [...msg.images, ...data.images],
            }
          }
          return msg
        }))
      }
    } catch (error) {
      console.error('Failed to load more images:', error)
    } finally {
      setLoadingMoreImages(null)
    }
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <h1 className="text-xl font-semibold text-slate-900">Chat with Your Docs</h1>
        <p className="text-sm text-slate-500">Ask questions about your documentation</p>
      </header>

      {/* API Key Input (temporary for demo) */}
      {!apiKey && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-amber-800">Enter your API key to chat:</span>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="Your API key from Settings"
              className="flex-1 max-w-xs px-3 py-1 text-sm border border-amber-300 rounded"
            />
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-auto p-6 space-y-6">
        {messages.length === 0 && (
          <div className="text-center py-12">
            <Bot className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <h2 className="text-xl font-medium text-slate-600 mb-2">Start a conversation</h2>
            <p className="text-slate-500">Ask anything about your documentation</p>
          </div>
        )}

        {messages.map((message, index) => (
          <div
            key={index}
            className={cn(
              'flex gap-4',
              message.role === 'user' ? 'justify-end' : 'justify-start'
            )}
          >
            {message.role === 'assistant' && (
              <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                <Bot size={18} className="text-primary-600" />
              </div>
            )}
            
            <div
              className={cn(
                'max-w-2xl rounded-2xl px-4 py-3',
                message.role === 'user'
                  ? 'bg-primary-600 text-white'
                  : 'bg-white border border-slate-200'
              )}
            >
              <div className={cn('prose prose-sm max-w-none', message.role === 'user' && 'prose-invert')}>
                <ReactMarkdown>{message.content}</ReactMarkdown>
              </div>
              
              {message.sources && message.sources.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-200">
                  <p className="text-xs font-medium text-slate-500 mb-2">Sources:</p>
                  <div className="flex flex-wrap gap-2">
                    {message.sources.map((source, i) => (
                      <a
                        key={i}
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded transition-colors"
                      >
                        {source.title}
                        <ExternalLink size={10} />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Images Section */}
              {message.images && message.images.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-200">
                  <p className="text-xs font-medium text-slate-500 mb-2 flex items-center gap-1">
                    <ImageIcon size={12} />
                    Related Images ({message.images.length}{message.totalImages && message.totalImages > message.images.length ? ` of ${message.totalImages}` : ''}):
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {message.images.map((img, i) => (
                      <a
                        key={i}
                        href={img.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block relative group"
                      >
                        <img
                          src={img.url}
                          alt={`From ${img.sourceTitle}`}
                          className="w-full h-24 object-cover rounded-lg border border-slate-200 hover:border-primary-400 transition-colors"
                          loading="lazy"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none'
                          }}
                        />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                          <ExternalLink size={16} className="text-white" />
                        </div>
                      </a>
                    ))}
                  </div>
                  {message.totalImages && message.totalImages > (message.images?.length || 0) && (
                    <button
                      onClick={() => loadMoreImages(index)}
                      disabled={loadingMoreImages === index}
                      className="mt-2 w-full flex items-center justify-center gap-1 text-xs text-primary-600 hover:text-primary-700 py-1 rounded hover:bg-primary-50 transition-colors disabled:opacity-50"
                    >
                      {loadingMoreImages === index ? (
                        <>
                          <Loader2 size={12} className="animate-spin" />
                          Loading...
                        </>
                      ) : (
                        <>
                          <ChevronDown size={12} />
                          Load more images ({message.totalImages - message.images.length} remaining)
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
            
            {message.role === 'user' && (
              <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
                <User size={18} className="text-slate-600" />
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex gap-4">
            <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
              <Loader2 size={18} className="text-primary-600 animate-spin" />
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3">
              <span className="text-slate-500">Thinking...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="bg-white border-t border-slate-200 p-4">
        <div className="max-w-4xl mx-auto flex gap-3">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about your documentation..."
            className="flex-1 px-4 py-3 border border-slate-300 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            rows={1}
          />
          <Button onClick={sendMessage} disabled={!input.trim() || loading}>
            <Send size={18} />
          </Button>
        </div>
      </div>
    </div>
  )
}
