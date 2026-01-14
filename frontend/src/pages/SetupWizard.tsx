import { useState, useCallback } from 'react'
import { CheckCircle, ArrowRight, ArrowLeft, Key, Database, FileText, Sparkles, Bot, Upload } from 'lucide-react'
import { useDropzone } from 'react-dropzone'
import Button from '@/components/Button'
import Input from '@/components/Input'
import Card from '@/components/Card'
import { cn } from '@/lib/utils'

interface SetupWizardProps {
  onComplete: () => void
}

const steps = [
  { id: 'project', title: 'Project', icon: FileText },
  { id: 'llm', title: 'LLM', icon: Sparkles },
  { id: 'embeddings', title: 'Embeddings', icon: Key },
  { id: 'vector', title: 'Vector DB', icon: Database },
  { id: 'discord', title: 'Discord', icon: Bot },
]

export default function SetupWizard({ onComplete }: SetupWizardProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [uploadMode, setUploadMode] = useState<'url' | 'zip'>('url')
  const [uploading, setUploading] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([])
  const [customLlmUrl, setCustomLlmUrl] = useState('')
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)
  const [config, setConfig] = useState({
    projectName: 'My Documentation',
    publicDocsBaseUrl: 'https://docs.example.com',
    docsPath: './docs',
    llmBaseUrl: 'https://api.openai.com/v1',
    llmApiKey: '',
    llmModel: 'gpt-4o-mini',
    embedBaseUrl: 'https://api.openai.com/v1',
    embedApiKey: '',
    embedModel: 'text-embedding-3-small',
    vectorDim: 1536,
    qdrantUrl: 'http://localhost:6333',
    qdrantCollection: 'docs',
    // Discord Bot
    discordBotEnabled: false,
    discordBotToken: '',
    discordClientId: '',
    discordGuildId: '',
    discordBotName: 'Docs Bot',
    discordCommandPrefix: '!docs',
    discordEmbedColor: '0x7c3aed',
    discordCooldownSeconds: 5,
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [testResults, setTestResults] = useState<Record<string, boolean | null>>({})

  // ZIP file upload handler
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
        setUploadedFiles(data.files || [])
      } else {
        setErrors(prev => ({ ...prev, upload: data.error || 'Upload failed' }))
      }
    } catch (error) {
      setErrors(prev => ({ ...prev, upload: 'Upload failed' }))
    } finally {
      setUploading(false)
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/zip': ['.zip'],
    },
    maxFiles: 1,
  })

  const updateConfig = (key: string, value: string | number | boolean) => {
    setConfig(prev => ({ ...prev, [key]: value }))
    setErrors(prev => ({ ...prev, [key]: '' }))
  }

  const testApiKey = async (type: 'llm' | 'embed') => {
    const baseUrl = type === 'llm' ? config.llmBaseUrl : config.embedBaseUrl
    const apiKey = type === 'llm' ? config.llmApiKey : config.embedApiKey
    
    try {
      const res = await fetch('/api/settings/test-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl, apiKey, type }),
      })
      const data = await res.json()
      setTestResults(prev => ({ ...prev, [type]: data.valid }))
    } catch {
      setTestResults(prev => ({ ...prev, [type]: false }))
    }
  }

  const testQdrant = async () => {
    try {
      const res = await fetch(`${config.qdrantUrl}/collections`)
      setTestResults(prev => ({ ...prev, qdrant: res.ok }))
    } catch {
      setTestResults(prev => ({ ...prev, qdrant: false }))
    }
  }

  const fetchAvailableModels = async () => {
    if (!config.llmApiKey) {
      return
    }

    setFetchingModels(true)
    try {
      const baseUrl = config.llmBaseUrl === 'custom' ? customLlmUrl : config.llmBaseUrl
      const res = await fetch('/api/settings/fetch-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          baseUrl,
          apiKey: config.llmApiKey 
        }),
      })
      const data = await res.json()

      if (data.success && data.models) {
        setAvailableModels(data.models)
        if (data.models.length > 0) {
          updateConfig('llmModel', data.models[0])
        }
      }
    } catch (error) {
      // Silently fail
    } finally {
      setFetchingModels(false)
    }
  }

  const generateToken = async (field: string) => {
    const res = await fetch('/api/settings/generate-token', { method: 'POST' })
    const data = await res.json()
    updateConfig(field, data.token)
  }

  const validateStep = () => {
    const newErrors: Record<string, string> = {}
    
    if (currentStep === 0) {
      if (!config.projectName) newErrors.projectName = 'Required'
    } else if (currentStep === 1) {
      if (!config.llmApiKey) newErrors.llmApiKey = 'Required'
    } else if (currentStep === 2) {
      if (!config.embedApiKey) newErrors.embedApiKey = 'Required'
    } else if (currentStep === 4 && config.discordBotEnabled) {
      if (!config.discordBotToken) newErrors.discordBotToken = 'Required'
      if (!config.discordClientId) newErrors.discordClientId = 'Required'
    }
    
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const nextStep = () => {
    if (validateStep()) {
      if (currentStep < steps.length - 1) {
        setCurrentStep(prev => prev + 1)
      }
    }
  }

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1)
    }
  }

  const handleSubmit = async () => {
    if (!validateStep()) return
    
    setLoading(true)
    try {
      // Generate security tokens
      const apiKeyRes = await fetch('/api/settings/generate-token', { method: 'POST' })
      const apiKeyData = await apiKeyRes.json()
      
      const adminTokenRes = await fetch('/api/settings/generate-token', { method: 'POST' })
      const adminTokenData = await adminTokenRes.json()
      
      // Save settings
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          apiKey: apiKeyData.token,
          adminToken: adminTokenData.token,
        }),
      })
      
      if (res.ok) {
        // Mark setup as complete
        await fetch('/api/settings/complete-setup', { method: 'POST' })
        onComplete()
      }
    } catch (error) {
      console.error('Setup failed:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary-600 rounded-2xl flex items-center justify-center text-white text-2xl font-bold mx-auto mb-4">
            R
          </div>
          <h1 className="text-3xl font-bold text-slate-900">Welcome to Ragussy</h1>
          <p className="text-slate-600 mt-2">Let's set up your RAG chatbot in a few steps</p>
        </div>

        {/* Progress */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-center">
              <div
                className={cn(
                  'w-10 h-10 rounded-full flex items-center justify-center transition-colors',
                  index < currentStep
                    ? 'bg-green-500 text-white'
                    : index === currentStep
                    ? 'bg-primary-600 text-white'
                    : 'bg-slate-200 text-slate-500'
                )}
              >
                {index < currentStep ? (
                  <CheckCircle size={20} />
                ) : (
                  <step.icon size={20} />
                )}
              </div>
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    'w-12 h-1 mx-1',
                    index < currentStep ? 'bg-green-500' : 'bg-slate-200'
                  )}
                />
              )}
            </div>
          ))}
        </div>

        <Card className="mb-6">
          <h2 className="text-xl font-semibold mb-6">{steps[currentStep].title} Configuration</h2>

          {currentStep === 0 && (
            <div className="space-y-4">
              <Input
                label="Project Name"
                value={config.projectName}
                onChange={e => updateConfig('projectName', e.target.value)}
                error={errors.projectName}
                placeholder="My Documentation"
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
                    value={config.publicDocsBaseUrl}
                    onChange={e => updateConfig('publicDocsBaseUrl', e.target.value)}
                    placeholder="https://docs.example.com"
                    hint="Where your documentation is hosted (for source links)"
                  />
                  <Input
                    label="Docs Path"
                    value={config.docsPath}
                    onChange={e => updateConfig('docsPath', e.target.value)}
                    placeholder="./docs"
                    hint="Local path to your markdown documentation"
                  />
                </>
              ) : (
                <div className="space-y-4">
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
                  {errors.upload && (
                    <p className="text-red-600 text-sm">{errors.upload}</p>
                  )}
                  {uploadedFiles.length > 0 && (
                    <div className="bg-green-50 border border-green-200 p-4 rounded-lg">
                      <p className="text-green-800 font-medium mb-2">✓ Uploaded {uploadedFiles.length} file(s)</p>
                      <ul className="text-sm text-green-700 max-h-32 overflow-y-auto">
                        {uploadedFiles.slice(0, 10).map((file, i) => (
                          <li key={i} className="truncate">• {file}</li>
                        ))}
                        {uploadedFiles.length > 10 && (
                          <li className="text-green-600">...and {uploadedFiles.length - 10} more</li>
                        )}
                      </ul>
                    </div>
                  )}
                  <Input
                    label="Docs Path (where files will be stored)"
                    value={config.docsPath}
                    onChange={e => updateConfig('docsPath', e.target.value)}
                    placeholder="./docs"
                    hint="Local path where documentation will be stored"
                  />
                </div>
              )}
            </div>
          )}

          {currentStep === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">LLM Provider</label>
                <select
                  className="w-full px-3 py-2 rounded-lg border border-slate-300"
                  value={config.llmBaseUrl === 'custom' || !['https://api.openai.com/v1', 'https://openrouter.ai/api/v1', 'https://router.requesty.ai/v1'].includes(config.llmBaseUrl) ? 'custom' : config.llmBaseUrl}
                  onChange={e => {
                    if (e.target.value === 'custom') {
                      updateConfig('llmBaseUrl', customLlmUrl || 'https://')
                    } else {
                      updateConfig('llmBaseUrl', e.target.value)
                      setCustomLlmUrl('')
                      if (e.target.value.includes('openrouter')) {
                        updateConfig('llmModel', 'openai/gpt-4o-mini')
                      } else if (e.target.value.includes('requesty')) {
                        updateConfig('llmModel', 'gpt-4o-mini')
                      } else {
                        updateConfig('llmModel', 'gpt-4o-mini')
                      }
                    }
                  }}
                >
                  <option value="https://api.openai.com/v1">OpenAI</option>
                  <option value="https://openrouter.ai/api/v1">OpenRouter</option>
                  <option value="https://router.requesty.ai/v1">Requesty.ai</option>
                  <option value="custom">Custom (OpenAI-compatible)</option>
                </select>
              </div>
              {(config.llmBaseUrl === 'custom' || !['https://api.openai.com/v1', 'https://openrouter.ai/api/v1', 'https://router.requesty.ai/v1'].includes(config.llmBaseUrl)) && (
                <Input
                  label="Custom Base URL"
                  value={customLlmUrl || config.llmBaseUrl}
                  onChange={e => {
                    setCustomLlmUrl(e.target.value)
                    updateConfig('llmBaseUrl', e.target.value)
                  }}
                  placeholder="https://your-api.example.com/v1"
                />
              )}
              <div className="flex gap-2">
                <div className="flex-1">
                  <Input
                    label="API Key"
                    type="password"
                    value={config.llmApiKey}
                    onChange={e => updateConfig('llmApiKey', e.target.value)}
                    error={errors.llmApiKey}
                    placeholder="sk-..."
                  />
                </div>
                <div className="pt-7">
                  <Button
                    variant="secondary"
                    onClick={() => testApiKey('llm')}
                    disabled={!config.llmApiKey}
                  >
                    Test
                  </Button>
                </div>
              </div>
              {testResults.llm !== undefined && (
                <p className={testResults.llm ? 'text-green-600' : 'text-red-600'}>
                  {testResults.llm ? '✓ API key is valid' : '✗ API key is invalid'}
                </p>
              )}
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  {availableModels.length > 0 ? (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Model</label>
                      <select
                        className="w-full px-3 py-2 rounded-lg border border-slate-300"
                        value={config.llmModel}
                        onChange={e => updateConfig('llmModel', e.target.value)}
                      >
                        {availableModels.map(model => (
                          <option key={model} value={model}>{model}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <Input
                      label="Model"
                      value={config.llmModel}
                      onChange={e => updateConfig('llmModel', e.target.value)}
                      placeholder="gpt-4o-mini"
                    />
                  )}
                </div>
                <Button
                  variant="secondary"
                  onClick={fetchAvailableModels}
                  loading={fetchingModels}
                  disabled={!config.llmApiKey}
                >
                  Fetch Models
                </Button>
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <input
                  type="checkbox"
                  id="sameAsLlm"
                  checked={config.embedBaseUrl === config.llmBaseUrl && config.embedApiKey === config.llmApiKey}
                  onChange={e => {
                    if (e.target.checked) {
                      updateConfig('embedBaseUrl', config.llmBaseUrl)
                      updateConfig('embedApiKey', config.llmApiKey)
                    }
                  }}
                  className="rounded"
                />
                <label htmlFor="sameAsLlm" className="text-sm text-slate-600">
                  Use same provider as LLM
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Embeddings Provider</label>
                <select
                  className="w-full px-3 py-2 rounded-lg border border-slate-300"
                  value={!['https://api.openai.com/v1', 'https://openrouter.ai/api/v1', 'https://router.requesty.ai/v1'].includes(config.embedBaseUrl) ? 'custom' : config.embedBaseUrl}
                  onChange={e => {
                    if (e.target.value === 'custom') {
                      updateConfig('embedBaseUrl', 'https://')
                    } else {
                      updateConfig('embedBaseUrl', e.target.value)
                    }
                  }}
                >
                  <option value="https://api.openai.com/v1">OpenAI</option>
                  <option value="https://openrouter.ai/api/v1">OpenRouter</option>
                  <option value="https://router.requesty.ai/v1">Requesty.ai</option>
                  <option value="custom">Custom (OpenAI-compatible)</option>
                </select>
              </div>
              {!['https://api.openai.com/v1', 'https://openrouter.ai/api/v1', 'https://router.requesty.ai/v1'].includes(config.embedBaseUrl) && (
                <Input
                  label="Custom Base URL"
                  value={config.embedBaseUrl}
                  onChange={e => updateConfig('embedBaseUrl', e.target.value)}
                  placeholder="https://your-api.example.com/v1"
                />
              )}
              <div className="flex gap-2">
                <div className="flex-1">
                  <Input
                    label="Embeddings API Key"
                    type="password"
                    value={config.embedApiKey}
                    onChange={e => updateConfig('embedApiKey', e.target.value)}
                    error={errors.embedApiKey}
                    placeholder="sk-..."
                  />
                </div>
                <div className="pt-7">
                  <Button
                    variant="secondary"
                    onClick={() => testApiKey('embed')}
                    disabled={!config.embedApiKey}
                  >
                    Test
                  </Button>
                </div>
              </div>
              {testResults.embed !== undefined && (
                <p className={testResults.embed ? 'text-green-600' : 'text-red-600'}>
                  {testResults.embed ? '✓ API key is valid' : '✗ API key is invalid'}
                </p>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Embedding Model</label>
                <select
                  className="w-full px-3 py-2 rounded-lg border border-slate-300"
                  value={config.embedModel}
                  onChange={e => {
                    updateConfig('embedModel', e.target.value)
                    updateConfig('vectorDim', e.target.value === 'text-embedding-3-large' ? 3072 : 1536)
                  }}
                >
                  <option value="text-embedding-3-small">text-embedding-3-small (1536 dims)</option>
                  <option value="text-embedding-3-large">text-embedding-3-large (3072 dims)</option>
                  <option value="text-embedding-ada-002">text-embedding-ada-002 (1536 dims)</option>
                </select>
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <div className="flex-1">
                  <Input
                    label="Qdrant URL"
                    value={config.qdrantUrl}
                    onChange={e => updateConfig('qdrantUrl', e.target.value)}
                    placeholder="http://localhost:6333"
                  />
                </div>
                <div className="pt-7">
                  <Button variant="secondary" onClick={testQdrant}>
                    Test
                  </Button>
                </div>
              </div>
              {testResults.qdrant !== undefined && (
                <p className={testResults.qdrant ? 'text-green-600' : 'text-red-600'}>
                  {testResults.qdrant ? '✓ Connected to Qdrant' : '✗ Cannot connect to Qdrant'}
                </p>
              )}
              <Input
                label="Collection Name"
                value={config.qdrantCollection}
                onChange={e => updateConfig('qdrantCollection', e.target.value)}
                placeholder="docs"
              />
              <div className="bg-slate-50 p-4 rounded-lg">
                <p className="text-sm text-slate-600">
                  <strong>Need Qdrant?</strong> Run this command:
                </p>
                <code className="block mt-2 p-2 bg-slate-900 text-green-400 rounded text-sm">
                  docker run -p 6333:6333 qdrant/qdrant
                </code>
              </div>
            </div>
          )}

          {currentStep === 4 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="discordBotEnabled"
                  checked={config.discordBotEnabled}
                  onChange={e => updateConfig('discordBotEnabled', e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="discordBotEnabled" className="text-sm font-medium text-slate-700">
                  Enable Discord Bot
                </label>
              </div>

              {config.discordBotEnabled ? (
                <>
                  <div className="bg-blue-50 p-4 rounded-lg text-sm text-blue-800">
                    <Bot size={16} className="inline mr-2" />
                    Create a Discord app at{' '}
                    <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer" className="underline">
                      Discord Developer Portal
                    </a>
                    . Enable "Message Content Intent" in Bot settings.
                  </div>

                  <Input
                    label="Bot Token"
                    type="password"
                    value={config.discordBotToken}
                    onChange={e => updateConfig('discordBotToken', e.target.value)}
                    error={errors.discordBotToken}
                  />
                  <Input
                    label="Client ID"
                    value={config.discordClientId}
                    onChange={e => updateConfig('discordClientId', e.target.value)}
                    error={errors.discordClientId}
                  />
                  <Input
                    label="Guild ID (optional, for faster testing)"
                    value={config.discordGuildId}
                    onChange={e => updateConfig('discordGuildId', e.target.value)}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <Input
                      label="Bot Name"
                      value={config.discordBotName}
                      onChange={e => updateConfig('discordBotName', e.target.value)}
                    />
                    <Input
                      label="Command Prefix"
                      value={config.discordCommandPrefix}
                      onChange={e => updateConfig('discordCommandPrefix', e.target.value)}
                    />
                  </div>
                </>
              ) : (
                <div className="bg-slate-50 p-4 rounded-lg text-sm text-slate-600">
                  You can configure the Discord bot later in Settings.
                </div>
              )}
            </div>
          )}
        </Card>

        <div className="flex justify-between">
          <Button variant="ghost" onClick={prevStep} disabled={currentStep === 0}>
            <ArrowLeft size={16} />
            Back
          </Button>
          {currentStep < steps.length - 1 ? (
            <Button onClick={nextStep}>
              Next
              <ArrowRight size={16} />
            </Button>
          ) : (
            <Button onClick={handleSubmit} loading={loading}>
              Complete Setup
              <CheckCircle size={16} />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
