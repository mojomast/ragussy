import { useState, useEffect } from 'react'
import { Save, RefreshCw, Eye, EyeOff, Copy, Check } from 'lucide-react'
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
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showApiKeys, setShowApiKeys] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const { toast } = useToast()

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings')
      const data = await res.json()
      setSettings(data)
    } catch {
      toast('error', 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSettings()
  }, [])

  const updateSetting = (key: keyof Settings, value: string | number) => {
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
              value={settings.llmBaseUrl}
              onChange={e => updateSetting('llmBaseUrl', e.target.value)}
            >
              <option value="https://api.openai.com/v1">OpenAI</option>
              <option value="https://openrouter.ai/api/v1">OpenRouter</option>
            </select>
          </div>
          <div className="col-span-2">
            <Input
              label="API Key"
              type={showApiKeys ? 'text' : 'password'}
              value={settings.llmApiKey}
              onChange={e => updateSetting('llmApiKey', e.target.value)}
            />
          </div>
          <Input
            label="Model"
            value={settings.llmModel}
            onChange={e => updateSetting('llmModel', e.target.value)}
          />
          <Input
            label="Max Tokens"
            type="number"
            value={settings.llmMaxTokens}
            onChange={e => updateSetting('llmMaxTokens', parseInt(e.target.value))}
          />
        </div>
      </Card>

      {/* Embeddings Settings */}
      <Card title="Embeddings Configuration" description="Embedding model settings">
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Base URL"
            value={settings.embedBaseUrl}
            onChange={e => updateSetting('embedBaseUrl', e.target.value)}
          />
          <Input
            label="API Key"
            type={showApiKeys ? 'text' : 'password'}
            value={settings.embedApiKey}
            onChange={e => updateSetting('embedApiKey', e.target.value)}
          />
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Model</label>
            <select
              className="w-full px-3 py-2 rounded-lg border border-slate-300"
              value={settings.embedModel}
              onChange={e => {
                updateSetting('embedModel', e.target.value)
                updateSetting('vectorDim', e.target.value === 'text-embedding-3-large' ? 3072 : 1536)
              }}
            >
              <option value="text-embedding-3-small">text-embedding-3-small (1536)</option>
              <option value="text-embedding-3-large">text-embedding-3-large (3072)</option>
              <option value="text-embedding-ada-002">text-embedding-ada-002 (1536)</option>
            </select>
          </div>
          <Input
            label="Vector Dimensions"
            type="number"
            value={settings.vectorDim}
            onChange={e => updateSetting('vectorDim', parseInt(e.target.value))}
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
    </div>
  )
}
