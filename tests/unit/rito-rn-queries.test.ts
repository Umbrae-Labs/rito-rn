import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  TurboModuleRegistry: { get: () => null },
}));

vi.mock('react-native-nitro-modules', () => ({
  NitroModules: { createHybridObject: () => null },
}));

import { RitoBinaryReader, RitoBinaryWriter } from '../../src/protocol/binary';
import { RitoResourcePendingError, RitoWireError } from '../../src/errors';
import { encodeRitoArtifactRequest } from '../../src/protocol/requests';
import {
  decodeRitoAnnotationResponse,
  decodeRitoFontCatalog,
  decodeRitoFontNames,
  decodeRitoNavigationResult,
  decodeRitoPendingShards,
  decodeRitoShardIds,
  decodeRitoTextInteractionResponse,
  encodeRitoAnnotationRequest,
  encodeRitoNavigationRequest,
  encodeRitoSpreadRequest,
  encodeRitoTextInteractionRequest,
} from '../../src/protocol/queries';
import { RitoReaderSession } from '../../src/session';
import type { RitoNativeCallResult, RitoNativePaperTurnModule, RitoNativeReaderModule } from '../../src/native';
import { encodeRitoPaperTurnFrame, encodeRitoPaperTurnRelease, RitoPaperTurn } from '../../src/paper-turn';

describe('protocol 9 requests', () => {
  it('encodes the scrolled spread mode as tag 2', () => {
    const bytes = encodeRitoArtifactRequest({
      sessionId: 1n,
      requestId: 2n,
      layout: {
        viewportWidth: 390, viewportHeight: 844, marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
        spreadMode: 'scrolled', firstPageAlone: false, spreadGap: 0, rootFontSize: 16,
      },
      locator: { href: 'chapter.xhtml' },
    });
    const reader = new RitoBinaryReader(bytes);
    reader.expectHeader('RITOREQ1');
    reader.readU32(); reader.readU64(); reader.readU64(); reader.readU64();
    reader.readU64(); // layout record length
    for (let index = 0; index < 6; index += 1) reader.readF64();
    expect(reader.readU32()).toBe(2);
  });

  it('encodes a fixed 48-byte RITOSPQ1 spread request', () => {
    const bytes = encodeRitoSpreadRequest({ sessionId: 1n, requestId: 5n, fromArtifactId: 3n, spreadIndex: 7 });
    expect(bytes.byteLength).toBe(48);
    const reader = new RitoBinaryReader(bytes);
    reader.expectHeader('RITOSPQ1');
    expect(reader.readU32()).toBe(1);
    expect(reader.readU64()).toBe(48n);
    expect([reader.readU64(), reader.readU64(), reader.readU64(), reader.readU32()]).toEqual([1n, 5n, 3n, 7]);
  });
});

