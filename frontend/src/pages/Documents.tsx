import { useState, useEffect, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { FileText, Upload, Trash2, RefreshCw, CheckCircle, Clock, FolderOpen } from 'lucide-react'
import Button from '@/components/Button'
import Card from '@/components/Card'
import { useToast } from '@/components/Toast'
import { formatBytes, formatDate } from '@/lib/utils'

interface Document {
  name: string
  relativePath: string
  size: number
  modified: string
  indexed: boolean
  lastIndexed: string | null
  chunkCount: number
}

interface IngestionStatus {
  totalFiles: number
  totalChunks: number
  lastIngested: string | null
}

export default function Documents() {
  const [documents, setDocuments] = useState<Document[]>([])
  const [docsPath, setDocsPath] = useState('')
  const [ingestionStatus, setIngestionStatus] = useState<IngestionStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [ingesting, setIngesting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const { toast } = useToast()

  const fetchDocuments = async () => {
    try {
      const res = await fetch('/api/documents')
      const data = await res.json()
      setDocuments(data.documents || [])
      setDocsPath(data.docsPath || '')
    } catch (error) {
      toast('error', 'Failed to load documents')
    } finally {
      setLoading(false)
    }
  }

  const fetchIngestionStatus = async () => {
    try {
      const res = await fetch('/api/documents/ingestion-status')
      const data = await res.json()
      setIngestionStatus(data)
    } catch {
      // Ignore
    }
  }

  useEffect(() => {
    fetchDocuments()
    fetchIngestionStatus()
  }, [])

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
        toast('success', `Uploaded ${data.filesAdded} file(s)`)
        fetchDocuments()
      } else {
        toast('error', data.error || 'Upload failed')
      }
    } catch (error) {
      toast('error', 'Upload failed')
    } finally {
      setUploading(false)
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/zip': ['.zip'],
      'text/markdown': ['.md', '.mdx'],
    },
  })

  const handleIngest = async (full: boolean) => {
    setIngesting(true)
    try {
      const res = await fetch('/api/documents/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full }),
      })
      const data = await res.json()

      if (data.success) {
        toast('success', `Indexed ${data.result.filesUpdated} files, ${data.result.chunksUpserted} chunks`)
        fetchDocuments()
        fetchIngestionStatus()
      } else {
        toast('error', data.error || 'Ingestion failed')
      }
    } catch (error) {
      toast('error', 'Ingestion failed')
    } finally {
      setIngesting(false)
    }
  }

  const handleDelete = async (path: string) => {
    if (!confirm('Delete this document?')) return

    try {
      const res = await fetch(`/api/documents/${path}`, { method: 'DELETE' })
      if (res.ok) {
        toast('success', 'Document deleted')
        fetchDocuments()
      } else {
        toast('error', 'Failed to delete')
      }
    } catch {
      toast('error', 'Failed to delete')
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Documents</h1>
          <p className="text-slate-500">Manage your documentation files</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => handleIngest(false)} loading={ingesting}>
            <RefreshCw size={16} />
            Incremental Index
          </Button>
          <Button onClick={() => handleIngest(true)} loading={ingesting}>
            <RefreshCw size={16} />
            Full Reindex
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <FileText className="text-blue-600" size={20} />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{documents.length}</p>
              <p className="text-sm text-slate-500">Documents</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <CheckCircle className="text-green-600" size={20} />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{ingestionStatus?.totalChunks || 0}</p>
              <p className="text-sm text-slate-500">Indexed Chunks</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <Clock className="text-purple-600" size={20} />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-900">
                {ingestionStatus?.lastIngested ? formatDate(ingestionStatus.lastIngested) : 'Never'}
              </p>
              <p className="text-sm text-slate-500">Last Indexed</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Upload Zone */}
      <Card title="Upload Documents" description="Upload markdown files or a zip archive">
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
            isDragActive ? 'border-primary-500 bg-primary-50' : 'border-slate-300 hover:border-slate-400'
          }`}
        >
          <input {...getInputProps()} />
          <Upload className="w-12 h-12 text-slate-400 mx-auto mb-4" />
          {uploading ? (
            <p className="text-slate-600">Uploading...</p>
          ) : isDragActive ? (
            <p className="text-primary-600">Drop files here...</p>
          ) : (
            <>
              <p className="text-slate-600 mb-1">Drag & drop files here, or click to select</p>
              <p className="text-sm text-slate-400">Supports .md, .mdx, and .zip files</p>
            </>
          )}
        </div>
      </Card>

      {/* Documents List */}
      <Card
        title="Document Files"
        description={`Located in: ${docsPath}`}
        actions={
          <Button variant="ghost" size="sm" onClick={fetchDocuments}>
            <RefreshCw size={14} />
          </Button>
        }
      >
        {loading ? (
          <div className="text-center py-8 text-slate-500">Loading...</div>
        ) : documents.length === 0 ? (
          <div className="text-center py-8">
            <FolderOpen className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">No documents found</p>
            <p className="text-sm text-slate-400">Upload some markdown files to get started</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {documents.map(doc => (
              <div key={doc.relativePath} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <FileText className="text-slate-400" size={20} />
                  <div>
                    <p className="font-medium text-slate-900">{doc.name}</p>
                    <p className="text-sm text-slate-500">{doc.relativePath}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right text-sm">
                    <p className="text-slate-600">{formatBytes(doc.size)}</p>
                    {doc.indexed ? (
                      <p className="text-green-600">{doc.chunkCount} chunks</p>
                    ) : (
                      <p className="text-amber-600">Not indexed</p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(doc.relativePath)}
                  >
                    <Trash2 size={16} className="text-red-500" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
