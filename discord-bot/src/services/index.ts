export { 
  RagApiClient, 
  ragApi, 
  type ChatRequest, 
  type ChatResponse, 
  type Source, 
  type ImageResult,
  type HealthResponse,
  type MoreImagesResponse,
  type UploadDocumentResponse,
  type IngestDocumentsResponse,
  type ConflictStrategy,
} from './rag-api.js';

export {
  convertDocument,
  convertDocumentWithIntent,
  type ConvertedDocument,
  type IntentConvertedDocument,
  type IntentConversionOptions,
  type RawDocumentInput,
} from './document-converter.js';

export {
  conversionIntentSchema,
  normalizeIntent,
  normalizeOutputFileName,
  type ConversionIntent,
  type ConversionOperation,
  type SummaryStyle,
} from './conversion-intent.js';

export {
  parseConversionInstructions,
  IntentClarificationError,
  getIgnoredInstructionNotes,
  getSectionHints,
  type ParseMethod,
  type ParseIntentResult,
  type ParseIntentOptions,
} from './instruction-parser.js';
