import { useState, useEffect, useCallback } from 'react'
import { Save, RefreshCw, Eye, EyeOff, Copy, Check, Bot, Upload } from 'lucide-react'
import { useDropzone } from 'react-dropzone'
import Button from '@/components/Button'
import Card from '@/components/Card'
import Input from '@/components/Input'
import { useToast } from '@/components/Toast'

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
  const [availableEmbedModels, setAvailableEmbedModels] = useState<string[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)
  const [fetchingEmbedModels, setFetchingEmbedModels] = useState(false)
  const { toast } = useToast()

  // Known embedding models with their dimensions
  const KNOWN_EMBEDDING_MODELS: Record<string, number> = {
    'text-embedding-3-small': 1536,
    'text-embedding-3-large': 3072,
    'text-embedding-ada-002': 1536,
    'openai/text-embedding-3-small': 1536,
    'openai/text-embedding-3-large': 3072,
    'openai/text-embedding-ada-002': 1536,
  }

  // Get vector dimension for a model
  const getVectorDimForModel = (model: string): number => {
    if (KNOWN_EMBEDDING_MODELS[model]) return KNOWN_EMBEDDING_MODELS[model]
    if (model.includes('3-large') || model.includes('large-3')) return 3072
    if (model.includes('3-small') || model.includes('small-3')) return 1536
    if (model.includes('ada-002') || model.includes('ada')) return 1536
    return 1536
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
        // Filter for embedding models (usually contain 'embedding' in name)
        const embedModels = data.models.filter((m: string) => 
          m.includes('embedding') || m.includes('embed')
        )
        if (embedModels.length > 0) {
          setAvailableEmbedModels(embedModels)
          toast('success', `Found ${embedModels.length} embedding models`)
        } else {
          setAvailableEmbedModels(data.models)
          toast('success', `Found ${data.models.length} models`)
        }
      } else {
        toast('error', data.error || 'Failed to fetch models')
      }
    } catch (error) {
      toast('error', 'Failed to fetch models')
    } finally {
      setFetchingEmbedModels(false)
    }
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
        toast('success', `Uploaded ${data.filesAdded} file(s). Run Full Reindex in Documents page to index them.`)
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
    accept: {
      'application/zip': ['.zip'],
    },
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
            label="File Extensions"
            value={settings.docsExtensions}
            onChange={e => updateSetting('docsExtensions', e.target.value)}
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
                      value={settings.embedModel}
                      onChange={e => {
                        const model = e.target.value
                        updateSetting('embedModel', model)
                        updateSetting('vectorDim', getVectorDimForModel(model))
                      }}
                    >
                      {availableEmbedModels.map(model => (
                        <option key={model} value={model}>
                          {model} ({getVectorDimForModel(model)} dims)
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Embedding Model</label>
                    <select
                      className="w-full px-3 py-2 rounded-lg border border-slate-300"
                      value={settings.embedModel}
                      onChange={e => {
                        const model = e.target.value
                        updateSetting('embedModel', model)
                        updateSetting('vectorDim', getVectorDimForModel(model))
                      }}
                    >
                      <option value="text-embedding-3-small">text-embedding-3-small (1536 dims)</option>
                      <option value="text-embedding-3-large">text-embedding-3-large (3072 dims)</option>
                      <option value="text-embedding-ada-002">text-embedding-ada-002 (1536 dims)</option>
                    </select>
                  </div>
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
              Auto-detected from embedding model. Change only if using a custom model with different dimensions.
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
          <Input
            label="Chunk Target Tokens"
            type="number"
            value={settings.chunkTargetTokens}
            onChange={e => updateSetting('chunkTargetTokens', parseInt(e.target.value))}
          />
          <Input
            label="Chunk Max Tokens"
            type="number"
            value={settings.chunkMaxTokens}
            onChange={e => updateSetting('chunkMaxTokens', parseInt(e.target.value))}
          />
          <Input
            label="Chunk Overlap Tokens"
            type="number"
            value={settings.chunkOverlapTokens}
            onChange={e => updateSetting('chunkOverlapTokens', parseInt(e.target.value))}
          />
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