describe('session queries', () => {
  it('encodes a caret query and decodes a caret with its geometry width and writing mode', () => {
    const request = encodeRitoTextInteractionRequest({
      sessionId: 1n, artifactId: 3n, query: { kind: 'caret', point: { pageIndex: 0, x: 10, y: 20 } },
    });
    const reader = new RitoBinaryReader(request);
    reader.expectHeader('RITOTIQ1');
    expect(reader.readU32()).toBe(1);
    expect(reader.readU64()).toBe(BigInt(request.byteLength));

    const response = message('RITOTIR1').writeU64(3n).writeU8(0).writeRecord((caret) => {
      writeCaretAddress(caret, 2);
      caret.writeU8(1).writeF64(4).writeF64(8).writeF64(12).writeF64(0);
      caret.writeU8(1).writeUtf8('chapter.xhtml');
      writeSourcePoint(caret, [1, 4], 6n);
    });
    expect(decodeRitoTextInteractionResponse(finish(response))).toEqual({
      artifactId: 3n,
      result: {
        kind: 'caret',
        caret: {
          address: { pageIndex: 2, position: { blockIndex: 1, lineIndex: 2, runIndex: 3, charIndex: 4 }, affinity: 'downstream' },
          geometry: { x: 4, y: 8, width: 12, height: 0 },
          writingMode: 'vertical-rl',
          href: 'chapter.xhtml',
          sourcePoint: { nodePath: [1, 4], textOffset: 6n },
        },
      },
    });
  });

  it('round-trips annotation queries and refuses an orphan with a target', () => {
    const request = encodeRitoAnnotationRequest({ sessionId: 1n, query: { kind: 'resolve', targetJson: '{"version":1}' } });
    const reader = new RitoBinaryReader(request);
    reader.expectHeader('RITOANQ1');
    expect([reader.readU32(), reader.readU64(), reader.readU64(), reader.readU8()]).toEqual([1, BigInt(request.byteLength), 1n, 1]);
    expect(reader.readUtf8()).toBe('{"version":1}');

    const orphan = message('RITOANR1').writeU8(5).writeU8(0);
    expect(decodeRitoAnnotationResponse(finish(orphan))).toEqual({ level: 'orphaned-href-not-found', target: undefined });
    const contradictory = message('RITOANR1').writeU8(5).writeU8(1).writeRecord((target) => writeAnnotationTarget(target));
    expect(() => decodeRitoAnnotationResponse(finish(contradictory))).toThrow();
  });

  it('decodes a scrolled revision layout with each chapter extent and the scroll axis', () => {
    const request = encodeRitoNavigationRequest({ sessionId: 1n, query: { kind: 'layout', artifactId: 3n } });
    expect(request.byteLength).toBeGreaterThan(16);

    const layout = message('RITONVR1').writeU8(3)
      .writeU32(2)
      .writeU32(1).writeU32(0).writeU8(0)
      .writeU32(1).writeU32(4).writeU32(0).writeU32(1).writeU8(1).writeF64(1688.5)
      .writeU32(1).writeU32(9).writeU32(0)
      .writeU32(2).writeU8(1).writeU32(9).writeU8(0)
      .writeU8(1)
      .writeU8(1).writeU8(0);
    expect(decodeRitoNavigationResult(finish(layout))).toEqual({
      kind: 'layout',
      layout: {
        pageCount: 2,
        spreads: [{ leftPageIndex: 0, rightPageIndex: undefined }],
        chapters: [{ spineIndex: 4, startPage: 0, endPage: 1, extent: 1688.5 }],
        tocTargets: [{ tocId: 9, pageIndex: 0 }],
        activeTocEntryByPage: [9, undefined],
        complete: true,
        scrollAxis: 'down',
      },
    });

    const located = message('RITONVR1').writeU8(1).writeU8(0).writeU32(3).writeU8(1).writeU8(1).writeU8(1).writeF64(42.25);
    expect(decodeRitoNavigationResult(finish(located))).toEqual({
      kind: 'location',
      location: { kind: 'page', pageIndex: 3, drawn: true, matchedBy: 'source-point', blockOffset: 42.25 },
    });
  });

  it('decodes the font catalog and unresolved family names', () => {
    const catalog = message('RITOFNT1').writeU32(1)
      .writeUtf8('Lunar Serif').writeU32(0).writeU32(1).writeU8(1).writeUtf8('zh')
      .writeU32(1).writeU16(400).writeUtf8('normal').writeU8(1).writeUtf8('a'.repeat(64));
    expect(decodeRitoFontCatalog(finish(catalog))).toEqual({
      families: [{
        name: 'Lunar Serif', source: 'host', genericRole: 'serif', language: 'zh',
        faces: [{ weight: 400, style: 'normal', sha256: 'a'.repeat(64) }],
      }],
    });
    const names = message('RITOFNN1').writeU32(2).writeUtf8('Missing').writeUtf8('Other');
    expect(decodeRitoFontNames(finish(names))).toEqual(['Missing', 'Other']);
  });

  it('decodes the shards a resource read waits on and rejects malformed lists', () => {
    const pending = message('RITOPSH1').writeU32(2).writeU32(3).writeU32(8).writeUtf8('cover image');
    expect(decodeRitoPendingShards(finish(pending))).toEqual({ shardIds: [3, 8], message: 'cover image' });
    const skeleton = message('RITOPSH1').writeU32(1).writeU32(0).writeUtf8('');
    expect(() => decodeRitoPendingShards(finish(skeleton))).toThrow(RitoWireError);
    const unordered = message('RITOPSH1').writeU32(2).writeU32(8).writeU32(3).writeUtf8('');
    expect(() => decodeRitoPendingShards(finish(unordered))).toThrow(RitoWireError);
    expect(decodeRitoShardIds(Uint8Array.from([1, 0, 0, 0, 2, 1, 0, 0]))).toEqual([1, 258]);
    expect(() => decodeRitoShardIds(Uint8Array.from([1, 0]))).toThrow(RitoWireError);
  });
});

