import { getRitoNativePaperTurnModule, type RitoNativePaperTurnModule } from './native';

/*
 * The paper page turn's model (crates/rito-turn) through rito-ffi. A host
 * steps it on its own thread, frame by frame; numbers cross in the fixed
 * layouts `rito_turn::pack` gives every host, in the field order rito_ffi.h
 * documents. The typed records below read and write those layouts.
 */

/** A leaf's page as the host holds it: which spread it shows and the host buffer it is drawn into. */
export interface RitoPaperTurnPage {
  readonly spread: number;
  readonly buffer: number;
}

export interface RitoPaperTurnTouch {
  readonly originX: number;
  readonly originY: number;
  readonly x: number;
  readonly y: number;
  /** The farthest point the touch reached, when it reached one. */
  readonly farthest?: { readonly x: number; readonly y: number };
}

/** One frame's input (RITO_PAPER_TURN_FRAME_NUMBERS). */
export interface RitoPaperTurnFrame {
  readonly width: number;
  readonly height: number;
  readonly spine: number;
  /** Device units per CSS px. */
  readonly unit: number;
  readonly dx: number;
  readonly incoming: 'none' | 'next' | 'previous';
  readonly phase: 'held' | 'landing' | 'returning';
  readonly touch?: RitoPaperTurnTouch;
  readonly current?: RitoPaperTurnPage;
  readonly incomingPage?: RitoPaperTurnPage;
  /** The frame's time in ms. */
  readonly now: number;
  /** The host's GPU context epoch. */
  readonly epoch: number;
}

/** A release (RITO_PAPER_TURN_RELEASE_NUMBERS). */
export interface RitoPaperTurnRelease {
  readonly dx: number;
  readonly from: number;
  readonly velocity: number;
  readonly width: number;
  readonly forward: boolean;
  readonly touch?: RitoPaperTurnTouch;
  readonly spineX?: number;
}

export interface RitoPaperTurnLayouts {
  readonly frame: number;
  readonly sheet: number;
  readonly release: number;
  readonly settle: number;
  readonly begun: number;
  readonly laid: number;
  readonly state: number;
}

export interface RitoPaperTurnBegun {
  /** Whether a leaf turns; otherwise the page shown is drawn where the turn has it. */
  readonly turns: boolean;
  /** The spread of the leaf turned. */
  readonly spread: number;
  /** Whether what was remembered was of another moment. */
  readonly anew: boolean;
  /** Whether the forgotten leaves' pages are the host's to let go. */
  readonly releaseForgotten: boolean;
  readonly forgottenLeaves: readonly number[];
}

export interface RitoPaperTurnLaid {
  readonly led: number;
  readonly columns: number;
  readonly rows: number;
  readonly sheets: number;
  readonly front?: RitoPaperTurnPage;
  readonly after?: RitoPaperTurnPage;
  /** The leaves that left the book. */
  readonly leftBook: readonly number[];
}

export interface RitoPaperTurnFace {
  readonly kind: 'none' | 'front' | 'after';
  readonly leaf: number;
}

export interface RitoPaperTurnSheet {
  readonly front: RitoPaperTurnFace;
  readonly back: RitoPaperTurnFace;
  /** How far over the sheet is. */
  readonly over: number;
  /** The name of its points when it lies still; 0 when it moves. */
  readonly still: number;
  readonly curl?: { readonly dx: number; readonly dy: number; readonly at: number; readonly radius: number };
  /** The layout's numbers as rito-ffi wrote them. */
  readonly numbers: readonly number[];
  /** x, y, z per point, when the points were asked for. */
  readonly positions?: Float32Array;
  readonly normals?: Float32Array;
}

export interface RitoPaperTurnState {
  readonly painted: number;
  readonly there: boolean;
  readonly gone: boolean;
  readonly aloft: boolean;
}

export interface RitoPaperTurnSettleStep {
  /** The settle to hold and step again next frame. */
  readonly settle: readonly number[];
  readonly x: number;
  readonly velocity: number;
  readonly done: boolean;
}

const DEFAULT_LEAVES_CAPACITY = 64;

export function encodeRitoPaperTurnFrame(frame: RitoPaperTurnFrame): number[] {
  return [
    frame.width, frame.height, frame.spine, frame.unit,
    frame.dx,
    frame.incoming === 'next' ? 1 : frame.incoming === 'previous' ? 2 : 0,
    frame.phase === 'landing' ? 1 : frame.phase === 'returning' ? 2 : 0,
    ...touchNumbers(frame.touch),
    ...pageNumbers(frame.current),
    ...pageNumbers(frame.incomingPage),
    frame.now,
    frame.epoch,
  ];
}

export function encodeRitoPaperTurnRelease(release: RitoPaperTurnRelease): number[] {
  return [
    release.dx, release.from, release.velocity, release.width, release.forward ? 1 : 0,
    ...touchNumbers(release.touch),
    release.spineX === undefined ? 0 : 1, release.spineX ?? 0,
  ];
}

export class RitoPaperTurn {
  private readonly native: RitoNativePaperTurnModule;
  private handle: bigint | undefined;
  private grid = { columns: 0, rows: 0 };

  constructor(native: RitoNativePaperTurnModule = getRitoNativePaperTurnModule()) {
    this.native = native;
    this.handle = native.create();
  }

  static layouts(native: RitoNativePaperTurnModule = getRitoNativePaperTurnModule()): RitoPaperTurnLayouts {
    const [frame, sheet, release, settle, begun, laid, state] = native.layouts();
    return { frame: frame!, sheet: sheet!, release: release!, settle: settle!, begun: begun!, laid: laid!, state: state! };
  }

