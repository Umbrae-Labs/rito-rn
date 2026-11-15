import { RitoNativeError, RitoNativeSessionInvalidatedError, RitoResourcePendingError, type RitoNativeStatus } from './errors';
import { getRitoNativeReaderModule, type RitoNativeCallResult, type RitoNativePinnedFontFace, type RitoNativeReaderModule } from './native';
import { decodeRitoArtifact, decodeRitoPageRecords, decodeRitoResource } from './protocol/artifact';
import { decodeRitoPublication } from './protocol/publication';
import { decodeRitoBackgroundAdvance, decodeRitoBackgroundHandoffAck, decodeRitoForegroundHandoffAck } from './protocol/handoff';
import {
  encodeRitoAdjacentRequest, encodeRitoArtifactRequest, encodeRitoBackgroundHandoff, encodeRitoBackgroundRequest,
  encodeRitoForegroundHandoff, type RitoAdjacentRequest, type RitoArtifactRequest, type RitoBackgroundHandoff,
  type RitoBackgroundRequest, type RitoForegroundHandoff,
} from './protocol/requests';
import type { RitoArtifact, RitoBackgroundAdvance, RitoBackgroundHandoffAck, RitoForegroundHandoffAck, RitoPageRecords, RitoPublication, RitoResource } from './protocol/artifact-types';
import {
  decodeRitoAnnotationResponse, decodeRitoFontCatalog, decodeRitoFontNames, decodeRitoNavigationResult,
  decodeRitoPendingShards, decodeRitoShardIds, decodeRitoTextInteractionResponse, encodeRitoAnnotationRequest,
  encodeRitoNavigationRequest, encodeRitoSpreadRequest, encodeRitoTextInteractionRequest,
  type RitoAnnotationRequest, type RitoAnnotationResponse, type RitoFontCatalog, type RitoNavigationRequest,
  type RitoNavigationResult, type RitoSpreadRequest, type RitoTextInteractionRequest, type RitoTextInteractionResponse,
} from './protocol/queries';
import { decodeRitoExactSourceRangeResolution, decodeRitoFootnote, decodeRitoSearchResponse, decodeRitoTextRangeGeometry, encodeRitoExactSourceRangeRequest, encodeRitoSearchRequest, encodeRitoTextRangeRequest, type RitoExactSourceRangeRequest, type RitoExactSourceRangeResolution, type RitoFootnote, type RitoSearchRequest, type RitoSearchResponse, type RitoTextRangeGeometry, type RitoTextRangeRequest } from './protocol/interaction';

const STATUS_OK = 0;
const STATUS_TARGET_NOT_PUBLISHED = 6;
const STATUS_ADJACENT_PENDING = 10;
const STATUS_RESOURCE_PENDING = 12;

export interface RitoReaderSessionOptions { readonly native?: RitoNativeReaderModule; readonly maxContinuationQuanta?: number }

/** TypeScript session façade matching the ownership semantics of rito_flutter. */
export class RitoReaderSession {
  private readonly native: RitoNativeReaderModule;
  private readonly maxContinuationQuanta: number;
  private visibleArtifactId?: bigint;
  private readonly peekedArtifacts = new Map<string, RitoArtifact>();
  private readonly artifacts = new Map<bigint, RitoArtifact>();
  private readonly resourceCache = new Map<string, Promise<RitoResource>>();
  private readonly backgroundCandidates = new Map<bigint, RitoArtifact>();
  private readonly pendingForeground = new Map<bigint, NavigationToken>();
  private latestForegroundRequestId = 0n;
  private foregroundGeneration = 0;
  private activeNavigation?: NavigationToken;
  private invalidation?: RitoNativeSessionInvalidatedError;
  private disposePromise?: Promise<void>;
  private backgroundTail: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(readonly sessionId: bigint, options: RitoReaderSessionOptions = {}) {
    if (sessionId <= 0n) throw new RangeError('Rito sessionId must be positive.');
    this.native = options.native ?? getRitoNativeReaderModule();
    this.maxContinuationQuanta = options.maxContinuationQuanta ?? 4096;
  }

  static async open(publication: Uint8Array, request: RitoArtifactRequest, fonts: readonly RitoNativePinnedFontFace[], options: RitoReaderSessionOptions = {}): Promise<{ readonly session: RitoReaderSession; readonly artifact: RitoArtifact }> {
    return RitoReaderSession.openWith(request, options, 'open', (native, encoded) => native.open(publication, encoded, fonts));
  }

