import type { ConvertedDocument, RawDocumentInput } from './document-conversion.js';
import type { SourceFormatClass } from './converter-engine.js';

export async function convertWithConvertWasm(
  _input: RawDocumentInput,
  _format: SourceFormatClass,
  _outputName: string
): Promise<ConvertedDocument> {
  throw new Error(
    'convert-wasm adapter is not installed in this backend build yet; falling back to node-native converter.'
  );
}