describe('RitoReaderSession bindings', () => {
  it('owns a peeked spread like a peek and releases it when another artifact is adopted', async () => {
    const calls: string[] = [];
    const native = fakeNative((operation) => {
      calls.push(operation);
      if (operation === 'peekSpread') return ok(artifactWire(1n, 4n, 5n));
      if (operation === 'adoptForeground') return ok(foregroundAck(1n, undefined, 1n));
      return ok(new Uint8Array());
    });
    const session = new RitoReaderSession(1n, { native });
    await session.adoptForeground({ sessionId: 1n, candidateArtifactId: 1n });
    const spread = await session.peekSpread({ sessionId: 1n, requestId: 4n, fromArtifactId: 1n, spreadIndex: 2 });
    expect(spread.artifactId).toBe(5n);
    expect(session.currentVisibleArtifactId).toBe(1n);
    expect(session.getArtifact(5n)).toBe(spread);
    await session.adoptForeground({ sessionId: 1n, candidateArtifactId: 1n });
    expect(calls).toEqual(['adoptForeground', 'peekSpread', 'adoptForeground', 'releaseArtifact']);
  });

  it('turns a resource-pending status into the shards to supply', async () => {
    const pending = finish(message('RITOPSH1').writeU32(1).writeU32(4).writeUtf8('image shard'));
    const native = fakeNative((operation) => {
      if (operation === 'readResource') return { status: 12, data: pending, error: 'waiting' };
      if (operation === 'supplyShard') return ok(Uint8Array.from([4, 0, 0, 0]));
      if (operation === 'contentShardsNear') return ok(Uint8Array.from([4, 0, 0, 0, 2, 0, 0, 0]));
      return ok(new Uint8Array());
    });
    const session = new RitoReaderSession(1n, { native });
    const error = await session.readResource(2n, 0, 'cover.png').catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(RitoResourcePendingError);
    expect((error as RitoResourcePendingError).pending.shardIds).toEqual([4]);
    await expect(session.supplyShard(Uint8Array.from([9]))).resolves.toBe(4);
    await expect(session.contentShardsNear('chapter.xhtml')).resolves.toEqual([4, 2]);
    await expect(session.supplyShard(Uint8Array.from([9]), new Uint8Array(16))).rejects.toThrow(RangeError);
  });

  it('decodes the font catalog through the session and checks its inputs', async () => {
    const native = fakeNative((operation) => {
      if (operation === 'fontCatalog') return ok(finish(message('RITOFNT1').writeU32(0)));
      if (operation === 'unresolvedFontFamilies') return ok(finish(message('RITOFNN1').writeU32(1).writeUtf8('Missing')));
      return ok(new Uint8Array());
    });
    const session = new RitoReaderSession(1n, { native });
    await expect(session.fontCatalog()).resolves.toEqual({ families: [] });
    await expect(session.unresolvedFontFamilies('Missing, serif')).resolves.toEqual(['Missing']);
    await expect(session.removeHostFontFaces([])).rejects.toThrow(RangeError);
    await expect(session.markFontFamilyUnavailable('')).rejects.toThrow(RangeError);
  });
});