  /**
   * Opens a publication split by `@ritojs/pack` from its skeleton shard. The
   * skeleton carries everything layout reads; a resource read that needs a
   * content shard rejects with RitoResourcePendingError until supplyShard
   * hands it over. `key` is the skeleton's 32-byte key for encrypted shards.
   */
  static async openShards(skeleton: Uint8Array, key: Uint8Array | undefined, request: RitoArtifactRequest, fonts: readonly RitoNativePinnedFontFace[], options: RitoReaderSessionOptions = {}): Promise<{ readonly session: RitoReaderSession; readonly artifact: RitoArtifact }> {
    if (key !== undefined && key.byteLength !== 32) throw new RangeError('A Rito shard key must be 32 bytes.');
    return RitoReaderSession.openWith(request, options, 'openShards', (native, encoded) => native.openShards(skeleton, key, encoded, fonts));
  }

  /**
   * Opens without a pinned font policy (rito_open). Chapter-local pagination
   * shapes with pinned faces only, so the engine fails such an open closed;
   * hosts use open. Bound for completeness of the ABI.
   */
  static async openWithoutPinnedFonts(publication: Uint8Array, request: RitoArtifactRequest, options: RitoReaderSessionOptions = {}): Promise<{ readonly session: RitoReaderSession; readonly artifact: RitoArtifact }> {
    return RitoReaderSession.openWith(request, options, 'openWithoutPinnedFonts', (native, encoded) => native.openWithoutPinnedFonts(publication, encoded));
  }

  private static async openWith(
    request: RitoArtifactRequest,
    options: RitoReaderSessionOptions,
    operation: string,
    call: (native: RitoNativeReaderModule, request: Uint8Array) => Promise<RitoNativeCallResult>,
  ): Promise<{ readonly session: RitoReaderSession; readonly artifact: RitoArtifact }> {
    const native = options.native ?? getRitoNativeReaderModule();
    const session = new RitoReaderSession(request.sessionId, { ...options, native });
    try {
      const response = await call(native, encodeRitoArtifactRequest(request));
      if (response.status !== STATUS_OK) throw nativeError(response, operation);
      const artifact = decodeRitoArtifact(response.data);
      if (artifact.sessionId !== request.sessionId) throw new RitoNativeError(4, 'Rito open artifact session ID does not match the request.', operation);
      // The opening artifact has already consumed the request ID supplied to
      // native open. Publish it to the session allocator before any later
      // turn asks for nextRequestId.
      session.latestForegroundRequestId = artifact.requestId;
      session.rememberArtifact(artifact);
      await session.adoptForeground({
        sessionId: request.sessionId,
        candidateArtifactId: artifact.artifactId,
      });
      return { session, artifact };
    } catch (error) {
      await native.dispose(request.sessionId).catch(() => undefined);
      throw error;
    }
  }

  async readPublication(): Promise<RitoPublication> {
    const publication = decodeRitoPublication(await this.success('readPublication', () => this.native.readPublication(this.sessionId)));
    if (publication.sessionId !== this.sessionId) throw new RitoNativeError(4, 'Rito publication identity does not match the session.', 'readPublication');
    return publication;
  }

  async requestArtifact(request: RitoArtifactRequest): Promise<RitoArtifact> {
    this.assertSession(request.sessionId);
    const navigation = this.beginNavigation(request.requestId);
    try {
        const result = await this.native.requestArtifact(this.sessionId, encodeRitoArtifactRequest(request));
        this.recordConsumedRequestId(request.requestId);
        if (result.status !== STATUS_OK) throw nativeError(result, 'requestArtifact');
        const artifact = this.decodeCandidate(result.data, request.requestId, 'requestArtifact');
        this.recordConsumedRequestId(artifact.requestId);
        if (navigation.superseded) {
          await this.releaseOrInvalidate(artifact, navigation.requestId);
          throw navigation.error;
        }
        navigation.pendingArtifactId = artifact.artifactId;
        this.pendingForeground.set(artifact.artifactId, navigation);
        return artifact;
    } finally {
      if (navigation.pendingArtifactId === undefined) this.finishNavigation(navigation);
    }
  }

  async requestAdjacent(request: RitoAdjacentRequest): Promise<RitoArtifact> {
    this.assertSession(request.sessionId);
    const navigation = this.beginNavigation(request.requestId);
    let current = request;
    try {
      for (let index = 0; index < this.maxContinuationQuanta; index += 1) {
        const result = await this.native.requestAdjacent(this.sessionId, encodeRitoAdjacentRequest(current));
        this.recordConsumedRequestId(current.requestId);
        if (result.status === STATUS_ADJACENT_PENDING) {
          current = { ...current, requestId: current.requestId + 1n };
          await yieldHostTurn();
          continue;
        }
        if (result.status !== STATUS_OK) throw nativeError(result, 'requestAdjacent');
        const artifact = this.decodeCandidate(result.data, current.requestId, 'requestAdjacent');
        this.recordConsumedRequestId(artifact.requestId);
        if (navigation.superseded) {
          await this.releaseOrInvalidate(artifact, navigation.requestId);
          throw navigation.error;
        }
        navigation.pendingArtifactId = artifact.artifactId;
        this.pendingForeground.set(artifact.artifactId, navigation);
        return artifact;
      }
      throw new RitoNativeError(10, 'Rito adjacent navigation exceeded the continuation limit.', 'requestAdjacent');
    } finally {
      if (navigation.pendingArtifactId === undefined) this.finishNavigation(navigation);
    }
  }

