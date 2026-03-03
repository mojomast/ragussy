import { env } from '../config/index.js';

export type ConverterEngine = 'node-native' | 'convert-wasm';
export type SourceFormatClass = 'md' | 'txt' | 'html' | 'docx' | 'pdf';

export interface EngineResolution {
  engine: ConverterEngine;
  format: SourceFormatClass;
}

export function resolveConverterEngineForFormat(format: SourceFormatClass): EngineResolution {
  const configured = format === 'pdf'
    ? env.CONVERTER_ENGINE_PDF
    : format === 'docx'
      ? env.CONVERTER_ENGINE_DOCX
      : format === 'html'
        ? env.CONVERTER_ENGINE_HTML
        : format === 'txt'
          ? env.CONVERTER_ENGINE_TEXT
          : env.CONVERTER_ENGINE_DEFAULT;

  return {
    engine: configured || env.CONVERTER_ENGINE_DEFAULT,
    format,
  };
}
