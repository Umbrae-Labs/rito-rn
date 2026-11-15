import { NitroModules } from 'react-native-nitro-modules';
import type {
  RitoNitro as RitoNitroSpec,
  RitoNitroPaperTurnForgotten,
  RitoNitroPaperTurnLeaves,
  RitoNitroPaperTurnSettleStep,
  RitoNitroPaperTurnSheet,
  RitoNitroPinnedFontFace,
  RitoNitroResult,
} from './specs/rito-nitro.nitro';
import { RitoNativeError, RitoNativeModuleUnavailableError, type RitoNativeStatus } from './errors';
import { toExternalIdString } from './protocol/binary';

declare global {
  var LUNAR_READER_PERF: boolean | undefined;
  var LUNAR_READER_TRACE: boolean | undefined;
  var __LUNAR_READER_PERF__: boolean | undefined;
}

const perfConsole = console as Console & { info?: (...data: unknown[]) => void };
function nativePerfMark(label: string): void {
  if (
    process.env.EXPO_PUBLIC_READER_PERF !== '1'
    && globalThis.LUNAR_READER_PERF !== true
    && globalThis.__LUNAR_READER_PERF__ !== true
  ) return;
  try {
    perfConsole.info?.(`[LunarReader][perf] ${label}`);
  } catch {
    // Logging must never affect a native reader operation.
  }
}

export type RitoNativePinnedFontFace = {
  readonly bytes: Uint8Array;
  readonly expectedSha256: string;
  readonly genericRole: 'serif' | 'sansSerif' | 'monospace';
  readonly language?: string;
};

export interface RitoNativeReaderModule {
  open(publication: Uint8Array, request: Uint8Array, fonts: readonly RitoNativePinnedFontFace[]): Promise<RitoNativeCallResult>;
  readPublication(sessionId: bigint): Promise<RitoNativeCallResult>;
  requestArtifact(sessionId: bigint, request: Uint8Array): Promise<RitoNativeCallResult>;
  requestAdjacent(sessionId: bigint, request: Uint8Array): Promise<RitoNativeCallResult>;
  peekAdjacent(sessionId: bigint, request: Uint8Array): Promise<RitoNativeCallResult>;
  adoptForeground(sessionId: bigint, request: Uint8Array): Promise<RitoNativeCallResult>;
  commitPeekedArtifact(sessionId: bigint, request: Uint8Array): Promise<RitoNativeCallResult>;
  advanceBackground(sessionId: bigint, request: Uint8Array): Promise<RitoNativeCallResult>;
  adoptBackground(sessionId: bigint, request: Uint8Array): Promise<RitoNativeCallResult>;
  readResource(sessionId: bigint, artifactId: bigint, kind: number, href: string): Promise<RitoNativeCallResult>;
  search(sessionId: bigint, request: Uint8Array): Promise<RitoNativeCallResult>;
  textRangeGeometry(sessionId: bigint, request: Uint8Array): Promise<RitoNativeCallResult>;
  resolveExactSourceRange(sessionId: bigint, request: Uint8Array): Promise<RitoNativeCallResult>;
  readPage(sessionId: bigint, artifactId: bigint, pageIndex: number): Promise<RitoNativeCallResult>;
  readFootnote(sessionId: bigint, artifactId: bigint, key: string): Promise<RitoNativeCallResult>;
  releaseArtifact(sessionId: bigint, artifactId: bigint): Promise<RitoNativeCallResult>;
  dispose(sessionId: bigint): Promise<RitoNativeCallResult>;
  /** rito_open: opens without a pinned font policy; chapter-local pagination then fails closed. */
  openWithoutPinnedFonts(publication: Uint8Array, request: Uint8Array): Promise<RitoNativeCallResult>;
  /** Opens a publication's skeleton shard; `key` is its 32-byte key when the shards are encrypted. */
  openShards(skeleton: Uint8Array, key: Uint8Array | undefined, request: Uint8Array, fonts: readonly RitoNativePinnedFontFace[]): Promise<RitoNativeCallResult>;
  /** data holds the shard's id as one little-endian u32. */
  supplyShard(sessionId: bigint, shard: Uint8Array, key?: Uint8Array): Promise<RitoNativeCallResult>;
  /** data holds content shard ids as little-endian u32 values, nearest first. */
  contentShardsNear(sessionId: bigint, href: string): Promise<RitoNativeCallResult>;
  peekSpread(sessionId: bigint, request: Uint8Array): Promise<RitoNativeCallResult>;
  resolveTextInteraction(sessionId: bigint, request: Uint8Array): Promise<RitoNativeCallResult>;
  resolveAnnotation(sessionId: bigint, request: Uint8Array): Promise<RitoNativeCallResult>;
  resolveNavigation(sessionId: bigint, request: Uint8Array): Promise<RitoNativeCallResult>;
  fontCatalog(sessionId: bigint): Promise<RitoNativeCallResult>;
  unresolvedFontFamilies(sessionId: bigint, list: string): Promise<RitoNativeCallResult>;
  addHostFontFaces(sessionId: bigint, fonts: readonly RitoNativePinnedFontFace[]): Promise<RitoNativeCallResult>;
  removeHostFontFaces(sessionId: bigint, sha256: readonly string[]): Promise<RitoNativeCallResult>;
  markFontFamilyUnavailable(sessionId: bigint, family: string): Promise<RitoNativeCallResult>;
}