  /**
   * Resolves a neighboring artifact without changing the visible artifact.
   * The returned artifact remains owned by this session and can be committed
   * with commitPeekedArtifact or released with releaseArtifact.
   */
  async peekAdjacent(request: RitoAdjacentRequest): Promise<RitoArtifact | undefined> {
    this.assertSession(request.sessionId);
    this.assertArtifact(request.fromArtifactId);
    if (this.activeNavigation) throw new RitoNativeError(8, 'Neighbor preview must yield to foreground navigation.', 'peekAdjacent');
    const generation = this.foregroundGeneration;
    const result = await this.native.peekAdjacent(
      this.sessionId,
      encodeRitoAdjacentRequest(request),
    );
    this.recordConsumedRequestId(request.requestId);
    if (result.status === STATUS_TARGET_NOT_PUBLISHED) return undefined;
    if (result.status !== STATUS_OK) throw nativeError(result, 'peekAdjacent');
    const artifact = this.decodeCandidate(result.data, request.requestId, 'peekAdjacent');
    if (generation !== this.foregroundGeneration) {
      await this.native.releaseArtifact(this.sessionId, artifact.artifactId).catch(() => undefined);
      throw new RitoNativeError(5, 'Peek request was superseded by foreground navigation.', 'peekAdjacent');
    }
    this.rememberArtifact(artifact);
    const key = peekKey(request.fromArtifactId, request.direction);
    const previous = this.peekedArtifacts.get(key);
    this.peekedArtifacts.set(key, artifact);
    if (previous && previous.artifactId !== artifact.artifactId) {
      await this.releaseArtifact(previous.artifactId).catch(() => undefined);
    }
    return artifact;
  }

  /**
   * Publishes one spread of the revision behind an artifact, by its position
   * in that revision's layout (resolveNavigation's `layout` query lists them),
   * without changing the visible artifact. The result is owned like a peek:
   * commit it with commitPeekedArtifact or release it.
   */
  async peekSpread(request: RitoSpreadRequest): Promise<RitoArtifact> {
    this.assertSession(request.sessionId);
    this.assertArtifact(request.fromArtifactId);
    if (!Number.isInteger(request.spreadIndex) || request.spreadIndex < 0 || request.spreadIndex > 0xffff_ffff) throw new RangeError('Rito spread index must be a u32.');
    if (this.activeNavigation) throw new RitoNativeError(8, 'Spread preview must yield to foreground navigation.', 'peekSpread');
    const generation = this.foregroundGeneration;
    const result = await this.native.peekSpread(this.sessionId, encodeRitoSpreadRequest(request));
    this.recordConsumedRequestId(request.requestId);
    if (result.status !== STATUS_OK) throw nativeError(result, 'peekSpread');
    const artifact = this.decodeCandidate(result.data, request.requestId, 'peekSpread');
    if (generation !== this.foregroundGeneration) {
      await this.native.releaseArtifact(this.sessionId, artifact.artifactId).catch(() => undefined);
      this.artifacts.delete(artifact.artifactId);
      throw new RitoNativeError(5, 'Spread peek was superseded by foreground navigation.', 'peekSpread');
    }
    const key = `${request.fromArtifactId.toString()}:spread:${request.spreadIndex}`;
    const previous = this.peekedArtifacts.get(key);
    this.peekedArtifacts.set(key, artifact);
    if (previous && previous.artifactId !== artifact.artifactId) {
      await this.releaseArtifact(previous.artifactId).catch(() => undefined);
    }
    return artifact;
  }

