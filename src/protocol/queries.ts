import { RitoWireError } from '../errors';
import { RitoBinaryReader } from './binary';
import { encodeRitoReaderSpreadRequest } from './rito2/reader-session-request-runtime.js';
import {
  encodeRitoReaderAnnotationRequest,
  encodeRitoReaderNavigationRequest,
  encodeRitoReaderTextInteractionRequest,
} from './rito2/reader-session-query-request-runtime.js';
import {
  decodeRitoReaderAnnotationResponse,
  decodeRitoReaderFontCatalog,
  decodeRitoReaderFontNames,
  decodeRitoReaderNavigationResult,
  decodeRitoReaderTextInteractionResponse,
} from './rito2/reader-session-query-decoder-runtime.js';
import type {
  RitoCoreWasmFontCatalog,
  RitoReaderAnnotationRequest,
  RitoReaderAnnotationResponse,
  RitoReaderNavigationRequest,
  RitoReaderNavigationResult,
  RitoReaderSpreadRequest,
  RitoReaderTextInteractionRequest,
  RitoReaderTextInteractionResponse,
} from './rito2/types';

/*
 * The session queries rito-ffi answers beyond reading pages. Their codecs are
 * upstream's own (src/protocol/rito2, copied from packages/rito-core-wasm), so
 * a query behaves on React Native exactly as in a browser reader.
 */

export type RitoSpreadRequest = RitoReaderSpreadRequest;
export type RitoTextInteractionRequest = RitoReaderTextInteractionRequest;
export type RitoTextInteractionResponse = RitoReaderTextInteractionResponse;
export type RitoAnnotationRequest = RitoReaderAnnotationRequest;
export type RitoAnnotationResponse = RitoReaderAnnotationResponse;
export type RitoNavigationRequest = RitoReaderNavigationRequest;
export type RitoNavigationResult = RitoReaderNavigationResult;
export type RitoFontCatalog = RitoCoreWasmFontCatalog;

/** `RITOPSH1`: the content shards a resource read waits on, ascending, and why. */
export interface RitoPendingShards {
  readonly shardIds: readonly number[];
  readonly message: string;
}

const RITOSPQ1_BYTES = 48;

/** Encodes a `RITOSPQ1` request for one spread of an artifact's revision, by its position in the layout. */
export function encodeRitoSpreadRequest(request: RitoSpreadRequest): Uint8Array {
  const bytes = encodeRitoReaderSpreadRequest(request);
  if (bytes.byteLength !== RITOSPQ1_BYTES) throw new RitoWireError(`RITOSPQ1 must be exactly ${RITOSPQ1_BYTES} bytes.`);
  return bytes;
}

/** Encodes a `RITOTIQ1` text selection query. */
export function encodeRitoTextInteractionRequest(request: RitoTextInteractionRequest): Uint8Array {
  return encodeRitoReaderTextInteractionRequest(request);
}

/** Decodes a `RITOTIR1` text selection answer. */
export function decodeRitoTextInteractionResponse(data: Uint8Array): RitoTextInteractionResponse {
  return decodeRitoReaderTextInteractionResponse(data);
}

/** Encodes a `RITOANQ1` request: build an annotation target for a source range, or locate a stored one. */
export function encodeRitoAnnotationRequest(request: RitoAnnotationRequest): Uint8Array {
  return encodeRitoReaderAnnotationRequest(request);
}

/** Decodes a `RITOANR1` annotation answer; its target crosses as the engine's canonical JSON. */
export function decodeRitoAnnotationResponse(data: Uint8Array): RitoAnnotationResponse {
  return decodeRitoReaderAnnotationResponse(data);
}

/** Encodes a `RITONVQ1` reading-position question. */
export function encodeRitoNavigationRequest(request: RitoNavigationRequest): Uint8Array {
  return encodeRitoReaderNavigationRequest(request);
}

/** Decodes a `RITONVR1` reading-position answer. */
export function decodeRitoNavigationResult(data: Uint8Array): RitoNavigationResult {
  return decodeRitoReaderNavigationResult(data);
}

/** Decodes a `RITOFNT1` font catalog: every family a `font-family` list can name, host families first. */
export function decodeRitoFontCatalog(data: Uint8Array): RitoFontCatalog {
  return decodeRitoReaderFontCatalog(data);
}

/** Decodes a `RITOFNN1` list of font family names. */
export function decodeRitoFontNames(data: Uint8Array): readonly string[] {
  return decodeRitoReaderFontNames(data);
}

/** Decodes a `RITOPSH1` message: what a call that returned the resource-pending status waits on. */
export function decodeRitoPendingShards(data: Uint8Array): RitoPendingShards {
  const reader = new RitoBinaryReader(data);
  reader.expectHeader('RITOPSH1');
  if (reader.readU32() !== 1) throw new RitoWireError('Unsupported RITOPSH1 wire version.');
  if (reader.readU64() !== BigInt(data.byteLength)) throw new RitoWireError('RITOPSH1 total length does not match input.');
  const count = reader.readCount('pending shards');
  if (count === 0) throw new RitoWireError('A pending failure names at least one shard.');
  const shardIds: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const shardId = reader.readU32();
    if (shardId === 0) throw new RitoWireError('Shard 0 is the skeleton and is never pending.');
    if (shardIds.length > 0 && shardId <= shardIds[shardIds.length - 1]!) {
      throw new RitoWireError('Pending shards are ascending and distinct.');
    }
    shardIds.push(shardId);
  }
  const message = reader.readUtf8();
  reader.expectExhausted();
  return { shardIds, message };
}

/** Reads shard ids written as little-endian u32 values. */
export function decodeRitoShardIds(data: Uint8Array): readonly number[] {
  if (data.byteLength % 4 !== 0) throw new RitoWireError('Shard ids must be whole little-endian u32 values.');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return Array.from({ length: data.byteLength / 4 }, (_, index) => view.getUint32(index * 4, true));
}