/**
 * The paper page turn's model (rito-turn) as rito-ffi exports it: called
 * synchronously, frame by frame, in the number layouts `rito_turn::pack`
 * fixes for every host. Failures throw.
 */
export interface RitoNativePaperTurnModule {
  layouts(): readonly number[];
  create(): bigint;
  free(turn: bigint): void;
  begin(turn: bigint, frame: readonly number[], leavesCapacity: number): RitoNitroPaperTurnLeaves;
  lay(turn: bigint, epoch: number, leavesCapacity: number): RitoNitroPaperTurnLeaves;
  sheet(turn: bigint, index: number, pointsCapacity: number): RitoNitroPaperTurnSheet;
  forget(turn: bigint, epoch: number, leavesCapacity: number): RitoNitroPaperTurnForgotten;
  state(turn: bigint, now: number): readonly number[];
  begins(turn: bigint, dx: number, velocity: number, sameSpreads: boolean): readonly number[];
  settle(turn: bigint, from: number, velocity: number, to: number): readonly number[];
  settleStep(turn: bigint, settle: readonly number[], seconds: number, now: number): RitoNitroPaperTurnSettleStep;
  travel(touch: readonly number[], width: number, spine: number): number;
  lands(release: readonly number[]): boolean;
  eyeHeight(width: number, height: number): number;
}

export interface RitoNativeCallResult {
  readonly status: RitoNativeStatus;
  readonly data: Uint8Array;
  readonly error: string;
}

let nativeObject: RitoNitroSpec | null | undefined;
function getNitroObject(): RitoNitroSpec | null {
  if (nativeObject !== undefined) return nativeObject;
  try {
    nativeObject = NitroModules.createHybridObject<RitoNitroSpec>('RitoNitro');
  } catch {
    nativeObject = null;
  }
  return nativeObject;
}

export function isRitoNativeReaderAvailable(): boolean {
  return getNitroObject() !== null;
}

export function getRitoNativeReaderModule(): RitoNativeReaderModule {
  const native = getNitroObject();
  if (!native) throw new RitoNativeModuleUnavailableError();
  return new RitoNitroReaderModule(native);
}

export function getRitoNativePaperTurnModule(): RitoNativePaperTurnModule {
  const native = getNitroObject();
  if (!native) throw new RitoNativeModuleUnavailableError();
  return new RitoNitroPaperTurnModule(native);
}

class RitoNitroReaderModule implements RitoNativeReaderModule {
  constructor(private readonly native: RitoNitroSpec) {}