  async adoptForeground(request: RitoForegroundHandoff): Promise<RitoForegroundHandoffAck> {
    this.assertSession(request.sessionId);
    const navigation = this.pendingForeground.get(request.candidateArtifactId);
    if (navigation?.superseded) {
      this.pendingForeground.delete(request.candidateArtifactId);
      this.finishNavigation(navigation);
      await this.releaseOrInvalidate({ artifactId: request.candidateArtifactId }, request.candidateArtifactId);
      throw navigation.error;
    }
    this.foregroundGeneration += 1;
    let ack: RitoForegroundHandoffAck;
    try {
      ack = decodeRitoForegroundHandoffAck(await this.success('adoptForeground', () => this.native.adoptForeground(this.sessionId, encodeRitoForegroundHandoff(request))));
    } catch (error) {
      this.pendingForeground.delete(request.candidateArtifactId);
      if (navigation) this.finishNavigation(navigation);
      await this.releaseOrInvalidate({ artifactId: request.candidateArtifactId }, request.candidateArtifactId);
      throw error;
    }
    if (ack.visibleArtifactId !== request.candidateArtifactId) {
      this.pendingForeground.delete(request.candidateArtifactId);
      if (navigation) this.finishNavigation(navigation);
      await this.releaseOrInvalidate({ artifactId: request.candidateArtifactId }, request.candidateArtifactId);
      throw new RitoNativeError(4, 'Foreground handoff acknowledgement does not match the candidate.', 'adoptForeground');
    }
    this.visibleArtifactId = ack.visibleArtifactId;
    this.pendingForeground.delete(request.candidateArtifactId);
    if (navigation) this.finishNavigation(navigation);
    await this.clearPeekedArtifacts(request.candidateArtifactId);
    return ack;
  }

  /** Commits a previously peeked artifact with the native compare-and-swap. */
  async commitPeekedArtifact(request: RitoForegroundHandoff): Promise<RitoForegroundHandoffAck> {
    this.assertSession(request.sessionId);
    this.foregroundGeneration += 1;
    let ack: RitoForegroundHandoffAck;
    try {
      ack = decodeRitoForegroundHandoffAck(
        await this.success(
          'commitPeekedArtifact',
          () => this.native.commitPeekedArtifact(this.sessionId, encodeRitoForegroundHandoff(request)),
        ),
      );
    } catch (error) {
      await this.releaseCachedPeek(request.candidateArtifactId);
      throw error;
    }
    if (
      ack.visibleArtifactId !== request.candidateArtifactId ||
      ack.replacedArtifactId !== request.expectedVisibleArtifactId
    ) {
      await this.releaseCachedPeek(request.candidateArtifactId);
      throw new RitoNativeError(4, 'Peeked foreground acknowledgement does not match the handoff.', 'commitPeekedArtifact');
    }
    this.visibleArtifactId = ack.visibleArtifactId;
    await this.clearPeekedArtifacts(request.candidateArtifactId);
    return ack;
  }

  /** Uses a cached peek when available, otherwise requests and adopts a neighbor. */
  async turn(request: RitoAdjacentRequest): Promise<RitoArtifact> {
    this.assertSession(request.sessionId);
    this.assertArtifact(request.fromArtifactId);
    const key = peekKey(request.fromArtifactId, request.direction);
    const cached = this.peekedArtifacts.get(key);
    if (cached && this.visibleArtifactId === request.fromArtifactId) {
      try {
        await this.commitPeekedArtifact({
          sessionId: request.sessionId,
          expectedVisibleArtifactId: request.fromArtifactId,
          candidateArtifactId: cached.artifactId,
        });
        return cached;
      } catch (error) {
        if (error instanceof RitoNativeSessionInvalidatedError) throw error;
      }
    }
    const staleCached = this.peekedArtifacts.get(key);
    if (staleCached) {
      this.peekedArtifacts.delete(key);
      await this.releaseArtifact(staleCached.artifactId).catch(() => undefined);
    }
    const artifact = await this.requestAdjacent(request);
    await this.adoptForeground({
      sessionId: request.sessionId,
      expectedVisibleArtifactId: request.fromArtifactId,
      candidateArtifactId: artifact.artifactId,
    });
    return artifact;
  }