  /** How far a finger has carried a turn. */
  static travel(touch: Pick<RitoPaperTurnTouch, 'originX' | 'originY' | 'x' | 'y'>, width: number, spine: number, native: RitoNativePaperTurnModule = getRitoNativePaperTurnModule()): number {
    return native.travel([touch.originX, touch.originY, touch.x, touch.y], width, spine);
  }

  /** Whether a released turn lands on the next page. */
  static lands(release: RitoPaperTurnRelease, native: RitoNativePaperTurnModule = getRitoNativePaperTurnModule()): boolean {
    return native.lands(encodeRitoPaperTurnRelease(release));
  }

  static eyeHeight(width: number, height: number, native: RitoNativePaperTurnModule = getRitoNativePaperTurnModule()): number {
    return native.eyeHeight(width, height);
  }

  /** Reads a frame. */
  begin(frame: RitoPaperTurnFrame | readonly number[], leavesCapacity = DEFAULT_LEAVES_CAPACITY): RitoPaperTurnBegun {
    const numbers = isNumbers(frame) ? frame : encodeRitoPaperTurnFrame(frame);
    const { numbers: begun, leaves } = this.native.begin(this.turn, numbers, leavesCapacity);
    return { turns: begun[0] === 1, spread: begun[1]!, anew: begun[2] === 1, releaseForgotten: begun[3] === 1, forgottenLeaves: leaves };
  }

  /** Moves the leaves of the frame begin read on and lays them out; undefined when no frame waits. */
  lay(epoch: number, leavesCapacity = DEFAULT_LEAVES_CAPACITY): RitoPaperTurnLaid | undefined {
    const { numbers, leaves } = this.native.lay(this.turn, epoch, leavesCapacity);
    if (numbers[0] !== 1) return undefined;
    const laid: RitoPaperTurnLaid = {
      led: numbers[1]!, columns: numbers[2]!, rows: numbers[3]!, sheets: numbers[4]!,
      front: readPage(numbers, 5), after: readPage(numbers, 8), leftBook: leaves,
    };
    this.grid = { columns: laid.columns, rows: laid.rows };
    return laid;
  }

  /** Sheet `index` of the frame last laid out; its points only when asked, as for a sheet whose points move. */
  sheet(index: number, withPoints = true): RitoPaperTurnSheet {
    const capacity = withPoints ? this.grid.columns * this.grid.rows * 3 : 0;
    const sheet = this.native.sheet(this.turn, index, capacity);
    const numbers = sheet.numbers;
    return {
      front: readFace(numbers, 0),
      back: readFace(numbers, 2),
      over: numbers[4]!,
      still: numbers[5]!,
      curl: numbers[6] === 1 ? { dx: numbers[7]!, dy: numbers[8]!, at: numbers[9]!, radius: numbers[10]! } : undefined,
      numbers,
      positions: sheet.positions ? new Float32Array(sheet.positions) : undefined,
      normals: sheet.normals ? new Float32Array(sheet.normals) : undefined,
    };
  }

  forget(epoch: number, leavesCapacity = DEFAULT_LEAVES_CAPACITY): { readonly release: boolean; readonly leaves: readonly number[] } {
    return this.native.forget(this.turn, epoch, leavesCapacity);
  }

  /** What the turn tells of its page at `now` (ms). */
  state(now: number): RitoPaperTurnState {
    const [painted, there, gone, aloft] = this.native.state(this.turn, now);
    return { painted: painted!, there: there === 1, gone: gone === 1, aloft: aloft === 1 };
  }

  /** Where a turn that cuts into another begins, and how fast. */
  begins(dx: number, velocity: number, sameSpreads: boolean): { readonly dx: number; readonly velocity: number } {
    const [beginDx, beginVelocity] = this.native.begins(this.turn, dx, velocity, sameSpreads);
    return { dx: beginDx!, velocity: beginVelocity! };
  }

  /** How a turn nothing holds comes to rest: numbers to hold and step once a frame. */
  settle(from: number, velocity: number, to: number): readonly number[] {
    return this.native.settle(this.turn, from, velocity, to);
  }

  settleStep(settle: readonly number[], seconds: number, now: number): RitoPaperTurnSettleStep {
    const step = this.native.settleStep(this.turn, settle, seconds, now);
    return { settle: step.settle, x: step.at[0]!, velocity: step.at[1]!, done: step.at[2] === 1 };
  }

  /** Frees the model; idempotent. */
  free(): void {
    if (this.handle === undefined) return;
    const handle = this.handle;
    this.handle = undefined;
    this.native.free(handle);
  }

  private get turn(): bigint {
    if (this.handle === undefined) throw new Error('Rito paper turn has been freed.');
    return this.handle;
  }
}

function touchNumbers(touch: RitoPaperTurnTouch | undefined): number[] {
  if (!touch) return [0, 0, 0, 0, 0, 0, 0, 0];
  return [1, touch.originX, touch.originY, touch.x, touch.y, touch.farthest ? 1 : 0, touch.farthest?.x ?? 0, touch.farthest?.y ?? 0];
}

function pageNumbers(page: RitoPaperTurnPage | undefined): number[] {
  return page ? [1, page.spread, page.buffer] : [0, 0, 0];
}

function readPage(numbers: readonly number[], offset: number): RitoPaperTurnPage | undefined {
  return numbers[offset] === 1 ? { spread: numbers[offset + 1]!, buffer: numbers[offset + 2]! } : undefined;
}

function readFace(numbers: readonly number[], offset: number): RitoPaperTurnFace {
  const kind = numbers[offset];
  return { kind: kind === 1 ? 'front' : kind === 2 ? 'after' : 'none', leaf: numbers[offset + 1]! };
}

function isNumbers(value: RitoPaperTurnFrame | readonly number[]): value is readonly number[] {
  return Array.isArray(value);
}