  open(publication: Uint8Array, request: Uint8Array, fonts: readonly RitoNativePinnedFontFace[]): Promise<RitoNativeCallResult> {
    return this.unwrap('open', this.native.open(toArrayBuffer(publication), toArrayBuffer(request), fonts.map(toNitroFont)));
  }
  readPublication(sessionId: bigint) { return this.unwrap('readPublication', this.native.readPublication(toExternalIdString(sessionId))); }
  requestArtifact(sessionId: bigint, request: Uint8Array) { return this.unwrap('requestArtifact', this.native.requestArtifact(toExternalIdString(sessionId), toArrayBuffer(request))); }
  requestAdjacent(sessionId: bigint, request: Uint8Array) { return this.unwrap('requestAdjacent', this.native.requestAdjacent(toExternalIdString(sessionId), toArrayBuffer(request))); }
  peekAdjacent(sessionId: bigint, request: Uint8Array) { return this.unwrap('peekAdjacent', this.native.peekAdjacent(toExternalIdString(sessionId), toArrayBuffer(request))); }
  adoptForeground(sessionId: bigint, request: Uint8Array) { return this.unwrap('adoptForeground', this.native.adoptForeground(toExternalIdString(sessionId), toArrayBuffer(request))); }
  commitPeekedArtifact(sessionId: bigint, request: Uint8Array) { return this.unwrap('commitPeekedArtifact', this.native.commitPeekedArtifact(toExternalIdString(sessionId), toArrayBuffer(request))); }
  advanceBackground(sessionId: bigint, request: Uint8Array) { return this.unwrap('advanceBackground', this.native.advanceBackground(toExternalIdString(sessionId), toArrayBuffer(request))); }
  adoptBackground(sessionId: bigint, request: Uint8Array) { return this.unwrap('adoptBackground', this.native.adoptBackground(toExternalIdString(sessionId), toArrayBuffer(request))); }
  readResource(sessionId: bigint, artifactId: bigint, kind: number, href: string) { return this.unwrap('readResource', this.native.readResource(toExternalIdString(sessionId), toExternalIdString(artifactId), kind, href)); }
  search(sessionId: bigint, request: Uint8Array) { return this.unwrap('search', this.native.search(toExternalIdString(sessionId), toArrayBuffer(request))); }
  textRangeGeometry(sessionId: bigint, request: Uint8Array) { return this.unwrap('textRangeGeometry', this.native.textRangeGeometry(toExternalIdString(sessionId), toArrayBuffer(request))); }
  resolveExactSourceRange(sessionId: bigint, request: Uint8Array) { return this.unwrap('resolveExactSourceRange', this.native.resolveExactSourceRange(toExternalIdString(sessionId), toArrayBuffer(request))); }
  readPage(sessionId: bigint, artifactId: bigint, pageIndex: number) { return this.unwrap('readPage', this.native.readPage(toExternalIdString(sessionId), toExternalIdString(artifactId), pageIndex)); }
  readFootnote(sessionId: bigint, artifactId: bigint, key: string) { return this.unwrap('readFootnote', this.native.readFootnote(toExternalIdString(sessionId), toExternalIdString(artifactId), key)); }
  releaseArtifact(sessionId: bigint, artifactId: bigint) { return this.unwrap('releaseArtifact', this.native.releaseArtifact(toExternalIdString(sessionId), toExternalIdString(artifactId))); }
  dispose(sessionId: bigint) { return this.unwrap('dispose', this.native.disposeSession(toExternalIdString(sessionId))); }
  openWithoutPinnedFonts(publication: Uint8Array, request: Uint8Array) { return this.unwrap('openWithoutPinnedFonts', this.native.openWithoutPinnedFonts(toArrayBuffer(publication), toArrayBuffer(request))); }
  openShards(skeleton: Uint8Array, key: Uint8Array | undefined, request: Uint8Array, fonts: readonly RitoNativePinnedFontFace[]) { return this.unwrap('openShards', this.native.openShards(toArrayBuffer(skeleton), toArrayBuffer(key ?? new Uint8Array()), toArrayBuffer(request), fonts.map(toNitroFont))); }
  supplyShard(sessionId: bigint, shard: Uint8Array, key?: Uint8Array) { return this.unwrap('supplyShard', this.native.supplyShard(toExternalIdString(sessionId), toArrayBuffer(shard), toArrayBuffer(key ?? new Uint8Array()))); }
  contentShardsNear(sessionId: bigint, href: string) { return this.unwrap('contentShardsNear', this.native.contentShardsNear(toExternalIdString(sessionId), href)); }
  peekSpread(sessionId: bigint, request: Uint8Array) { return this.unwrap('peekSpread', this.native.peekSpread(toExternalIdString(sessionId), toArrayBuffer(request))); }
  resolveTextInteraction(sessionId: bigint, request: Uint8Array) { return this.unwrap('resolveTextInteraction', this.native.resolveTextInteraction(toExternalIdString(sessionId), toArrayBuffer(request))); }
  resolveAnnotation(sessionId: bigint, request: Uint8Array) { return this.unwrap('resolveAnnotation', this.native.resolveAnnotation(toExternalIdString(sessionId), toArrayBuffer(request))); }
  resolveNavigation(sessionId: bigint, request: Uint8Array) { return this.unwrap('resolveNavigation', this.native.resolveNavigation(toExternalIdString(sessionId), toArrayBuffer(request))); }
  fontCatalog(sessionId: bigint) { return this.unwrap('fontCatalog', this.native.fontCatalog(toExternalIdString(sessionId))); }
  unresolvedFontFamilies(sessionId: bigint, list: string) { return this.unwrap('unresolvedFontFamilies', this.native.unresolvedFontFamilies(toExternalIdString(sessionId), list)); }
  addHostFontFaces(sessionId: bigint, fonts: readonly RitoNativePinnedFontFace[]) { return this.unwrap('addHostFontFaces', this.native.addHostFontFaces(toExternalIdString(sessionId), fonts.map(toNitroFont))); }
  removeHostFontFaces(sessionId: bigint, sha256: readonly string[]) { return this.unwrap('removeHostFontFaces', this.native.removeHostFontFaces(toExternalIdString(sessionId), [...sha256])); }
  markFontFamilyUnavailable(sessionId: bigint, family: string) { return this.unwrap('markFontFamilyUnavailable', this.native.markFontFamilyUnavailable(toExternalIdString(sessionId), family)); }

