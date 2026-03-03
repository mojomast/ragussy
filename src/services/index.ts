export { getChatModel, embedText, embedTexts, generateAnswer, type ChatMessage } from './llm.js';
export {
  getQdrantClient,
  ensureCollection,
  checkQdrantHealth,
  searchVectors,
  upsertVectors,
  deleteVectorsByFilter,
  getCollectionInfo,
  type SearchResult,
} from './qdrant.js';

export {
  convertDocument,
  convertDocumentWithIntent,
  type RawDocumentInput,
  type ConvertedDocument,
  type IntentConvertedDocument,
} from './document-conversion.js';

export {
  conversionIntentSchema,
  normalizeIntent,
  normalizeOutputFileName,
  type ConversionIntent,
  type SummaryStyle,
} from './document-conversion-intent.js';

export {
  upsertConversionMetadata,
  getConversionMetadata,
  type ConversionMetadataRecord,
} from './conversion-metadata.js';
