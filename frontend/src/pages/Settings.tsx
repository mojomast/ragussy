import { useState, useEffect, useCallback, useRef } from 'react'
import { Save, RefreshCw, Eye, EyeOff, Copy, Check, Bot, Upload, Database, Terminal, Send, Trash2, ExternalLink } from 'lucide-react'
import { useDropzone } from 'react-dropzone'
import Button from '@/components/Button'
import Card from '@/components/Card'
import Input from '@/components/Input'
import { useToast } from '@/components/Toast'

interface ApiLogEntry {
  id: string
  timestamp: Date
  method: string
  url: string
  status?: number
  duration?: number
  request?: any
  response?: any
  error?: string
}

interface Settings {
  projectName: string
  publicDocsBaseUrl: string
  docsPath: string
  docsExtensions: string
  qdrantUrl: string
  qdrantCollection: string
  vectorDim: number
  llmBaseUrl: string
  llmApiKey: string
  llmModel: string
  llmMaxTokens: number
  embedBaseUrl: string
  embedApiKey: string
  embedModel: string
  maxContextTokens: number
  retrievalTopK: number
  chunkTargetTokens: number
  chunkMaxTokens: number
  chunkOverlapTokens: number
  absoluteMaxTokens: number
  embeddingThreads: number
  upsertThreads: number
  failFastValidation: boolean
  apiKey: string
  adminToken: string
  customSystemPrompt: string
  // Discord Bot
  discordBotEnabled: boolean
  discordBotToken: string
  discordClientId: string
  discordGuildId: string
  discordBotName: string
  discordCommandPrefix: string
  discordEmbedColor: string
  discordCooldownSeconds: number
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showApiKeys, setShowApiKeys] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [uploadMode, setUploadMode] = useState<'url' | 'zip'>('url')
  const [uploading, setUploading] = useState(false)
  const [customLlmUrl, setCustomLlmUrl] = useState('')
  const [customEmbedUrl, setCustomEmbedUrl] = useState('')
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [availableEmbedModels, setAvailableEmbedModels] = useState<{id: string, name: string, dimensions: number | null}[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)
  const [fetchingEmbedModels, setFetchingEmbedModels] = useState(false)
  const { toast } = useToast()
  
  // Qdrant Console state
  const [qdrantInfo, setQdrantInfo] = useState<any>(null)
  const [qdrantCollections, setQdrantCollections] = useState<string[]>([])
  const [loadingQdrant, setLoadingQdrant] = useState(false)
  
  // API Request Console state
  const [apiLogs, setApiLogs] = useState<ApiLogEntry[]>([])
  const [apiMethod, setApiMethod] = useState<'GET' | 'POST' | 'PUT' | 'DELETE'>('GET')
  const [apiEndpoint, setApiEndpoint] = useState('/api/health')
  const [apiBody, setApiBody] = useState('')
  const [apiLoading, setApiLoading] = useState(false)
  const apiLogsRef = useRef<HTMLDivElement>(null)

  // Known embedding models with their dimensions
  const KNOWN_EMBEDDING_MODELS: Record<string, number> = {
    'text-embedding-3-small': 1536,
    'text-embedding-3-large': 3072,
    'text-embedding-ada-002': 1536,
    'openai/text-embedding-3-small': 1536,
    'openai/text-embedding-3-large': 3072,
    'openai/text-embedding-ada-002': 1536,
    // Google models
    'google/gemini-embedding-001': 768,
    'google/text-embedding-004': 768,
    // Voyage models
    'voyage-3': 1024,
    'voyage-3-lite': 512,
    'voyage-code-3': 1024,
    'voyage-finance-2': 1024,
    'voyage-law-2': 1024,
    'voyage-multilingual-2': 1024,
    'voyage-large-2': 1536,
    'voyage-2': 1024,
    // Cohere models
    'cohere/embed-english-v3.0': 1024,
    'cohere/embed-multilingual-v3.0': 1024,
    'cohere/embed-english-light-v3.0': 384,
    'cohere/embed-multilingual-light-v3.0': 384,
    'embed-english-v3.0': 1024,
    'embed-multilingual-v3.0': 1024,
    'embed-english-light-v3.0': 384,
    'embed-multilingual-light-v3.0': 384,
    // Mistral
    'mistral-embed': 1024,
    // BAAI BGE models
    'baai/bge-m3': 1024,
    'baai/bge-large-en-v1.5': 1024,
    'baai/bge-base-en-v1.5': 768,
    'baai/bge-small-en-v1.5': 384,
    'bge-m3': 1024,
    'bge-large-en-v1.5': 1024,
    'bge-base-en-v1.5': 768,
    'bge-small-en-v1.5': 384,
    // Qwen
    'qwen/qwen3-embedding-0.6b': 1024,
    'qwen/qwen3-embedding-4b': 2560,
    'qwen/qwen3-embedding-8b': 4096,
    // GTE models
    'thenlper/gte-base': 768,
    'thenlper/gte-large': 1024,
  }

  // Get vector dimension for a model
  const getVectorDimForModel = (model: string): number => {
    // Check exact match first
    if (KNOWN_EMBEDDING_MODELS[model]) return KNOWN_EMBEDDING_MODELS[model]
    
    // Check if model name contains a known model
    const lowerModel = model.toLowerCase()
    for (const [knownModel, dim] of Object.entries(KNOWN_EMBEDDING_MODELS)) {
      if (lowerModel.includes(knownModel.toLowerCase())) return dim
    }
    
    // Pattern matching fallbacks
    if (lowerModel.includes('3-large') || lowerModel.includes('large-3')) return 3072
    if (lowerModel.includes('3-small') || lowerModel.includes('small-3')) return 1536
    if (lowerModel.includes('ada-002') || lowerModel.includes('ada')) return 1536
    if (lowerModel.includes('voyage')) return 1024
    if (lowerModel.includes('cohere') || lowerModel.includes('embed-')) return 1024
    
    return 1536 // Default
  }

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings')
      const data = await res.json()
      
      // Store the actual (unmasked) API keys separately for API calls
      const actualKeysRes = await fetch('/api/settings/actual-keys')
      const actualKeys = await actualKeysRes.json()
      
      setSettings({
        ...data,
        _actualLlmApiKey: actualKeys.llmApiKey || '',
        _actualEmbedApiKey: actualKeys.embedApiKey || '',
      } as any)
      
      // Check if using custom URLs
      const knownUrls = ['https://api.openai.com/v1', 'https://openrouter.ai/api/v1', 'https://router.requesty.ai/v1']
      if (!knownUrls.includes(data.llmBaseUrl)) {
        setCustomLlmUrl(data.llmBaseUrl)
      }
      if (!knownUrls.includes(data.embedBaseUrl)) {
        setCustomEmbedUrl(data.embedBaseUrl)
      }
    } catch {
      toast('error', 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSettings()
  }, [])

  const updateSetting = (key: keyof Settings, value: string | number | boolean) => {
    if (settings) {
      setSettings({ ...settings, [key]: value })
    }
  }

  const handleSave = async () => {
    if (!settings) return

    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      const data = await res.json()

      if (data.success) {
        toast('success', 'Settings saved. Restart server to apply changes.')
      } else {
        toast('error', data.error || 'Failed to save settings')
      }
    } catch {
      toast('error', 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const resetSetupWizard = async () => {
    try {
      await fetch('/api/settings/reset-setup', { method: 'POST' })
      window.location.reload()
    } catch {
      toast('error', 'Failed to reset setup')
    }
  }

  const generateToken = async (field: 'apiKey' | 'adminToken') => {
    try {
      const res = await fetch('/api/settings/generate-token', { method: 'POST' })
      const data = await res.json()
      updateSetting(field, data.token)
      toast('success', 'New token generated')
    } catch {
      toast('error', 'Failed to generate token')
    }
  }

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text)
    setCopied(field)
    setTimeout(() => setCopied(null), 2000)
  }

  const fetchAvailableModels = async () => {
    if (!settings?.llmApiKey) {
      toast('error', 'Please enter an API key first')
      return
    }

    setFetchingModels(true)
    try {
      const baseUrl = settings.llmBaseUrl === 'custom' ? customLlmUrl : settings.llmBaseUrl
      // Use actual unmasked key if available, otherwise use the displayed value
      const actualKey = (settings as any)._actualLlmApiKey || settings.llmApiKey
      
      const res = await fetch('/api/settings/fetch-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          baseUrl,
          apiKey: actualKey
        }),
      })
      const data = await res.json()

      if (data.success && data.models) {
        setAvailableModels(data.models)
        toast('success', `Found ${data.models.length} models`)
      } else {
        toast('error', data.error || 'Failed to fetch models')
      }
    } catch (error) {
      toast('error', 'Failed to fetch models')
    } finally {
      setFetchingModels(false)
    }
  }

  const fetchAvailableEmbedModels = async () => {
    if (!settings?.embedApiKey) {
      toast('error', 'Please enter an embedding API key first')
      return
    }

    setFetchingEmbedModels(true)
    try {
      const baseUrl = settings.embedBaseUrl === 'custom' ? customEmbedUrl : settings.embedBaseUrl
      const actualKey = (settings as any)._actualEmbedApiKey || settings.embedApiKey
      
      const res = await fetch('/api/settings/fetch-embedding-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          baseUrl,
          apiKey: actualKey
        }),
      })
      const data = await res.json()

      if (data.success && data.models) {
        setAvailableEmbedModels(data.models)
        toast('success', `Found ${data.models.length} embedding models`)
      } else {
        toast('error', data.error || 'Failed to fetch embedding models')
      }
    } catch (error) {
      toast('error', 'Failed to fetch embedding models')
    } finally {
      setFetchingEmbedModels(false)
    }
  }

  // Qdrant Console functions
  const fetchQdrantInfo = async () => {
    if (!settings?.qdrantUrl) {
      toast('error', 'Qdrant URL not configured')
      return
    }
    
    setLoadingQdrant(true)
    try {
      // Fetch cluster info
      const infoRes = await fetch(`${settings.qdrantUrl}/`)
      const info = await infoRes.json()
      setQdrantInfo(info)
      
      // Fetch collections
      const collectionsRes = await fetch(`${settings.qdrantUrl}/collections`)
      const collectionsData = await collectionsRes.json()
      if (collectionsData.result?.collections) {
        setQdrantCollections(collectionsData.result.collections.map((c: any) => c.name))
      }
      
      toast('success', 'Qdrant info loaded')
    } catch (error) {
      toast('error', 'Failed to connect to Qdrant')
    } finally {
      setLoadingQdrant(false)
    }
  }

  const fetchCollectionInfo = async (collectionName: string) => {
    if (!settings?.qdrantUrl) return null
    
    try {
      const res = await fetch(`${settings.qdrantUrl}/collections/${collectionName}`)
      return await res.json()
    } catch {
      return null
    }
  }

  // API Request Console functions
  const addApiLog = (entry: Omit<ApiLogEntry, 'id' | 'timestamp'>) => {
    const newEntry: ApiLogEntry = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: new Date(),
    }
    setApiLogs(prev => [newEntry, ...prev].slice(0, 50)) // Keep last 50 entries
    setTimeout(() => {
      apiLogsRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    }, 100)
  }

  const executeApiRequest = async () => {
    setApiLoading(true)
    const startTime = Date.now()
    
    try {
      const options: RequestInit = {
        method: apiMethod,
        headers: { 'Content-Type': 'application/json' },
      }
      
      if (apiMethod !== 'GET' && apiBody) {
        try {
          options.body = JSON.stringify(JSON.parse(apiBody))
        } catch {
          options.body = apiBody
        }
      }
      
      const res = await fetch(apiEndpoint, options)
      const duration = Date.now() - startTime
      
      let responseData
      const contentType = res.headers.get('content-type')
      if (contentType?.includes('application/json')) {
        responseData = await res.json()
      } else {
        responseData = await res.text()
      }
      
      addApiLog({
        method: apiMethod,
        url: apiEndpoint,
        status: res.status,
        duration,
        request: apiMethod !== 'GET' && apiBody ? JSON.parse(apiBody) : undefined,
        response: responseData,
      })
      
      toast(res.ok ? 'success' : 'error', `${apiMethod} ${apiEndpoint} - ${res.status} (${duration}ms)`)
    } catch (error: any) {
      const duration = Date.now() - startTime
      addApiLog({
        method: apiMethod,
        url: apiEndpoint,
        duration,
        error: error.message,
      })
      toast('error', `Request failed: ${error.message}`)
    } finally {
      setApiLoading(false)
    }
  }

  const clearApiLogs = () => {
    setApiLogs([])
  }

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return

    setUploading(true)
    const formData = new FormData()
    formData.append('file', acceptedFiles[0])

    try {
      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()

      if (data.success) {
        const isZip = acceptedFiles[0].name.endsWith('.zip')
        toast('success', isZip 
          ? `ZIP extracted! ${data.filesAdded} markdown file(s) added to docs folder. Run Full Reindex to index them.`
          : `Uploaded ${data.filesAdded} file(s). Run Full Reindex in Documents page to index them.`
        )
        setUploadMode('url')
      } else {
        toast('error', data.error || 'Upload failed')
      }
    } catch (error) {
      toast('error', 'Upload failed')
    } finally {
      setUploading(false)
    }
  }, [toast])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    // Accept any file type
    maxFiles: 1,
  })

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="p-6 text-center text-slate-500">
        Failed to load settings
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
          <p className="text-slate-500">Configure your RAG chatbot</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={resetSetupWizard} title="Re-run setup wizard">
            Re-run Setup
          </Button>
          <Button variant="secondary" onClick={fetchSettings}>
            <RefreshCw size={16} />
            Reset
          </Button>
          <Button onClick={handleSave} loading={saving}>
            <Save size={16} />
            Save Changes
          </Button>
        </div>
      </div>

      {/* Project Settings */}
      <Card title="Project" description="Basic project configuration">
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Project Name"
            value={settings.projectName}
            onChange={e => updateSetting('projectName', e.target.value)}
          />
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Documentation Source</label>
            <div className="flex gap-2">
              <button
                onClick={() => setUploadMode('url')}
                className={`flex-1 px-3 py-2 rounded-lg border transition-colors ${
                  uploadMode === 'url'
                    ? 'border-primary-500 bg-primary-50 text-primary-700'
                    : 'border-slate-300 text-slate-600 hover:border-slate-400'
                }`}
              >
                URL
              </button>
              <button
                onClick={() => setUploadMode('zip')}
                className={`flex-1 px-3 py-2 rounded-lg border transition-colors ${
                  uploadMode === 'zip'
                    ? 'border-primary-500 bg-primary-50 text-primary-700'
                    : 'border-slate-300 text-slate-600 hover:border-slate-400'
                }`}
              >
                ZIP Upload
              </button>
            </div>
          </div>
          {uploadMode === 'url' ? (
            <>
              <Input
                label="Public Docs URL"
                value={settings.publicDocsBaseUrl}
                onChange={e => updateSetting('publicDocsBaseUrl', e.target.value)}
              />
              <Input
                label="Docs Path"
                value={settings.docsPath}
                onChange={e => updateSetting('docsPath', e.target.value)}
              />
            </>
          ) : (
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-2">Upload Documentation ZIP</label>
              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                  isDragActive ? 'border-primary-500 bg-primary-50' : 'border-slate-300 hover:border-slate-400'
                }`}
              >
                <input {...getInputProps()} />
                <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                {uploading ? (
                  <p className="text-slate-600 text-sm">Uploading...</p>
                ) : isDragActive ? (
                  <p className="text-primary-600 text-sm">Drop ZIP file here...</p>
                ) : (
                  <>
                    <p className="text-slate-600 text-sm mb-1">Drag & drop your documentation ZIP here, or click to select</p>
                    <p className="text-xs text-slate-400">ZIP should contain .md or .mdx files</p>
                  </>
                )}
              </div>
            </div>
          )}
          <Input
            label="File Extensions to Index"
            value={settings.docsExtensions}
            onChange={e => updateSetting('docsExtensions', e.target.value)}
            hint="Comma-separated list of file extensions to include when indexing (e.g., .md,.mdx,.txt)"
          />
        </div>
      </Card>

      {/* LLM Settings */}
      <Card title="LLM Configuration" description="Language model settings">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-2">Provider</label>
            <select
              className="w-full px-3 py-2 rounded-lg border border-slate-300"
              value={settings.llmBaseUrl === 'custom' || !['https://api.openai.com/v1', 'https://openrouter.ai/api/v1', 'https://router.requesty.ai/v1'].includes(settings.llmBaseUrl) ? 'custom' : settings.llmBaseUrl}
              onChange={e => {
                if (e.target.value === 'custom') {
                  updateSetting('llmBaseUrl', customLlmUrl || 'https://')
                } else {
                  updateSetting('llmBaseUrl', e.target.value)
                  setCustomLlmUrl('')
                }
              }}
            >
              <option value="https://api.openai.com/v1">OpenAI</option>
              <option value="https://openrouter.ai/api/v1">OpenRouter</option>
              <option value="https://router.requesty.ai/v1">Requesty.ai</option>
              <option value="custom">Custom (OpenAI-compatible)</option>
            </select>
          </div>
          {(settings.llmBaseUrl === 'custom' || !['https://api.openai.com/v1', 'https://openrouter.ai/api/v1', 'https://router.requesty.ai/v1'].includes(settings.llmBaseUrl)) && (
            <div className="col-span-2">
              <Input
                label="Custom Base URL"
                value={customLlmUrl || settings.llmBaseUrl}
                onChange={e => {
                  setCustomLlmUrl(e.target.value)
                  updateSetting('llmBaseUrl', e.target.value)
                }}
                placeholder="https://your-api.example.com/v1"
              />
            </div>
          )}
          <div className="col-span-2">
            <Input
              label="API Key"
              type={showApiKeys ? 'text' : 'password'}
              value={settings.llmApiKey}
              onChange={e => updateSetting('llmApiKey', e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                {availableModels.length > 0 ? (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Model</label>
                    <select
                      className="w-full px-3 py-2 rounded-lg border border-slate-300"
                      value={settings.llmModel}
                      onChange={e => updateSetting('llmModel', e.target.value)}
                    >
                      {availableModels.map(model => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <Input
                    label="Model"
                    value={settings.llmModel}
                    onChange={e => updateSetting('llmModel', e.target.value)}
                    placeholder="gpt-4o-mini"
                  />
                )}
              </div>
              <Button
                variant="secondary"
                onClick={fetchAvailableModels}
                loading={fetchingModels}
                disabled={!settings.llmApiKey}
              >
                <RefreshCw size={16} />
                Fetch Models
              </Button>
            </div>
          </div>
          <Input
            label="Max Tokens"
            type="number"
            value={settings.llmMaxTokens}
            onChange={e => updateSetting('llmMaxTokens', parseInt(e.target.value))}
          />
        </div>
      </Card>

      {/* Embeddings Settings */}
      <Card title="Embeddings Configuration" description="Embedding model settings (separate from LLM)">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-2">Embedding Provider</label>
            <select
              className="w-full px-3 py-2 rounded-lg border border-slate-300"
              value={settings.embedBaseUrl === 'custom' || !['https://api.openai.com/v1', 'https://openrouter.ai/api/v1', 'https://router.requesty.ai/v1'].includes(settings.embedBaseUrl) ? 'custom' : settings.embedBaseUrl}
              onChange={e => {
                if (e.target.value === 'custom') {
                  updateSetting('embedBaseUrl', customEmbedUrl || 'https://')
                } else {
                  updateSetting('embedBaseUrl', e.target.value)
                  setCustomEmbedUrl('')
                }
              }}
            >
              <option value="https://api.openai.com/v1">OpenAI</option>
              <option value="https://openrouter.ai/api/v1">OpenRouter</option>
              <option value="https://router.requesty.ai/v1">Requesty.ai</option>
              <option value="custom">Custom (OpenAI-compatible)</option>
            </select>
          </div>
          {(settings.embedBaseUrl === 'custom' || !['https://api.openai.com/v1', 'https://openrouter.ai/api/v1', 'https://router.requesty.ai/v1'].includes(settings.embedBaseUrl)) && (
            <div className="col-span-2">
              <Input
                label="Custom Base URL"
                value={customEmbedUrl || settings.embedBaseUrl}
                onChange={e => {
                  setCustomEmbedUrl(e.target.value)
                  updateSetting('embedBaseUrl', e.target.value)
                }}
                placeholder="https://your-api.example.com/v1"
              />
            </div>
          )}
          <div className="col-span-2">
            <Input
              label="API Key"
              type={showApiKeys ? 'text' : 'password'}
              value={settings.embedApiKey}
              onChange={e => updateSetting('embedApiKey', e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                {availableEmbedModels.length > 0 ? (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Embedding Model</label>
                    <select
                      className="w-full px-3 py-2 rounded-lg border border-slate-300"
                      value={settings.embedModel || ''}
                      onChange={e => {
                        const model = e.target.value
                        // Find dimensions from fetched models or use lookup
                        const modelInfo = availableEmbedModels.find(m => m.id === model)
                        const dimensions = modelInfo?.dimensions || getVectorDimForModel(model)
                        // Update both model and dimensions in a single state update
                        setSettings(prev => prev ? { ...prev, embedModel: model, vectorDim: dimensions } : prev)
                      }}
                    >
                      <option value="">Select an embedding model...</option>
                      {availableEmbedModels.map(model => (
                        <option key={model.id} value={model.id}>
                          {model.id} {model.dimensions ? `(${model.dimensions} dims)` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <Input
                    label="Embedding Model"
                    value={settings.embedModel || ''}
                    onChange={e => updateSetting('embedModel', e.target.value)}
                    onBlur={e => {
                      const model = e.target.value
                      if (model) {
                        updateSetting('vectorDim', getVectorDimForModel(model))
                      }
                    }}
                    placeholder="openai/text-embedding-3-small"
                    hint="Click 'Fetch Models' to see available options, or type a model name"
                  />
                )}
              </div>
              <Button
                variant="secondary"
                onClick={fetchAvailableEmbedModels}
                loading={fetchingEmbedModels}
                disabled={!settings.embedApiKey}
              >
                <RefreshCw size={16} />
                Fetch Models
              </Button>
            </div>
          </div>
          <div className="col-span-2 bg-slate-50 p-3 rounded-lg">
            <p className="text-sm text-slate-600">
              <strong>Vector Dimensions:</strong> {settings.vectorDim}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Auto-detected from embedding model. Change below if using a custom model with different dimensions.
            </p>
          </div>
          <Input
            label="Vector Dimensions (advanced)"
            type="number"
            value={settings.vectorDim}
            onChange={e => updateSetting('vectorDim', parseInt(e.target.value))}
            hint="Only change if your embedding model uses different dimensions"
          />
        </div>
      </Card>

      {/* Vector DB Settings */}
      <Card title="Vector Database" description="Qdrant configuration">
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Qdrant URL"
            value={settings.qdrantUrl}
            onChange={e => updateSetting('qdrantUrl', e.target.value)}
          />
          <Input
            label="Collection Name"
            value={settings.qdrantCollection}
            onChange={e => updateSetting('qdrantCollection', e.target.value)}
          />
        </div>
      </Card>

      {/* Qdrant Console */}
      <Card title="Qdrant Console" description="View and manage your Qdrant vector database">
        <div className="space-y-4">
          <div className="flex gap-2 items-center">
            <Button
              variant="secondary"
              onClick={fetchQdrantInfo}
              loading={loadingQdrant}
            >
              <Database size={16} />
              Connect to Qdrant
            </Button>
            <a
              href={settings.qdrantUrl ? `${settings.qdrantUrl}/dashboard` : '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
            >
              <ExternalLink size={14} />
              Open Qdrant Dashboard
            </a>
          </div>

          {qdrantInfo && (
            <div className="bg-slate-50 p-4 rounded-lg space-y-3">
              <div>
                <h4 className="text-sm font-medium text-slate-700 mb-2">Cluster Info</h4>
                <pre className="text-xs bg-slate-900 text-green-400 p-3 rounded overflow-x-auto">
                  {JSON.stringify(qdrantInfo, null, 2)}
                </pre>
              </div>

              {qdrantCollections.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-slate-700 mb-2">Collections ({qdrantCollections.length})</h4>
                  <div className="flex flex-wrap gap-2">
                    {qdrantCollections.map(col => (
                      <span
                        key={col}
                        className={`px-3 py-1 rounded-full text-sm ${
                          col === settings.qdrantCollection
                            ? 'bg-primary-100 text-primary-700 font-medium'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {col}
                        {col === settings.qdrantCollection && ' (active)'}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* API Request Console */}
      <Card title="API Request Console" description="Test API endpoints and view request logs">
        <div className="space-y-4">
          <div className="flex gap-2 items-end">
            <div className="w-28">
              <label className="block text-sm font-medium text-slate-700 mb-2">Method</label>
              <select
                className="w-full px-3 py-2 rounded-lg border border-slate-300"
                value={apiMethod}
                onChange={e => setApiMethod(e.target.value as any)}
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="DELETE">DELETE</option>
              </select>
            </div>
            <div className="flex-1">
              <Input
                label="Endpoint"
                value={apiEndpoint}
                onChange={e => setApiEndpoint(e.target.value)}
                placeholder="/api/health"
              />
            </div>
            <Button onClick={executeApiRequest} loading={apiLoading}>
              <Send size={16} />
              Send
            </Button>
          </div>

          {(apiMethod === 'POST' || apiMethod === 'PUT') && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Request Body (JSON)</label>
              <textarea
                className="w-full px-3 py-2 border border-slate-300 rounded-lg h-24 font-mono text-sm"
                value={apiBody}
                onChange={e => setApiBody(e.target.value)}
                placeholder='{"key": "value"}'
              />
            </div>
          )}

          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-slate-700">Request Log</h4>
            <Button variant="ghost" size="sm" onClick={clearApiLogs} disabled={apiLogs.length === 0}>
              <Trash2 size={14} />
              Clear
            </Button>
          </div>

          <div
            ref={apiLogsRef}
            className="bg-slate-900 rounded-lg p-3 h-64 overflow-y-auto space-y-2"
          >
            {apiLogs.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-8">No requests yet. Send a request to see logs.</p>
            ) : (
              apiLogs.map(log => (
                <div key={log.id} className="border-b border-slate-700 pb-2 last:border-0">
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`font-mono font-bold ${
                      log.method === 'GET' ? 'text-green-400' :
                      log.method === 'POST' ? 'text-blue-400' :
                      log.method === 'PUT' ? 'text-yellow-400' :
                      'text-red-400'
                    }`}>
                      {log.method}
                    </span>
                    <span className="text-slate-300 font-mono">{log.url}</span>
                    {log.status && (
                      <span className={`px-1.5 py-0.5 rounded text-xs ${
                        log.status < 300 ? 'bg-green-900 text-green-300' :
                        log.status < 400 ? 'bg-yellow-900 text-yellow-300' :
                        'bg-red-900 text-red-300'
                      }`}>
                        {log.status}
                      </span>
                    )}
                    {log.duration && (
                      <span className="text-slate-500">{log.duration}ms</span>
                    )}
                    <span className="text-slate-600 ml-auto">
                      {log.timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                  {log.error && (
                    <pre className="text-red-400 text-xs mt-1 font-mono">{log.error}</pre>
                  )}
                  {log.response && (
                    <details className="mt-1">
                      <summary className="text-slate-400 text-xs cursor-pointer hover:text-slate-300">
                        Response
                      </summary>
                      <pre className="text-green-400 text-xs mt-1 font-mono overflow-x-auto max-h-32 overflow-y-auto">
                        {typeof log.response === 'string' ? log.response : JSON.stringify(log.response, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="text-xs text-slate-500">
            <strong>Quick endpoints:</strong>{' '}
            <button onClick={() => setApiEndpoint('/api/health')} className="text-primary-600 hover:underline">/api/health</button>{' · '}
            <button onClick={() => setApiEndpoint('/api/settings')} className="text-primary-600 hover:underline">/api/settings</button>{' · '}
            <button onClick={() => setApiEndpoint('/api/documents')} className="text-primary-600 hover:underline">/api/documents</button>{' · '}
            <button onClick={() => setApiEndpoint('/api/documents/stats')} className="text-primary-600 hover:underline">/api/documents/stats</button>
          </div>
        </div>
      </Card>

      {/* RAG Settings */}
      <Card title="RAG Configuration" description="Retrieval and chunking settings">
        <div className="grid grid-cols-3 gap-4">
          <Input
            label="Max Context Tokens"
            type="number"
            value={settings.maxContextTokens}
            onChange={e => updateSetting('maxContextTokens', parseInt(e.target.value))}
          />
          <Input
            label="Retrieval Top K"
            type="number"
            value={settings.retrievalTopK}
            onChange={e => updateSetting('retrievalTopK', parseInt(e.target.value))}
          />
          <div></div>
          <Input
            label="Chunk Max Tokens"
            type="number"
            value={settings.chunkMaxTokens}
            onChange={e => updateSetting('chunkMaxTokens', parseInt(e.target.value))}
            hint="Soft limit for chunking (default: 800)"
          />
          <Input
            label="Chunk Overlap Tokens"
            type="number"
            value={settings.chunkOverlapTokens}
            onChange={e => updateSetting('chunkOverlapTokens', parseInt(e.target.value))}
            hint="Token overlap between chunks (default: 120)"
          />
          <Input
            label="Absolute Max Tokens"
            type="number"
            value={settings.absoluteMaxTokens}
            onChange={e => updateSetting('absoluteMaxTokens', parseInt(e.target.value))}
            hint="Hard limit - never exceed (default: 1024)"
          />
        </div>
        
        <div className="mt-4 pt-4 border-t border-slate-200">
          <h4 className="text-sm font-medium text-slate-700 mb-3">Pipeline Threading</h4>
          <div className="grid grid-cols-3 gap-4">
            <Input
              label="Embedding Threads"
              type="number"
              value={settings.embeddingThreads}
              onChange={e => updateSetting('embeddingThreads', parseInt(e.target.value))}
              hint="Concurrent embedding workers (default: 4)"
            />
            <Input
              label="Upsert Threads"
              type="number"
              value={settings.upsertThreads}
              onChange={e => updateSetting('upsertThreads', parseInt(e.target.value))}
              hint="Concurrent upsert workers (default: 2)"
            />
            <div className="flex items-center gap-2 pt-6">
              <input
                type="checkbox"
                id="failFastValidation"
                checked={settings.failFastValidation}
                onChange={e => updateSetting('failFastValidation', e.target.checked)}
                className="rounded border-slate-300"
              />
              <label htmlFor="failFastValidation" className="text-sm text-slate-700">
                Fail-fast validation
              </label>
            </div>
          </div>
        </div>
        
        <div className="mt-4 p-3 bg-slate-50 rounded-lg">
          <p className="text-xs text-slate-600">
            <strong>Note:</strong> Chunks are created respecting Markdown structure - headings are preserved and code blocks are never split.
            Each chunk is embedded individually (one API call per chunk) for maximum reliability.
            The pipeline is resumable - if interrupted, it will continue from the last successful chunk.
          </p>
        </div>
      </Card>

      {/* Security */}
      <Card title="Security" description="API keys and tokens">
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowApiKeys(!showApiKeys)}
            >
              {showApiKeys ? <EyeOff size={16} /> : <Eye size={16} />}
              {showApiKeys ? 'Hide' : 'Show'} Keys
            </Button>
          </div>

          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Input
                label="API Key (for chat endpoint)"
                type={showApiKeys ? 'text' : 'password'}
                value={settings.apiKey}
                onChange={e => updateSetting('apiKey', e.target.value)}
              />
            </div>
            <Button variant="secondary" onClick={() => generateToken('apiKey')}>
              Generate
            </Button>
            <Button
              variant="ghost"
              onClick={() => copyToClipboard(settings.apiKey, 'apiKey')}
            >
              {copied === 'apiKey' ? <Check size={16} /> : <Copy size={16} />}
            </Button>
          </div>

          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Input
                label="Admin Token (for reindex endpoint)"
                type={showApiKeys ? 'text' : 'password'}
                value={settings.adminToken}
                onChange={e => updateSetting('adminToken', e.target.value)}
              />
            </div>
            <Button variant="secondary" onClick={() => generateToken('adminToken')}>
              Generate
            </Button>
            <Button
              variant="ghost"
              onClick={() => copyToClipboard(settings.adminToken, 'adminToken')}
            >
              {copied === 'adminToken' ? <Check size={16} /> : <Copy size={16} />}
            </Button>
          </div>
        </div>
      </Card>

      {/* Custom Prompt */}
      <Card title="Custom System Prompt" description="Override the default AI prompt (optional)">
        <textarea
          className="w-full px-3 py-2 border border-slate-300 rounded-lg h-32"
          value={settings.customSystemPrompt}
          onChange={e => updateSetting('customSystemPrompt', e.target.value)}
          placeholder="Use {PROJECT_NAME} and {CONTEXT} as placeholders..."
        />
      </Card>

      {/* Discord Bot */}
      <Card title="Discord Bot" description="Configure Discord bot integration">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="discordBotEnabled"
              checked={settings.discordBotEnabled}
              onChange={e => updateSetting('discordBotEnabled', e.target.checked)}
              className="rounded"
            />
            <label htmlFor="discordBotEnabled" className="text-sm font-medium text-slate-700">
              Enable Discord Bot
            </label>
          </div>

          {settings.discordBotEnabled && (
            <>
              <div className="bg-blue-50 p-4 rounded-lg text-sm text-blue-800">
                <Bot size={16} className="inline mr-2" />
                <strong>Setup:</strong> Create a Discord app at{' '}
                <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer" className="underline">
                  Discord Developer Portal
                </a>
                . Enable "Message Content Intent" in Bot settings.
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Input
                    label="Bot Token"
                    type={showApiKeys ? 'text' : 'password'}
                    value={settings.discordBotToken}
                    onChange={e => updateSetting('discordBotToken', e.target.value)}
                  />
                </div>
                <Input
                  label="Client ID"
                  value={settings.discordClientId}
                  onChange={e => updateSetting('discordClientId', e.target.value)}
                />
                <Input
                  label="Guild ID (optional, for testing)"
                  value={settings.discordGuildId}
                  onChange={e => updateSetting('discordGuildId', e.target.value)}
                />
                <Input
                  label="Bot Name"
                  value={settings.discordBotName}
                  onChange={e => updateSetting('discordBotName', e.target.value)}
                />
                <Input
                  label="Command Prefix"
                  value={settings.discordCommandPrefix}
                  onChange={e => updateSetting('discordCommandPrefix', e.target.value)}
                />
                <Input
                  label="Embed Color (hex)"
                  value={settings.discordEmbedColor}
                  onChange={e => updateSetting('discordEmbedColor', e.target.value)}
                />
                <Input
                  label="Cooldown (seconds)"
                  type="number"
                  value={settings.discordCooldownSeconds}
                  onChange={e => updateSetting('discordCooldownSeconds', parseInt(e.target.value))}
                />
              </div>

              <div className="bg-slate-50 p-4 rounded-lg text-sm">
                <strong>After saving:</strong> Run the Discord bot from the <code>discord-bot</code> directory:
                <code className="block mt-2 p-2 bg-slate-900 text-green-400 rounded">
                  cd discord-bot && npm install && npm run register && npm run dev
                </code>
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  )
}
