import type { HybridObject } from 'react-native-nitro-modules'

export interface RitoNitroResult {
  status: number
  data: ArrayBuffer
  error: string
}

export interface RitoNitroPinnedFontFace {
  bytes: ArrayBuffer
  expectedSha256: string
  genericRole: number
  language?: string
}

/** Numbers a paper-turn call writes, with the leaf ids it lists. */
export interface RitoNitroPaperTurnLeaves {
  numbers: number[]
  leaves: number[]
}

/** One sheet of the frame last laid out: its numbers and, when asked, its points (float32 x, y, z each). */
export interface RitoNitroPaperTurnSheet {
  numbers: number[]
  positions?: ArrayBuffer
  normals?: ArrayBuffer
}

export interface RitoNitroPaperTurnForgotten {
  release: boolean
  leaves: number[]
}

export interface RitoNitroPaperTurnSettleStep {
  /** The settle the host holds, stepped in place. */
  settle: number[]
  /** x, velocity, done (1/0). */
  at: number[]
}

export interface RitoNitro extends HybridObject<{ android: 'c++', ios: 'c++' }> {
  open(
    publication: ArrayBuffer,
    request: ArrayBuffer,
    fonts: RitoNitroPinnedFontFace[],
  ): Promise<RitoNitroResult>
  readPublication(sessionId: string): Promise<RitoNitroResult>
  requestArtifact(sessionId: string, request: ArrayBuffer): Promise<RitoNitroResult>
  requestAdjacent(sessionId: string, request: ArrayBuffer): Promise<RitoNitroResult>
  peekAdjacent(sessionId: string, request: ArrayBuffer): Promise<RitoNitroResult>
  adoptForeground(sessionId: string, request: ArrayBuffer): Promise<RitoNitroResult>
  commitPeekedArtifact(sessionId: string, request: ArrayBuffer): Promise<RitoNitroResult>
  advanceBackground(sessionId: string, request: ArrayBuffer): Promise<RitoNitroResult>
  adoptBackground(sessionId: string, request: ArrayBuffer): Promise<RitoNitroResult>
  readResource(sessionId: string, artifactId: string, kind: number, href: string): Promise<RitoNitroResult>
  search(sessionId: string, request: ArrayBuffer): Promise<RitoNitroResult>
  textRangeGeometry(sessionId: string, request: ArrayBuffer): Promise<RitoNitroResult>
  resolveExactSourceRange(sessionId: string, request: ArrayBuffer): Promise<RitoNitroResult>
  readPage(sessionId: string, artifactId: string, pageIndex: number): Promise<RitoNitroResult>
  readFootnote(sessionId: string, artifactId: string, key: string): Promise<RitoNitroResult>
  releaseArtifact(sessionId: string, artifactId: string): Promise<RitoNitroResult>
  disposeSession(sessionId: string): Promise<RitoNitroResult>

  // Opening without a pinned font policy (rito_open).
  openWithoutPinnedFonts(publication: ArrayBuffer, request: ArrayBuffer): Promise<RitoNitroResult>
  // Sharded publications. An empty key means plain shards.
  openShards(
    skeleton: ArrayBuffer,
    key: ArrayBuffer,
    request: ArrayBuffer,
    fonts: RitoNitroPinnedFontFace[],
  ): Promise<RitoNitroResult>
  /** data holds the supplied shard's id as one little-endian u32. */
  supplyShard(sessionId: string, shard: ArrayBuffer, key: ArrayBuffer): Promise<RitoNitroResult>
  /** data holds shard ids as little-endian u32 values. */
  contentShardsNear(sessionId: string, href: string): Promise<RitoNitroResult>
  // Queries against a live artifact or the session.
  peekSpread(sessionId: string, request: ArrayBuffer): Promise<RitoNitroResult>
  resolveTextInteraction(sessionId: string, request: ArrayBuffer): Promise<RitoNitroResult>
  resolveAnnotation(sessionId: string, request: ArrayBuffer): Promise<RitoNitroResult>
  resolveNavigation(sessionId: string, request: ArrayBuffer): Promise<RitoNitroResult>
  // Host fonts.
  fontCatalog(sessionId: string): Promise<RitoNitroResult>
  unresolvedFontFamilies(sessionId: string, list: string): Promise<RitoNitroResult>
  addHostFontFaces(sessionId: string, fonts: RitoNitroPinnedFontFace[]): Promise<RitoNitroResult>
  /** Each digest is 64 lowercase hexadecimal digits. */
  removeHostFontFaces(sessionId: string, sha256: string[]): Promise<RitoNitroResult>
  markFontFamilyUnavailable(sessionId: string, family: string): Promise<RitoNitroResult>

  // The paper page turn's model (rito-turn). Synchronous: a host calls these
  // frame by frame, not through a session's actor. Handles are decimal u64
  // strings; failures throw.
  paperTurnLayouts(): number[]
  paperTurnNew(): string
  paperTurnFree(turn: string): void
  paperTurnBegin(turn: string, frame: number[], leavesCapacity: number): RitoNitroPaperTurnLeaves
  paperTurnLay(turn: string, epoch: number, leavesCapacity: number): RitoNitroPaperTurnLeaves
  /** pointsCapacity is in floats per array; 0 leaves the points out. */
  paperTurnSheet(turn: string, index: number, pointsCapacity: number): RitoNitroPaperTurnSheet
  paperTurnForget(turn: string, epoch: number, leavesCapacity: number): RitoNitroPaperTurnForgotten
  paperTurnState(turn: string, now: number): number[]
  paperTurnBegins(turn: string, dx: number, velocity: number, sameSpreads: boolean): number[]
  paperTurnSettle(turn: string, from: number, velocity: number, to: number): number[]
  paperTurnSettleStep(turn: string, settle: number[], seconds: number, now: number): RitoNitroPaperTurnSettleStep
  paperTurnTravel(touch: number[], width: number, spine: number): number
  paperTurnLands(release: number[]): boolean
  paperTurnEyeHeight(width: number, height: number): number
}
