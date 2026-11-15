export type RitoNativeStatus =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  /** A resource read waits on content shards; the call's data holds a RITOPSH1 message. */
  | 12
  | 255;

export class RitoNativeError extends Error {
  constructor(
    readonly status: RitoNativeStatus,
    message: string,
    readonly operation: string,
  ) {
    super(message);
    this.name = 'RitoNativeError';
  }
}

/** A resource read of a session opened from shards waits on content shards; supply them and retry. */
export class RitoResourcePendingError extends RitoNativeError {
  constructor(
    readonly pending: { readonly shardIds: readonly number[]; readonly message: string },
    operation: string,
  ) {
    super(12, pending.message || `Rito ${operation} waits on content shards ${pending.shardIds.join(', ')}.`, operation);
    this.name = 'RitoResourcePendingError';
  }
}

export class RitoNativeSessionInvalidatedError extends RitoNativeError {
  constructor(
    readonly requestId: bigint,
    readonly cleanupError: unknown,
    readonly disposeError?: unknown,
  ) {
    const suffix = disposeError === undefined ? '' : ` Session disposal also failed: ${String(disposeError)}`;
    super(11, `Rito session was invalidated while releasing request ${requestId.toString()}: ${String(cleanupError)}.${suffix}`, 'cleanup');
    this.name = 'RitoNativeSessionInvalidatedError';
  }
}

export class RitoNativeModuleUnavailableError extends Error {
  constructor() {
    super('The Rito Nitro Module is unavailable in this build.');
    this.name = 'RitoNativeModuleUnavailableError';
  }
}

export class RitoWireError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RitoWireError';
  }
}