  async advanceBackground(request: RitoBackgroundRequest): Promise<RitoBackgroundAdvance> {
    const run = this.backgroundTail.then(
      () => this.advanceBackgroundOnce(request),
      () => this.advanceBackgroundOnce(request),
    );
    this.backgroundTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async advanceBackgroundOnce(request: RitoBackgroundRequest): Promise<RitoBackgroundAdvance> {
    this.assertSession(request.sessionId);
    if (this.activeNavigation) throw new RitoNativeError(8, 'Background pagination must yield to foreground navigation.', 'advanceBackground');
    const generation = this.foregroundGeneration;
    const advance = decodeRitoBackgroundAdvance(await this.success('advanceBackground', () => this.native.advanceBackground(this.sessionId, encodeRitoBackgroundRequest(request))));
    if (advance.intentRequestId <= 0n || (advance.artifact && advance.artifact.sessionId !== this.sessionId)) {
      throw new RitoNativeError(4, 'Background artifact identity does not match the session.', 'advanceBackground');
    }
    if (advance.artifact) {
      this.rememberArtifact(advance.artifact);
      this.backgroundCandidates.set(advance.artifact.artifactId, advance.artifact);
      if (generation !== this.foregroundGeneration || this.activeNavigation) {
        await this.releaseOrInvalidate(advance.artifact, advance.intentRequestId);
        throw new RitoNativeError(5, 'Background candidate was superseded by foreground navigation.', 'advanceBackground');
      }
    }
    return advance;
  }

  async adoptBackground(request: RitoBackgroundHandoff): Promise<RitoBackgroundHandoffAck> {
    this.assertSession(request.sessionId);
    if (this.activeNavigation) throw new RitoNativeError(8, 'Background adoption must yield to foreground navigation.', 'adoptBackground');
    const candidate = this.backgroundCandidates.get(request.candidateArtifactId);
    if (!candidate) throw new RitoNativeError(1, 'Background candidate is not owned by this session.', 'adoptBackground');
    if (this.visibleArtifactId !== request.expectedVisibleArtifactId) {
      await this.releaseOrInvalidate(candidate, request.candidateArtifactId);
      throw new RitoNativeError(5, 'Background candidate no longer matches the visible artifact.', 'adoptBackground');
    }
    this.foregroundGeneration += 1;
    let ack: RitoBackgroundHandoffAck;
    try {
      ack = decodeRitoBackgroundHandoffAck(await this.success('adoptBackground', () => this.native.adoptBackground(this.sessionId, encodeRitoBackgroundHandoff(request))));
    } catch (error) {
      await this.releaseOrInvalidate(candidate, request.candidateArtifactId);
      throw error;
    }
    if (ack.visibleArtifactId !== request.candidateArtifactId) {
      await this.releaseOrInvalidate(candidate, request.candidateArtifactId);
      throw new RitoNativeError(4, 'Background handoff acknowledgement does not match the candidate.', 'adoptBackground');
    }
    this.visibleArtifactId = ack.visibleArtifactId;
    this.backgroundCandidates.delete(request.candidateArtifactId);
    await this.clearPeekedArtifacts(request.candidateArtifactId);
    return ack;
  }

  async readResource(artifactId: bigint, kind: number, href: string): Promise<RitoResource> {
    this.assertArtifact(artifactId);
    if (!href) throw new RangeError('Rito resource href must not be empty.');
    const expectedKind = resourceKind(kind);
    const key = `${artifactId.toString()}:${kind}:${href}`;
    const cached = this.resourceCache.get(key);
    if (cached) return cached;
    const pending = this.success(
      'readResource',
      () => this.native.readResource(this.sessionId, artifactId, kind, href),
    ).then((data) => {
      const resource = decodeRitoResource(data);
      if (resource.artifactId !== artifactId || resource.href !== href || resource.kind !== expectedKind) {
        throw new RitoNativeError(4, 'Rito resource identity does not match the request.', 'readResource');
      }
      const artifact = this.artifacts.get(artifactId);
      const declaration = artifact?.fonts.find((font) => expectedKind === 'font' && font.href === href);
      if (declaration && declaration.byteLength !== BigInt(resource.bytes.byteLength)) {
        throw new RitoNativeError(4, 'Rito font resource length does not match its artifact declaration.', 'readResource');
      }
      return resource;
    });
    this.resourceCache.set(key, pending);
    try {
      return await pending;
    } catch (error) {
      this.resourceCache.delete(key);
      throw error;
    }
  }
  async search(request: RitoSearchRequest): Promise<RitoSearchResponse> { this.assertSession(request.sessionId); this.assertArtifact(request.artifactId); const response = decodeRitoSearchResponse(await this.success('search', () => this.native.search(this.sessionId, encodeRitoSearchRequest(request)))); if (response.artifactId !== request.artifactId || response.query !== request.query) throw new RitoNativeError(4, 'Search response does not match the request.', 'search'); return response; }
  async textRangeGeometry(request: RitoTextRangeRequest): Promise<RitoTextRangeGeometry> { this.assertSession(request.sessionId); this.assertArtifact(request.artifactId); const response = decodeRitoTextRangeGeometry(await this.success('textRangeGeometry', () => this.native.textRangeGeometry(this.sessionId, encodeRitoTextRangeRequest(request)))); if (response.artifactId !== request.artifactId || response.pageIndex !== request.pageIndex) throw new RitoNativeError(4, 'Text geometry response does not match the request.', 'textRangeGeometry'); return response; }
  async resolveExactSourceRange(request: RitoExactSourceRangeRequest): Promise<RitoExactSourceRangeResolution> { this.assertSession(request.sessionId); this.assertArtifact(request.artifactId); const response = decodeRitoExactSourceRangeResolution(await this.success('resolveExactSourceRange', () => this.native.resolveExactSourceRange(this.sessionId, encodeRitoExactSourceRangeRequest(request)))); if (response.artifactId !== request.artifactId) throw new RitoNativeError(4, 'Exact source range response does not match the request.', 'resolveExactSourceRange'); return response; }
  /**
   * Resolves one text selection query (a caret at a point, the range between
   * two carets, a kept caret extended to a point, a range widened to words or
   * paragraphs, or a caret movement) the way a browser reader does.
   */
  async resolveTextInteraction(request: RitoTextInteractionRequest): Promise<RitoTextInteractionResponse> {
    this.assertSession(request.sessionId);
    this.assertArtifact(request.artifactId);
    const response = decodeRitoTextInteractionResponse(await this.success('resolveTextInteraction', () => this.native.resolveTextInteraction(this.sessionId, encodeRitoTextInteractionRequest(request))));
    if (response.artifactId !== request.artifactId) throw new RitoNativeError(4, 'Text interaction response does not match the request.', 'resolveTextInteraction');
    return response;
  }
  /** Builds an annotation target for a source range, or locates a stored one; the target is the engine's canonical JSON to persist. */
  async resolveAnnotation(request: RitoAnnotationRequest): Promise<RitoAnnotationResponse> {
    this.assertSession(request.sessionId);
    return decodeRitoAnnotationResponse(await this.success('resolveAnnotation', () => this.native.resolveAnnotation(this.sessionId, encodeRitoAnnotationRequest(request))));
  }
  /**
   * Answers a reading-position question: the TOC entry a page or a source
   * position reads under, where a stored locator lands, the reading order of
   * two source positions, or the page table of an artifact's revision.
   */
  async resolveNavigation(request: RitoNavigationRequest): Promise<RitoNavigationResult> {
    this.assertSession(request.sessionId);
    const query = request.query;
    if ('artifactId' in query) this.assertArtifact(query.artifactId);
    return decodeRitoNavigationResult(await this.success('resolveNavigation', () => this.native.resolveNavigation(this.sessionId, encodeRitoNavigationRequest(request))));
  }
  /** Every family a font-family list can name in this session, host families first. */
  async fontCatalog(): Promise<RitoFontCatalog> {
    return decodeRitoFontCatalog(await this.success('fontCatalog', () => this.native.fontCatalog(this.sessionId)));
  }
  /** The names in a CSS font-family list that no family in the catalog answers to. */
  async unresolvedFontFamilies(list: string): Promise<readonly string[]> {
    return decodeRitoFontNames(await this.success('unresolvedFontFamilies', () => this.native.unresolvedFontFamilies(this.sessionId, list)));
  }
  /** Adds host faces; the next request lays out with them nameable, published artifacts keep their layout. */
  async addHostFontFaces(fonts: readonly RitoNativePinnedFontFace[]): Promise<void> {
    if (fonts.length === 0) throw new RangeError('At least one Rito host font face is required.');
    await this.success('addHostFontFaces', () => this.native.addHostFontFaces(this.sessionId, fonts));
  }
  /** Removes host faces by their SHA-256 digests; at least one face must remain. */
  async removeHostFontFaces(sha256: readonly string[]): Promise<void> {
    if (sha256.length === 0) throw new RangeError('At least one Rito font digest is required.');
    await this.success('removeHostFontFaces', () => this.native.removeHostFontFaces(this.sessionId, sha256));
  }
  /** Marks a publication face this host cannot paint, so the next request lays out without it. */
  async markFontFamilyUnavailable(family: string): Promise<void> {
    if (!family) throw new RangeError('Rito font family must not be empty.');
    await this.success('markFontFamilyUnavailable', () => this.native.markFontFamilyUnavailable(this.sessionId, family));
  }
  /** Hands a session opened from shards one content shard; returns its id. Supplying a shard twice is harmless. */
  async supplyShard(shard: Uint8Array, key?: Uint8Array): Promise<number> {
    if (shard.byteLength === 0) throw new RangeError('A Rito shard must not be empty.');
    if (key !== undefined && key.byteLength !== 32) throw new RangeError('A Rito shard key must be 32 bytes.');
    const ids = decodeRitoShardIds(await this.success('supplyShard', () => this.native.supplyShard(this.sessionId, shard, key)));
    if (ids.length !== 1) throw new RitoNativeError(4, 'Rito supplyShard did not return one shard id.', 'supplyShard');
    return ids[0]!;
  }
  /** Every content shard id, ordered for fetching ahead of need from the chapter at `href`; empty for an archive. */
  async contentShardsNear(href: string): Promise<readonly number[]> {
    if (!href) throw new RangeError('Rito content shard href must not be empty.');
    return decodeRitoShardIds(await this.success('contentShardsNear', () => this.native.contentShardsNear(this.sessionId, href)));
  }
  /** Reads what one page of a live artifact holds: its hits, semantic outline, text and text runs. */
  async readPage(artifactId: bigint, pageIndex: number): Promise<RitoPageRecords> {
    this.assertArtifact(artifactId);
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex > 0xffff_ffff) throw new RangeError('Rito page index must be a u32.');
    const records = decodeRitoPageRecords(await this.success('readPage', () => this.native.readPage(this.sessionId, artifactId, pageIndex)));
    if (records.artifactId !== artifactId || records.pageIndex !== pageIndex) throw new RitoNativeError(4, 'Page records do not match the request.', 'readPage');
    return records;
  }
  async readFootnote(artifactId: bigint, key: string): Promise<RitoFootnote> { this.assertArtifact(artifactId); const response = decodeRitoFootnote(await this.success('readFootnote', () => this.native.readFootnote(this.sessionId, artifactId, key))); if (response.artifactId !== artifactId || response.key !== key) throw new RitoNativeError(4, 'Footnote response does not match the request.', 'readFootnote'); return response; }
  async releaseArtifact(artifactId: bigint): Promise<void> {
    this.assertArtifact(artifactId);
    try {
      const result = await this.native.releaseArtifact(this.sessionId, artifactId);
      if (result.status !== STATUS_OK && result.status !== 2) throw nativeError(result, 'releaseArtifact');
    } catch (error) {
      return this.failClosed(artifactId, error);
    }
    this.forgetArtifact(artifactId);
  }

