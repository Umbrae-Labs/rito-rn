import type {
  RitoCoreWasmFontCatalog,
  RitoReaderAnnotationResponse,
  RitoReaderExactSourceRangeResolution,
  RitoReaderFootnote,
  RitoReaderNavigationResult,
  RitoReaderSearchResponse,
  RitoReaderTextInteractionResponse,
  RitoReaderTextRangeGeometry,
} from './types';

// Declarations written for the adapter; the runtime is upstream's verbatim.
type Bytes = ArrayBuffer | Uint8Array;
export declare function decodeRitoReaderFontCatalog(value: Bytes): RitoCoreWasmFontCatalog;
export declare function decodeRitoReaderFontNames(value: Bytes): readonly string[];
export declare function decodeRitoReaderFootnote(value: Bytes): RitoReaderFootnote;
export declare function decodeRitoReaderSearchResponse(value: Bytes): RitoReaderSearchResponse;
export declare function decodeRitoReaderTextRangeGeometry(value: Bytes): RitoReaderTextRangeGeometry;
export declare function decodeRitoReaderExactSourceRangeResolution(
  value: Bytes,
): RitoReaderExactSourceRangeResolution;
export declare function decodeRitoReaderTextInteractionResponse(value: Bytes): RitoReaderTextInteractionResponse;
export declare function decodeRitoReaderAnnotationResponse(value: Bytes): RitoReaderAnnotationResponse;
export declare function decodeRitoReaderNavigationResult(value: Bytes): RitoReaderNavigationResult;