  private async unwrap(operation: string, result: Promise<RitoNitroResult>): Promise<RitoNativeCallResult> {
    nativePerfMark(`rito.nitro.${operation}.start`);
    const response = await result;
    nativePerfMark(`rito.nitro.${operation}.end`);
    if (!(response.data instanceof ArrayBuffer)) throw new RitoNativeError(4, 'Rito Nitro returned a non-binary response.', operation);
    // Keep a view over Nitro's returned ArrayBuffer. The view retains the
    // backing buffer, so protocol decoding does not require another full copy.
    return { status: response.status as RitoNativeStatus, data: new Uint8Array(response.data), error: response.error || '' };
  }
}

class RitoNitroPaperTurnModule implements RitoNativePaperTurnModule {
  constructor(private readonly native: RitoNitroSpec) {}

  layouts() { return this.native.paperTurnLayouts(); }
  create() { return BigInt(this.native.paperTurnNew()); }
  free(turn: bigint) { this.native.paperTurnFree(toExternalIdString(turn)); }
  begin(turn: bigint, frame: readonly number[], leavesCapacity: number) { return this.native.paperTurnBegin(toExternalIdString(turn), [...frame], leavesCapacity); }
  lay(turn: bigint, epoch: number, leavesCapacity: number) { return this.native.paperTurnLay(toExternalIdString(turn), epoch, leavesCapacity); }
  sheet(turn: bigint, index: number, pointsCapacity: number) { return this.native.paperTurnSheet(toExternalIdString(turn), index, pointsCapacity); }
  forget(turn: bigint, epoch: number, leavesCapacity: number) { return this.native.paperTurnForget(toExternalIdString(turn), epoch, leavesCapacity); }
  state(turn: bigint, now: number) { return this.native.paperTurnState(toExternalIdString(turn), now); }
  begins(turn: bigint, dx: number, velocity: number, sameSpreads: boolean) { return this.native.paperTurnBegins(toExternalIdString(turn), dx, velocity, sameSpreads); }
  settle(turn: bigint, from: number, velocity: number, to: number) { return this.native.paperTurnSettle(toExternalIdString(turn), from, velocity, to); }
  settleStep(turn: bigint, settle: readonly number[], seconds: number, now: number) { return this.native.paperTurnSettleStep(toExternalIdString(turn), [...settle], seconds, now); }
  travel(touch: readonly number[], width: number, spine: number) { return this.native.paperTurnTravel([...touch], width, spine); }
  lands(release: readonly number[]) { return this.native.paperTurnLands([...release]); }
  eyeHeight(width: number, height: number) { return this.native.paperTurnEyeHeight(width, height); }
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  if (value.byteOffset === 0 && value.byteLength === value.buffer.byteLength && value.buffer instanceof ArrayBuffer) return value.buffer;
  return value.slice().buffer;
}
function toNitroFont(face: RitoNativePinnedFontFace): RitoNitroPinnedFontFace {
  return { bytes: toArrayBuffer(face.bytes), expectedSha256: face.expectedSha256, genericRole: face.genericRole === 'serif' ? 0 : face.genericRole === 'sansSerif' ? 1 : 2, language: face.language };
}