  async dispose(): Promise<void> {
    if (this.invalidation) throw this.invalidation;
    if (this.disposed) return;
    try {
      await this.disposeNative();
    } finally {
      this.disposed = true;
      this.visibleArtifactId = undefined;
      this.peekedArtifacts.clear();
      this.resourceCache.clear();
      this.artifacts.clear();
      this.backgroundCandidates.clear();
      this.pendingForeground.clear();
    }
  }

  get currentVisibleArtifactId(): bigint | undefined { return this.visibleArtifactId; }
  /** The artifact currently committed as foreground content. */
  get currentVisibleArtifact(): RitoArtifact | undefined {
    return this.visibleArtifactId === undefined
      ? undefined
      : this.artifacts.get(this.visibleArtifactId);
  }
  /** Reads an artifact still owned by this session. */
  getArtifact(artifactId: bigint): RitoArtifact | undefined {
    return this.artifacts.get(artifactId);
  }
  get latestRequestId(): bigint { return this.latestForegroundRequestId; }
  get nextRequestId(): bigint { if (this.latestForegroundRequestId >= 0x7fff_ffff_ffff_ffffn) throw new RangeError('Rito request ID space is exhausted.'); return this.latestForegroundRequestId + 1n; }

  private recordConsumedRequestId(requestId: bigint): void {
    if (requestId > this.latestForegroundRequestId) this.latestForegroundRequestId = requestId;
  }