describe('RitoPaperTurn', () => {
  it('writes frames and releases in the layouts rito_turn::pack reads', () => {
    const frame = encodeRitoPaperTurnFrame({
      width: 1179, height: 2280, spine: 0, unit: 3, dx: -312.5, incoming: 'next', phase: 'held',
      touch: { originX: 1100, originY: 2000, x: 787.5, y: 1990, farthest: { x: 780, y: 1985 } },
      current: { spread: 4, buffer: 1 }, now: 1234.5, epoch: 2,
    });
    expect(frame).toHaveLength(23);
    expect(frame.slice(4, 15)).toEqual([-312.5, 1, 0, 1, 1100, 2000, 787.5, 1990, 1, 780, 1985]);
    expect(frame.slice(15, 23)).toEqual([1, 4, 1, 0, 0, 0, 1234.5, 2]);

    const release = encodeRitoPaperTurnRelease({ dx: -400, from: 0, velocity: -2, width: 1179, forward: true, spineX: 0 });
    expect(release).toHaveLength(15);
    expect(release.slice(0, 6)).toEqual([-400, 0, -2, 1179, 1, 0]);
    expect(release.slice(13)).toEqual([1, 0]);
  });

  it('reads the model through its handle and asks for each sheet grid points', () => {
    const sheetCapacities: number[] = [];
    const freed: bigint[] = [];
    const native = fakePaperTurn({
      lay: () => ({ numbers: [1, 7, 4, 3, 2, 1, 5, 0, 0, 0, 0], leaves: [2] }),
      sheet: (_turn, _index, capacity) => {
        sheetCapacities.push(capacity);
        return { numbers: [1, 7, 2, 7, 0.5, 0, 1, 3, 4, 0.25, 30], positions: new Float32Array(capacity).buffer };
      },
      free: (turn) => freed.push(turn),
    });
    const turn = new RitoPaperTurn(native);
    expect(turn.lay(1)).toEqual({ led: 7, columns: 4, rows: 3, sheets: 2, front: { spread: 5, buffer: 0 }, after: undefined, leftBook: [2] });
    const sheet = turn.sheet(0);
    expect(sheetCapacities).toEqual([36]);
    expect(sheet.front).toEqual({ kind: 'front', leaf: 7 });
    expect(sheet.back).toEqual({ kind: 'after', leaf: 7 });
    expect(sheet.curl).toEqual({ dx: 3, dy: 4, at: 0.25, radius: 30 });
    expect(sheet.positions).toHaveLength(36);
    turn.free();
    turn.free();
    expect(freed).toEqual([9n]);
    expect(() => turn.state(0)).toThrow('freed');
  });
});

function fakeNative(handler: (operation: string) => RitoNativeCallResult): RitoNativeReaderModule {
  const call = (operation: string) => () => Promise.resolve(handler(operation));
  const operations = [
    'open', 'readPublication', 'requestArtifact', 'requestAdjacent', 'peekAdjacent', 'adoptForeground',
    'commitPeekedArtifact', 'advanceBackground', 'adoptBackground', 'readResource', 'search', 'textRangeGeometry',
    'resolveExactSourceRange', 'readPage', 'readFootnote', 'releaseArtifact', 'dispose', 'openWithoutPinnedFonts',
    'openShards', 'supplyShard', 'contentShardsNear', 'peekSpread', 'resolveTextInteraction', 'resolveAnnotation',
    'resolveNavigation', 'fontCatalog', 'unresolvedFontFamilies', 'addHostFontFaces', 'removeHostFontFaces',
    'markFontFamilyUnavailable',
  ] as const;
  return Object.fromEntries(operations.map((operation) => [operation, call(operation)])) as unknown as RitoNativeReaderModule;
}

