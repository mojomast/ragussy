import { useState, useEffect } from 'react'
import { Database, Trash2, Plus, Search, RefreshCw, CheckCircle, XCircle } from 'lucide-react'
import Button from '@/components/Button'
import Card from '@/components/Card'
import Input from '@/components/Input'
import { useToast } from '@/components/Toast'

interface Collection {
  name: string
  pointsCount: number
  vectorSize: number
}

interface VectorStatus {
  connected: boolean
  url: string
  collection: {
    name: string
    pointsCount: number
    indexedVectorsCount: number
    vectorSize: number
    status: string
  } | null
}

export default function VectorStore() {
  const [status, setStatus] = useState<VectorStatus | null>(null)
  const [collections, setCollections] = useState<Collection[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const [newCollectionName, setNewCollectionName] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const { toast } = useToast()

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/vectors/status')
      const data = await res.json()
      setStatus(data)
    } catch {
      setStatus({ connected: false, url: '', collection: null })
    }
  }

  const fetchCollections = async () => {
    try {
      const res = await fetch('/api/vectors/collections')
      const data = await res.json()
      setCollections(data.collections || [])
    } catch {
      setCollections([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStatus()
    fetchCollections()
  }, [])

  const handleSearch = async () => {
    if (!searchQuery.trim()) return

    setSearching(true)
    try {
      const res = await fetch('/api/vectors/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery, limit: 5 }),
      })
      const data = await res.json()
      setSearchResults(data.results || [])
    } catch {
      toast('error', 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  const handleClearCollection = async () => {
    if (!confirm('This will delete all vectors in the current collection. Continue?')) return

    try {
      const res = await fetch('/api/vectors/clear', { method: 'POST' })
      if (res.ok) {
        toast('success', 'Collection cleared')
        fetchStatus()
        fetchCollections()
      } else {
        toast('error', 'Failed to clear collection')
      }
    } catch {
      toast('error', 'Failed to clear collection')
    }
  }

  const handleCreateCollection = async () => {
    if (!newCollectionName.trim()) return

    try {
      const res = await fetch('/api/vectors/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCollectionName }),
      })
      if (res.ok) {
        toast('success', 'Collection created')
        setNewCollectionName('')
        setShowCreateModal(false)
        fetchCollections()
      } else {
        toast('error', 'Failed to create collection')
      }
    } catch {
      toast('error', 'Failed to create collection')
    }
  }

  const handleDeleteCollection = async (name: string) => {
    if (!confirm(`Delete collection "${name}"? This cannot be undone.`)) return

    try {
      const res = await fetch(`/api/vectors/collections/${name}`, { method: 'DELETE' })
      if (res.ok) {
        toast('success', 'Collection deleted')
        fetchStatus()
        fetchCollections()
      } else {
        toast('error', 'Failed to delete collection')
      }
    } catch {
      toast('error', 'Failed to delete collection')
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Vector Store</h1>
          <p className="text-slate-500">Manage your Qdrant vector database</p>
        </div>
        <Button variant="secondary" onClick={() => { fetchStatus(); fetchCollections(); }}>
          <RefreshCw size={16} />
          Refresh
        </Button>
      </div>

      {/* Connection Status */}
      <Card>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              status?.connected ? 'bg-green-100' : 'bg-red-100'
            }`}>
              {status?.connected ? (
                <CheckCircle className="text-green-600" size={24} />
              ) : (
                <XCircle className="text-red-600" size={24} />
              )}
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">
                {status?.connected ? 'Connected to Qdrant' : 'Not Connected'}
              </h3>
              <p className="text-sm text-slate-500">{status?.url || 'No URL configured'}</p>
            </div>
          </div>
          {status?.collection && (
            <div className="text-right">
              <p className="text-sm text-slate-500">Active Collection</p>
              <p className="font-medium text-slate-900">{status.collection.name}</p>
              <p className="text-sm text-slate-500">{status.collection.pointsCount.toLocaleString()} vectors</p>
            </div>
          )}
        </div>
      </Card>

      {/* Stats */}
      {status?.collection && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <div className="text-center">
              <p className="text-3xl font-bold text-slate-900">
                {status.collection.pointsCount.toLocaleString()}
              </p>
              <p className="text-sm text-slate-500">Total Vectors</p>
            </div>
          </Card>
          <Card>
            <div className="text-center">
              <p className="text-3xl font-bold text-slate-900">
                {status.collection.vectorSize}
              </p>
              <p className="text-sm text-slate-500">Vector Dimensions</p>
            </div>
          </Card>
          <Card>
            <div className="text-center">
              <p className="text-3xl font-bold text-slate-900 capitalize">
                {status.collection.status}
              </p>
              <p className="text-sm text-slate-500">Status</p>
            </div>
          </Card>
        </div>
      )}

      {/* Search Test */}
      <Card title="Test Vector Search" description="Search your indexed documents">
        <div className="flex gap-3 mb-4">
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Enter a search query..."
            className="flex-1"
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
          />
          <Button onClick={handleSearch} loading={searching}>
            <Search size={16} />
            Search
          </Button>
        </div>

        {searchResults.length > 0 && (
          <div className="space-y-3">
            {searchResults.map((result, i) => (
              <div key={i} className="p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-slate-900">{result.title}</span>
                  <span className="text-sm text-slate-500">
                    Score: {(result.score * 100).toFixed(1)}%
                  </span>
                </div>
                <p className="text-sm text-slate-600">{result.section}</p>
                <p className="text-xs text-slate-400 mt-1">{result.preview}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Collections */}
      <Card
        title="Collections"
        description="All Qdrant collections"
        actions={
          <Button size="sm" onClick={() => setShowCreateModal(true)}>
            <Plus size={14} />
            New Collection
          </Button>
        }
      >
        {loading ? (
          <div className="text-center py-8 text-slate-500">Loading...</div>
        ) : collections.length === 0 ? (
          <div className="text-center py-8">
            <Database className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">No collections found</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {collections.map(collection => (
              <div key={collection.name} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <Database className="text-slate-400" size={20} />
                  <div>
                    <p className="font-medium text-slate-900">{collection.name}</p>
                    <p className="text-sm text-slate-500">
                      {collection.pointsCount.toLocaleString()} vectors • {collection.vectorSize} dims
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeleteCollection(collection.name)}
                >
                  <Trash2 size={16} className="text-red-500" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Danger Zone */}
      <Card title="Danger Zone" className="border-red-200">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-slate-900">Clear Current Collection</p>
            <p className="text-sm text-slate-500">Delete all vectors and reset ingestion state</p>
          </div>
          <Button variant="danger" onClick={handleClearCollection}>
            <Trash2 size={16} />
            Clear Collection
          </Button>
        </div>
      </Card>

      {/* Create Collection Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Create Collection</h3>
            <Input
              label="Collection Name"
              value={newCollectionName}
              onChange={e => setNewCollectionName(e.target.value)}
              placeholder="my-collection"
            />
            <div className="flex justify-end gap-3 mt-6">
              <Button variant="ghost" onClick={() => setShowCreateModal(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateCollection}>
                Create
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
