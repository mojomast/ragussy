import { useState, useEffect, useCallback, useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import { FileText, Upload, Trash2, RefreshCw, CheckCircle, Clock, FolderOpen, X } from 'lucide-react'
import Button from '@/components/Button'
import Card from '@/components/Card'
import Input from '@/components/Input'
import { useToast } from '@/components/Toast'
import { formatBytes, formatDate } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

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

interface ConsoleLog {
  id: string
  timestamp: Date
  level: 'info' | 'warn' | 'error' | 'success'
  message: string
}

interface ConvertUploadResponse {
  success: boolean
  filesAdded: number
  files: string[]
  skippedFiles?: string[]
  renamedFiles?: Array<{ from: string; to: string }>
  conversion?: {
    sourceFormat: string
    appliedActions: string[]
    warnings: string[]
    markdownLength: number
  }
  ingestion?: {
    filesUpdated: number
    chunksUpserted: number
    errors: string[]
  } | null
  error?: string
}

interface ConversionMetadataRecord {
  filePath: string
  originalFileName: string
  sourceMimeType: string
  sourceFormat: string
  converter: string
  warnings: string[]
  ignoredInstructions: string[]
  appliedActions: string[]
  checksumSha256: string
  convertedAt: string
}

export default function Documents() {
  const [documents, setDocuments] = useState<Document[]>([])
  const [docsPath, setDocsPath] = useState('')
  const [ingestionStatus, setIngestionStatus] = useState<IngestionStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [ingesting, setIngesting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [maxChunksPerBatch, setMaxChunksPerBatch] = useState('500')
  const [usePartialIngestion, setUsePartialIngestion] = useState(false)
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLog[]>([])
  const [showConsole, setShowConsole] = useState(false)
  const [ingestionProgress, setIngestionProgress] = useState({ current: 0, total: 0 })
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set())
  const [convertOnUpload, setConvertOnUpload] = useState(true)
  const [ingestAfterConvertUpload, setIngestAfterConvertUpload] = useState(false)
  const [uploadConflictStrategy, setUploadConflictStrategy] = useState<'replace' | 'rename' | 'skip'>('replace')
  const [lastConvertUploadResult, setLastConvertUploadResult] = useState<ConvertUploadResponse | null>(null)
  const [conversionMetadata, setConversionMetadata] = useState<ConversionMetadataRecord | null>(null)
  const [metadataLoadingPath, setMetadataLoadingPath] = useState<string | null>(null)
  const consoleEndRef = useRef<HTMLDivElement>(null)
  const { toast } = useToast()

  const toggleDocSelection = (path: string) => {
    setSelectedDocs(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  const selectAllDocs = () => {
    if (selectedDocs.size === documents.length) {
      setSelectedDocs(new Set())
    } else {
      setSelectedDocs(new Set(documents.map(d => d.relativePath)))
    }
  }

  const addConsoleLog = (level: ConsoleLog['level'], message: string) => {
    const log: ConsoleLog = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      level,
      message,
    }
    setConsoleLogs(prev => [...prev, log])
  }

  const clearConsole = () => {
    setConsoleLogs([])
  }

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [consoleLogs])

  const fetchDocuments = async () => {
    try {
      const res = await apiFetch('/api/documents')
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
      const res = await apiFetch('/api/documents/ingestion-status')
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

    const file = acceptedFiles[0]
    const isZip = file.name.toLowerCase().endsWith('.zip')

    setUploading(true)
    setLastConvertUploadResult(null)
    const formData = new FormData()
    formData.append('file', file)

    try {
      if (convertOnUpload && !isZip) {
        formData.append('conflictStrategy', uploadConflictStrategy)
        formData.append('ingestNow', String(ingestAfterConvertUpload))
        formData.append('intent', JSON.stringify({ operation: 'convert' }))

        const res = await apiFetch('/api/documents/convert-upload', {
          method: 'POST',
          body: formData,
        })
        const data = await res.json() as ConvertUploadResponse

        if (data.success) {
          setLastConvertUploadResult(data)
          const ingestSummary = data.ingestion
            ? ` and ingested ${data.ingestion.chunksUpserted} chunks`
            : ''
          toast('success', `Converted ${data.filesAdded} file(s)${ingestSummary}`)
          fetchDocuments()
          fetchIngestionStatus()
        } else {
          toast('error', data.error || 'Convert upload failed')
        }
      } else {
        if (convertOnUpload && isZip) {
          toast('info', 'Convert-on-upload currently applies to single files; uploaded ZIP as-is.')
        }

        const res = await apiFetch('/api/documents/upload', {
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
      }
    } catch (error) {
      toast('error', 'Upload failed')
    } finally {
      setUploading(false)
    }
  }, [convertOnUpload, ingestAfterConvertUpload, uploadConflictStrategy])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    // Accept any file type - backend will handle it
  })

  const handleIngest = async (full: boolean) => {
    setIngesting(true)
    clearConsole()
    setShowConsole(true)
    
    if (usePartialIngestion && full) {
      addConsoleLog('info', `Starting partial full ingestion with max chunks per batch: ${maxChunksPerBatch}`)
      await handlePartialIngest()
    } else {
      addConsoleLog('info', `Starting ${full ? 'full' : 'incremental'} ingestion (one chunk at a time)`)
      await handleSingleIngest(full)
    }
    
    setIngesting(false)
  }

  const handleSingleIngest = async (full: boolean) => {
    try {
      const res = await apiFetch('/api/documents/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full }),
      })
      const data = await res.json()

      if (data.success) {
        addConsoleLog('success', `✓ Ingestion complete`)
        addConsoleLog('info', `Files updated: ${data.result.filesUpdated}`)
        addConsoleLog('info', `Chunks upserted: ${data.result.chunksUpserted}`)
        if (data.result.filesDeleted > 0) {
          addConsoleLog('info', `Files deleted: ${data.result.filesDeleted}`)
        }
        if (data.result.chunksDeleted > 0) {
          addConsoleLog('info', `Chunks deleted: ${data.result.chunksDeleted}`)
        }
        if (data.result.errors.length > 0) {
          addConsoleLog('warn', `Errors encountered: ${data.result.errors.length}`)
          data.result.errors.forEach((err: string) => {
            addConsoleLog('error', err)
          })
        }
        toast('success', `Indexed ${data.result.filesUpdated} files, ${data.result.chunksUpserted} chunks`)
        fetchDocuments()
        fetchIngestionStatus()
      } else {
        addConsoleLog('error', `Ingestion failed: ${data.message || data.error || 'Unknown error'}`)
        toast('error', data.message || data.error || 'Ingestion failed')
      }
    } catch (error) {
      addConsoleLog('error', `Ingestion failed - ${String(error)}`)
      toast('error', 'Ingestion failed - check server logs')
    }
  }

  const handlePartialIngest = async () => {
    let startIndex = 0
    let totalChunksProcessed = 0
    let totalChunksUpserted = 0
    let totalFilesUpdated = 0
    const maxChunks = parseInt(maxChunksPerBatch)

    try {
      while (true) {
        addConsoleLog('info', `Processing batch starting at chunk ${startIndex}...`)
        
        const res = await apiFetch('/api/documents/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            full: true,
            partial: true,
            maxChunksPerBatch: maxChunks,
            startIndex,
          }),
        })
        const data = await res.json()

        if (!data.success) {
          addConsoleLog('error', `Batch failed: ${data.message || data.error || 'Unknown error'}`)
          toast('error', data.message || data.error || 'Batch ingestion failed')
          break
        }

        const result = data.result
        totalChunksProcessed = result.processedChunks
        totalChunksUpserted += result.chunksUpserted
        totalFilesUpdated += result.filesUpdated
        
        setIngestionProgress({ current: totalChunksProcessed, total: 0 })

        addConsoleLog('success', `✓ Batch complete: ${result.chunksUpserted} chunks upserted, ${result.filesUpdated} files updated`)
        
        if (result.errors.length > 0) {
          addConsoleLog('warn', `Batch errors: ${result.errors.length}`)
          result.errors.forEach((err: string) => {
            addConsoleLog('error', err)
          })
        }

        if (!result.hasMore) {
          addConsoleLog('success', `✓ All batches complete!`)
          addConsoleLog('info', `Total chunks upserted: ${totalChunksUpserted}`)
          addConsoleLog('info', `Total files updated: ${totalFilesUpdated}`)
          toast('success', `Indexed ${totalFilesUpdated} files, ${totalChunksUpserted} chunks`)
          fetchDocuments()
          fetchIngestionStatus()
          break
        }

        startIndex = result.nextStartIndex
        addConsoleLog('info', `Continuing with next batch...`)
      }
    } catch (error) {
      addConsoleLog('error', `Partial ingestion failed - ${String(error)}`)
      toast('error', 'Partial ingestion failed - check server logs')
    }
  }

  const handleSelectedIngest = async () => {
    if (selectedDocs.size === 0) {
      toast('error', 'No documents selected')
      return
    }

    setIngesting(true)
    clearConsole()
    setShowConsole(true)
    addConsoleLog('info', `Starting selective ingestion for ${selectedDocs.size} file(s)`)

    try {
      const res = await apiFetch('/api/documents/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedFiles: Array.from(selectedDocs),
        }),
      })
      const data = await res.json()

      if (data.success) {
        addConsoleLog('success', `✓ Selective ingestion complete`)
        addConsoleLog('info', `Files updated: ${data.result.filesUpdated}`)
        addConsoleLog('info', `Chunks upserted: ${data.result.chunksUpserted}`)
        if (data.result.chunksDeleted > 0) {
          addConsoleLog('info', `Old chunks replaced: ${data.result.chunksDeleted}`)
        }
        if (data.result.errors.length > 0) {
          addConsoleLog('warn', `Errors encountered: ${data.result.errors.length}`)
          data.result.errors.forEach((err: string) => {
            addConsoleLog('error', err)
          })
        }
        toast('success', `Indexed ${data.result.filesUpdated} files, ${data.result.chunksUpserted} chunks`)
        setSelectedDocs(new Set())
        fetchDocuments()
        fetchIngestionStatus()
      } else {
        addConsoleLog('error', `Ingestion failed: ${data.message || data.error || 'Unknown error'}`)
        toast('error', data.message || data.error || 'Ingestion failed')
      }
    } catch (error) {
      addConsoleLog('error', `Ingestion failed - ${String(error)}`)
      toast('error', 'Ingestion failed - check server logs')
    } finally {
      setIngesting(false)
    }
  }

  const handleDelete = async (path: string) => {
    if (!confirm('Delete this document?')) return

    try {
      const res = await apiFetch(`/api/documents/${path}`, { method: 'DELETE' })
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

  const handleViewConversionReport = async (filePath: string) => {
    setMetadataLoadingPath(filePath)
    try {
      const res = await apiFetch(`/api/documents/conversion-metadata/${encodeURIComponent(filePath)}`)
      const data = await res.json()

      if (res.ok && data.metadata) {
        setConversionMetadata(data.metadata)
      } else {
        setConversionMetadata(null)
        toast('error', data.error || 'No conversion report found for this file')
      }
    } catch {
      toast('error', 'Failed to load conversion report')
    } finally {
      setMetadataLoadingPath(null)
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
          {selectedDocs.size > 0 && (
            <Button variant="primary" onClick={handleSelectedIngest} loading={ingesting}>
              <RefreshCw size={16} />
              Index Selected ({selectedDocs.size})
            </Button>
          )}
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

      {/* Ingestion Settings */}
      <Card title="Ingestion Settings" description="Configure chunking and ingestion behavior">
        <div className="space-y-4">
          <div className="bg-blue-50 p-3 rounded-lg">
            <p className="text-sm text-blue-800">
              <strong>Production Mode:</strong> Each chunk is embedded individually and immediately upserted to the vector database. 
              Progress is saved after each chunk, allowing resumption if interrupted.
            </p>
          </div>

          <div className="border-t border-slate-200 pt-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={usePartialIngestion}
                onChange={(e) => setUsePartialIngestion(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300"
              />
              <span className="text-sm font-medium text-slate-700">
                Use Partial Ingestion (for large datasets)
              </span>
            </label>
            <p className="text-xs text-slate-500 mt-2">
              Process documents in multiple batches to avoid memory issues. Useful for large documentation sets.
            </p>

            {usePartialIngestion && (
              <div className="mt-4">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Max Chunks Per Batch
                </label>
                <Input
                  type="number"
                  min="100"
                  max="2000"
                  value={maxChunksPerBatch}
                  onChange={(e) => setMaxChunksPerBatch(e.target.value)}
                  placeholder="500"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Number of chunks to process in each batch. Lower values = more batches but safer.
                </p>
              </div>
            )}
          </div>

          {ingestionProgress.current > 0 && (
            <div className="border-t border-slate-200 pt-4">
              <p className="text-sm font-medium text-slate-700 mb-2">
                Progress: {ingestionProgress.current} chunks processed
              </p>
              <div className="w-full bg-slate-200 rounded-full h-2">
                <div
                  className="bg-primary-600 h-2 rounded-full transition-all"
                  style={{
                    width: ingestionProgress.total > 0 
                      ? `${(ingestionProgress.current / ingestionProgress.total) * 100}%`
                      : '0%'
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Upload Zone */}
      <Card title="Upload Documents" description="Upload markdown files or a zip archive">
        <div className="mb-4 grid gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={convertOnUpload}
              onChange={e => setConvertOnUpload(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300"
            />
            Convert on upload (single files)
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={ingestAfterConvertUpload}
              onChange={e => setIngestAfterConvertUpload(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300"
              disabled={!convertOnUpload}
            />
            Ingest immediately after conversion
          </label>

          <label className="text-sm text-slate-700">
            If file exists
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={uploadConflictStrategy}
              onChange={e => setUploadConflictStrategy(e.target.value as 'replace' | 'rename' | 'skip')}
              disabled={!convertOnUpload}
            >
              <option value="replace">Replace existing</option>
              <option value="rename">Rename new file</option>
              <option value="skip">Skip upload</option>
            </select>
          </label>

          <div className="text-xs text-slate-500">
            <p className="font-medium text-slate-700 mb-1">Supported conversion formats</p>
            <div className="flex flex-wrap gap-1">
              {['.md', '.txt', '.html', '.docx', '.pdf'].map(format => (
                <span key={format} className="px-2 py-1 rounded bg-slate-100 text-slate-700">
                  {format}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="mb-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          <p>Upload limits: single file up to 100MB.</p>
          <p>ZIP archives are supported for raw upload; conversion-on-upload currently applies to single files.</p>
        </div>

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
              <p className="text-sm text-slate-400">Supports any text file or .zip archive</p>
            </>
          )}
        </div>
      </Card>

      {lastConvertUploadResult && (
        <Card title="Latest Conversion Upload" description="Most recent convert-on-upload result">
          <div className="space-y-2 text-sm">
            <p>
              <strong>Files written:</strong> {lastConvertUploadResult.files.join(', ') || 'None'}
            </p>
            {lastConvertUploadResult.skippedFiles && lastConvertUploadResult.skippedFiles.length > 0 && (
              <p>
                <strong>Skipped:</strong> {lastConvertUploadResult.skippedFiles.join(', ')}
              </p>
            )}
            {lastConvertUploadResult.renamedFiles && lastConvertUploadResult.renamedFiles.length > 0 && (
              <p>
                <strong>Renamed:</strong>{' '}
                {lastConvertUploadResult.renamedFiles.map(r => `${r.from} -> ${r.to}`).join(', ')}
              </p>
            )}
            {lastConvertUploadResult.conversion && (
              <>
                <p>
                  <strong>Converter:</strong> {lastConvertUploadResult.conversion.sourceFormat.toUpperCase()}
                </p>
                <p>
                  <strong>Actions:</strong>{' '}
                  {lastConvertUploadResult.conversion.appliedActions.join(', ') || 'convert'}
                </p>
                {lastConvertUploadResult.conversion.warnings.length > 0 && (
                  <p className="text-amber-700">
                    <strong>Warnings:</strong> {lastConvertUploadResult.conversion.warnings.join(' | ')}
                  </p>
                )}
              </>
            )}
            {lastConvertUploadResult.ingestion && (
              <p>
                <strong>Ingestion:</strong> {lastConvertUploadResult.ingestion.filesUpdated} files,{' '}
                {lastConvertUploadResult.ingestion.chunksUpserted} chunks
              </p>
            )}
          </div>
        </Card>
      )}

      {/* Ingestion Console */}
      {showConsole && (
        <Card
          title="Ingestion Console"
          description="Real-time ingestion progress and logs"
          actions={
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={clearConsole}>
                Clear
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowConsole(false)}>
                <X size={14} />
              </Button>
            </div>
          }
        >
          <div className="bg-slate-900 text-slate-100 rounded-lg p-4 font-mono text-sm max-h-96 overflow-y-auto">
            {consoleLogs.length === 0 ? (
              <p className="text-slate-500">Waiting for logs...</p>
            ) : (
              consoleLogs.map(log => (
                <div key={log.id} className="mb-1 flex gap-2">
                  <span className="text-slate-500 flex-shrink-0">
                    {log.timestamp.toLocaleTimeString()}
                  </span>
                  <span
                    className={`flex-shrink-0 font-semibold ${
                      log.level === 'error'
                        ? 'text-red-400'
                        : log.level === 'warn'
                          ? 'text-yellow-400'
                          : log.level === 'success'
                            ? 'text-green-400'
                            : 'text-blue-400'
                    }`}
                  >
                    [{log.level.toUpperCase()}]
                  </span>
                  <span className="text-slate-100">{log.message}</span>
                </div>
              ))
            )}
            <div ref={consoleEndRef} />
          </div>
        </Card>
      )}

      {/* Documents List */}
      <Card
        title="Document Files"
        description={`Located in: ${docsPath}`}
        actions={
          <div className="flex gap-2">
            {documents.length > 0 && (
              <Button variant="ghost" size="sm" onClick={selectAllDocs}>
                {selectedDocs.size === documents.length ? 'Deselect All' : 'Select All'}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={fetchDocuments}>
              <RefreshCw size={14} />
            </Button>
          </div>
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
                  <input
                    type="checkbox"
                    checked={selectedDocs.has(doc.relativePath)}
                    onChange={() => toggleDocSelection(doc.relativePath)}
                    className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                  />
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
                    onClick={() => handleViewConversionReport(doc.relativePath)}
                    loading={metadataLoadingPath === doc.relativePath}
                  >
                    Report
                  </Button>
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

      {conversionMetadata && (
        <Card
          title="Conversion Report"
          description={`Latest conversion metadata for ${conversionMetadata.filePath}`}
          actions={
            <Button variant="ghost" size="sm" onClick={() => setConversionMetadata(null)}>
              <X size={14} />
            </Button>
          }
        >
          <div className="space-y-3 text-sm">
            <p><strong>Original file:</strong> {conversionMetadata.originalFileName}</p>
            <p><strong>Source format:</strong> {conversionMetadata.sourceFormat}</p>
            <p><strong>Source MIME:</strong> {conversionMetadata.sourceMimeType}</p>
            <p><strong>Converter:</strong> {conversionMetadata.converter}</p>
            <p><strong>Converted at:</strong> {formatDate(conversionMetadata.convertedAt)}</p>
            <p><strong>Checksum (sha256):</strong> <code>{conversionMetadata.checksumSha256}</code></p>

            <div>
              <p className="font-medium text-slate-700">Applied Actions</p>
              {conversionMetadata.appliedActions.length === 0 ? (
                <p className="text-slate-500">None</p>
              ) : (
                <ul className="list-disc pl-5 text-slate-700">
                  {conversionMetadata.appliedActions.map(action => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="font-medium text-slate-700">Warnings</p>
              {conversionMetadata.warnings.length === 0 ? (
                <p className="text-slate-500">None</p>
              ) : (
                <ul className="list-disc pl-5 text-amber-700">
                  {conversionMetadata.warnings.map(warning => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
