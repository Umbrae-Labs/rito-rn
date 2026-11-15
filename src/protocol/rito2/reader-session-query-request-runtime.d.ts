import type {
  RitoReaderAnnotationRequest,
  RitoReaderExactSourceRangeRequest,
  RitoReaderNavigationRequest,
  RitoReaderSearchRequest,
  RitoReaderTextInteractionRequest,
  RitoReaderTextRangeRequest,
} from './types';

// Declarations written for the adapter; the runtime is upstream's verbatim.
export declare function encodeRitoReaderSearchRequest(request: RitoReaderSearchRequest): Uint8Array;
export declare function encodeRitoReaderTextRangeRequest(request: RitoReaderTextRangeRequest): Uint8Array;
export declare function encodeRitoReaderExactSourceRangeRequest(
  request: RitoReaderExactSourceRangeRequest,
): Uint8Array;
export declare function encodeRitoReaderTextInteractionRequest(
  request: RitoReaderTextInteractionRequest,
): Uint8Array;
export declare function encodeRitoReaderAnnotationRequest(request: RitoReaderAnnotationRequest): Uint8Array;
export declare function ritoReaderNavigationQueryArtifactId(
  query: RitoReaderNavigationRequest['query'],
): bigint | undefined;
export declare function encodeRitoReaderNavigationRequest(request: RitoReaderNavigationRequest): Uint8Array;