  private async success(operation: string, call: () => Promise<RitoNativeCallResult>): Promise<Uint8Array> { const result = await call(); if (result.status !== STATUS_OK) throw nativeError(result, operation); return result.data; }
  private decodeCandidate(data: Uint8Array, requestId: bigint, operation: string): RitoArtifact { const artifact = decodeRitoArtifact(data); if (artifact.sessionId !== this.sessionId || artifact.requestId !== requestId) throw new RitoNativeError(4, 'Rito artifact identity does not match the request.', operation); this.rememberArtifact(artifact); return artifact; }
  private rememberArtifact(artifact: RitoArtifact): void { this.artifacts.set(artifact.artifactId, artifact); }
  private beginNavigation(requestId: bigint): NavigationToken {
    this.assertSession(this.sessionId);
    if (requestId <= 0n) throw new RangeError('Rito foreground request ID must be positive.');
    if (requestId <= this.latestForegroundRequestId) throw new RangeError(`Rito request ID must be greater than ${this.latestForegroundRequestId.toString()}.`);
    this.latestForegroundRequestId = requestId;
    this.foregroundGeneration += 1;
    this.activeNavigation && (this.activeNavigation.superseded = true);
    const navigation = new NavigationToken(requestId, this.latestForegroundRequestId);
    this.activeNavigation = navigation;
    if (this.peekedArtifacts.size > 0) {
      void this.clearPeekedArtifacts();
    }
    return navigation;
  }
  private finishNavigation(navigation: NavigationToken): void {
    if (this.activeNavigation === navigation) this.activeNavigation = undefined;
  }
  private async releaseOrInvalidate(artifact: Pick<RitoArtifact, 'artifactId'>, requestId: bigint): Promise<void> {
    try {
      const result = await this.native.releaseArtifact(this.sessionId, artifact.artifactId);
      if (result.status !== STATUS_OK && result.status !== 2) throw nativeError(result, 'releaseArtifact');
      this.forgetArtifact(artifact.artifactId);
    } catch (error) {
      return this.failClosed(requestId, error);
    }
  }
  private async failClosed(requestId: bigint, cleanupError: unknown): Promise<never> {
    if (this.invalidation) throw this.invalidation;
    this.disposed = true;
    let disposeError: unknown;
    try {
      await this.disposeNative();
    } catch (error) {
      disposeError = error;
    }
    this.invalidation = new RitoNativeSessionInvalidatedError(requestId, cleanupError, disposeError);
    this.visibleArtifactId = undefined;
    this.peekedArtifacts.clear();
    this.resourceCache.clear();
    this.artifacts.clear();
    this.backgroundCandidates.clear();
    this.pendingForeground.clear();
    throw this.invalidation;
  }
  private async disposeNative(): Promise<void> {
    if (!this.disposePromise) {
      this.disposePromise = (async () => {
        const result = await this.native.dispose(this.sessionId);
        if (result.status !== STATUS_OK && result.status !== 2) throw nativeError(result, 'dispose');
      })();
    }
    return this.disposePromise;
  }
  private forgetArtifact(artifactId: bigint): void {
    for (const [key, artifact] of this.peekedArtifacts) if (artifact.artifactId === artifactId) this.peekedArtifacts.delete(key);
    for (const key of this.resourceCache.keys()) if (key.startsWith(`${artifactId.toString()}:`)) this.resourceCache.delete(key);
    this.artifacts.delete(artifactId);
    this.backgroundCandidates.delete(artifactId);
    const navigation = this.pendingForeground.get(artifactId);
    this.pendingForeground.delete(artifactId);
    if (navigation) this.finishNavigation(navigation);
    if (this.visibleArtifactId === artifactId) this.visibleArtifactId = undefined;
  }
  private async clearPeekedArtifacts(keepArtifactId?: bigint): Promise<void> {
    const pending = [...this.peekedArtifacts.values()];
    this.peekedArtifacts.clear();
    for (const artifact of pending) {
      if (artifact.artifactId === keepArtifactId) continue;
      this.artifacts.delete(artifact.artifactId);
      for (const key of this.resourceCache.keys()) if (key.startsWith(`${artifact.artifactId.toString()}:`)) this.resourceCache.delete(key);
    }
    await Promise.all(
      pending
        .filter((artifact) => artifact.artifactId !== keepArtifactId)
        .map((artifact) => this.native.releaseArtifact(this.sessionId, artifact.artifactId).catch(() => undefined)),
    );
  }
  private async releaseCachedPeek(artifactId: bigint): Promise<void> {
    let found = false;
    for (const [key, artifact] of this.peekedArtifacts) {
      if (artifact.artifactId === artifactId) {
        this.peekedArtifacts.delete(key);
        found = true;
      }
    }
    if (found) await this.releaseOrInvalidate({ artifactId }, artifactId);
  }
  private assertSession(sessionId: bigint): void { if (this.invalidation) throw this.invalidation; if (this.disposed) throw new Error('Rito reader session has been disposed.'); if (sessionId !== this.sessionId) throw new RitoNativeError(1, 'Rito request session ID does not match the session.', 'session'); }
  private assertArtifact(artifactId: bigint): void { this.assertSession(this.sessionId); if (artifactId <= 0n) throw new RitoNativeError(1, 'Rito artifact ID must be positive.', 'artifact'); }
}