function fakePaperTurn(overrides: Partial<RitoNativePaperTurnModule>): RitoNativePaperTurnModule {
  return {
    layouts: () => [23, 11, 15, 12, 4, 11, 4],
    create: () => 9n,
    free: () => undefined,
    begin: () => ({ numbers: [0, 0, 0, 0], leaves: [] }),
    lay: () => ({ numbers: new Array(11).fill(0), leaves: [] }),
    sheet: () => ({ numbers: new Array(11).fill(0) }),
    forget: () => ({ release: false, leaves: [] }),
    state: () => [0, 0, 0, 0],
    begins: () => [0, 0],
    settle: () => new Array(12).fill(0),
    settleStep: () => ({ settle: new Array(12).fill(0), at: [0, 0, 1] }),
    travel: () => 0,
    lands: () => false,
    eyeHeight: () => 0,
    ...overrides,
  };
}

function ok(data: Uint8Array): RitoNativeCallResult {
  return { status: 0, data, error: '' };
}

function message(magic: string): RitoBinaryWriter {
  return new RitoBinaryWriter().writeAscii(magic).writeU32(1).writeU64(0n);
}

function finish(writer: RitoBinaryWriter): Uint8Array {
  const bytes = writer.toUint8Array();
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setBigUint64(12, BigInt(bytes.byteLength), true);
  return bytes;
}

function writeSourcePoint(writer: RitoBinaryWriter, nodePath: readonly number[], textOffset: bigint): void {
  writer.writeRecord((point) => {
    point.writeU32(nodePath.length);
    for (const part of nodePath) point.writeU32(part);
    point.writeU64(textOffset);
  });
}

function writeCaretAddress(writer: RitoBinaryWriter, pageIndex: number): void {
  writer.writeRecord((address) => address.writeU32(pageIndex).writeU32(1).writeU32(2).writeU32(3).writeU32(4).writeU8(1));
}

function writeAnnotationTarget(writer: RitoBinaryWriter): void {
  writer.writeUtf8('{}').writeUtf8('chapter.xhtml');
  writer.writeRecord((range) => {
    writeSourcePoint(range, [1], 0n);
    writeSourcePoint(range, [1], 4n);
  });
  writer.writeUtf8('text').writeUtf8('').writeUtf8('').writeU64(0n).writeU64(4n).writeU64(10n);
}

function artifactWire(sessionId: bigint, requestId: bigint, artifactId: bigint): Uint8Array {
  const display = new RitoBinaryWriter().writeAscii('RITODL1').writeU32(4).writeF64(1).writeU32(0)
    .writeU32(0).writeU8(0).writeUtf8('').writeU32(0).toUint8Array();
  return finish(new RitoBinaryWriter()
    .writeAscii('RITOART1').writeU32(1).writeU64(0n)
    .writeU32(9).writeU32(1).writeU64(sessionId).writeU64(requestId).writeU64(1n).writeU32(1).writeU64(artifactId)
    .writeRecord((locator) => locator.writeUtf8('chapter.xhtml').writeU8(0).writeU8(0).writeU8(0).writeU8(0))
    .writeU32(4).writeU32(0).writeU32(0).writeU32(1).writeU32(1)
    .writeF64(390).writeF64(844).writeU8(0).writeU8(0).writeU8(0)
    .writeU32(0).writeU32(0).writeU32(0)
    .writeRecord((record) => record.writeU32(4).writeU32(0).writeU64(BigInt(display.byteLength)).writeBytes(display))
    .writeU32(0).writeU32(0).writeU32(0));
}

function foregroundAck(intentRequestId: bigint, replacedArtifactId: bigint | undefined, visibleArtifactId: bigint): Uint8Array {
  return finish(new RitoBinaryWriter().writeAscii('RITOFGA1').writeU32(1).writeU64(48n)
    .writeU64(intentRequestId).writeU32(replacedArtifactId === undefined ? 0 : 1)
    .writeU64(replacedArtifactId ?? 0n).writeU64(visibleArtifactId));
}