function peekKey(artifactId: bigint, direction: RitoAdjacentRequest['direction']): string {
  return `${artifactId.toString()}:${direction}`;
}

function yieldHostTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function resourceKind(kind: number): RitoResource['kind'] {
  if (kind === 0) return 'image';
  if (kind === 1) return 'font';
  if (kind === 2) return 'stylesheet';
  throw new RangeError('Rito resource kind must be 0, 1, or 2.');
}

class NavigationToken {
  superseded = false;
  pendingArtifactId?: bigint;

  constructor(readonly requestId: bigint, readonly replacementRequestId: bigint) {}

  get error(): RitoNativeError {
    return new RitoNativeError(5, `Rito navigation request ${this.requestId.toString()} was superseded by ${this.replacementRequestId.toString()}.`, 'request');
  }
}

function nativeError(result: RitoNativeCallResult, operation: string): RitoNativeError {
  if (Number(result.status) === STATUS_RESOURCE_PENDING && result.data.byteLength > 0) {
    return new RitoResourcePendingError(decodeRitoPendingShards(result.data), operation);
  }
  const numericStatus = Number(result.status);
  const status = Number.isInteger(numericStatus) && numericStatus >= 0 && numericStatus <= 255
    ? numericStatus as RitoNativeStatus
    : 255;
  const detail = typeof result.error === 'string' && result.error.trim().length > 0
    ? result.error
    : `Rito native operation ${operation} failed with status ${String(result.status)}.`;
  return new RitoNativeError(status, detail, operation);
}
