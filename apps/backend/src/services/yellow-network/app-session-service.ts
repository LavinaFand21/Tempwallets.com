/**
 * App Session Service (Lightning Node Core)
 *
 * Implements multi-party app sessions with:
 * - DEPOSIT: Add funds from unified balance to app session
 * - OPERATE: Transfer funds within app session (gasless)
 * - WITHDRAW: Remove funds from app session back to unified balance
 *
 * IMPORTANT: App Sessions = Lightning Nodes (multi-party, off-chain)
 * Uses NitroRPC/0.4 protocol with intent-based state updates.
 *
 * Governance: Uses the JUDGE model — the backend (creator) has weight=100
 * and quorum=100, so it alone can sign OPERATE, WITHDRAW, and CLOSE.
 * For DEPOSIT by a non-judge participant, the depositor's signature is also
 * required (Yellow Network rule), so we collect two signatures.
 *
 * Protocol Reference:
 * - App Sessions: https://docs.yellow.org/docs/protocol/off-chain/app-sessions
 */

import type { Address, Hash } from 'viem';
import { keccak256, toBytes } from 'viem';
import type { WebSocketManager } from './websocket-manager.js';
import type { SessionKeyAuth } from './session-auth.js';
import type {
  AppDefinition,
  AppSession,
  AppSessionAllocation,
  AppSessionIntent,
  AppSessionState,
  RPCRequest,
} from './types.js';

// ============================================================================
// Safe Decimal Arithmetic
// ============================================================================
// Yellow Network uses string amounts (e.g. "100.0") to avoid floating-point
// errors. We convert to fixed-point bigint for arithmetic, then back to string.

const DECIMAL_PRECISION = 18;

/** Convert a human-readable decimal string to a fixed-point bigint. */
function toFixedPoint(value: string): bigint {
  const trimmed = value.trim();
  const negative = trimmed.startsWith('-');
  const abs = negative ? trimmed.slice(1) : trimmed;
  const [intPart = '0', decPart = ''] = abs.split('.');
  const padded = decPart
    .padEnd(DECIMAL_PRECISION, '0')
    .slice(0, DECIMAL_PRECISION);
  const result = BigInt(intPart + padded);
  return negative ? -result : result;
}

/** Convert a fixed-point bigint back to a human-readable decimal string. */
function fromFixedPoint(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const str = abs.toString().padStart(DECIMAL_PRECISION + 1, '0');
  const intPart = str.slice(0, str.length - DECIMAL_PRECISION) || '0';
  const decPart = str.slice(str.length - DECIMAL_PRECISION);
  // Trim trailing zeros but keep at least two decimal places for readability
  const trimmed = decPart.replace(/0+$/, '');
  const finalDec = trimmed.length < 2 ? decPart.slice(0, 2) : trimmed;
  return `${negative ? '-' : ''}${intPart}.${finalDec}`;
}

/** Add two decimal strings safely. */
function addDecimal(a: string, b: string): string {
  return fromFixedPoint(toFixedPoint(a) + toFixedPoint(b));
}

/** Subtract two decimal strings safely. Returns result and throws if negative. */
function subtractDecimal(a: string, b: string): string {
  const result = toFixedPoint(a) - toFixedPoint(b);
  if (result < 0n) {
    throw new Error(`Insufficient balance: ${a} < ${b}`);
  }
  return fromFixedPoint(result);
}

/**
 * App Session Service
 *
 * Manages multi-party app sessions (Lightning Nodes)
 */
export class AppSessionService {
  private ws: WebSocketManager;
  private auth: SessionKeyAuth;

  constructor(ws: WebSocketManager, auth: SessionKeyAuth) {
    this.ws = ws;
    this.auth = auth;
  }

  /**
   * Create a new app session (Lightning Node)
   *
   * @param definition - App governance definition
   * @param allocations - Initial fund allocations from unified balance
   * @param sessionData - Optional application-specific state (JSON)
   * @returns Created app session with ID and metadata
   */
  async createAppSession(
    definition: AppDefinition,
    allocations: AppSessionAllocation[],
    sessionData?: string,
  ): Promise<AppSession> {
    console.log('[AppSessionService] Creating app session...');
    console.log(`  - Protocol: ${definition.protocol}`);
    console.log(`  - Participants: ${definition.participants.length}`);
    console.log(`  - Quorum: ${definition.quorum}`);

    // Validate protocol version
    if (definition.protocol !== 'NitroRPC/0.4') {
      console.warn(
        `[AppSessionService] Using ${definition.protocol}. Recommended: NitroRPC/0.4`,
      );
    }

    // Request app session creation
    const requestId = this.ws.getNextRequestId();

    // Build params object, excluding undefined values
    const params: any = {
      definition,
      allocations,
    };

    // Only include session_data if it's defined
    if (sessionData !== undefined) {
      params.session_data = sessionData;
    }

    let request: RPCRequest = {
      req: [requestId, 'create_app_session', params, Date.now()],
      sig: [] as string[],
    };

    // Sign with session key
    request = await this.auth.signRequest(request);

    const response = await this.ws.send(request);

    // Check for error response from clearnode
    if (response.res[1] === 'error') {
      const errorData = response.res[2];
      const errorMsg =
        typeof errorData === 'object' && errorData !== null
          ? errorData.error || JSON.stringify(errorData)
          : String(errorData);
      console.error('[AppSessionService] create_app_session FAILED:', errorMsg);
      throw new Error(`create_app_session failed: ${errorMsg}`);
    }

    const sessionResponse = response.res[2];

    // Log full response for debugging
    console.log(
      '[AppSessionService] Full response:',
      JSON.stringify(response, null, 2),
    );
    console.log(
      '[AppSessionService] Session response:',
      JSON.stringify(sessionResponse, null, 2),
    );

    // Extract app session ID - try multiple possible field names
    const appSessionId: Hash =
      sessionResponse?.app_session_id ||
      sessionResponse?.appSessionId ||
      sessionResponse?.session_id ||
      sessionResponse?.sessionId;

    // app_session_id MUST come from Yellow Network - no fallback computation
    if (!appSessionId || typeof appSessionId !== 'string') {
      console.error(
        '[AppSessionService] app_session_id missing from Yellow Network response',
      );
      console.error(
        '[AppSessionService] Response structure:',
        JSON.stringify(sessionResponse, null, 2),
      );
      throw new Error(
        'Failed to create app session: Yellow Network did not return app_session_id. ' +
          `Response: ${JSON.stringify(sessionResponse)}`,
      );
    }

    // Ensure appSessionId is a valid Hash (0x-prefixed hex string)
    if (!appSessionId.startsWith('0x') || appSessionId.length !== 66) {
      console.error(
        '[AppSessionService] Invalid app_session_id format:',
        appSessionId,
      );
      throw new Error(
        `Invalid app_session_id format from Yellow Network: ${appSessionId}. ` +
          'Expected 0x-prefixed 64-character hex string.',
      );
    }

    const status = (sessionResponse?.status || 'open') as 'open' | 'closed';
    const version = (sessionResponse?.version || 1) as number;

    console.log('[AppSessionService] App session created!');
    console.log(`  - Session ID: ${appSessionId}`);
    console.log(`  - Status: ${status}`);
    console.log(`  - Version: ${version}`);

    // Return app session object
    return {
      app_session_id: appSessionId,
      status,
      version,
      session_data: sessionData,
      allocations,
      definition,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Submit an app state update (NitroRPC/0.4).
   *
   * Per Yellow Network protocol, NitroRPC/0.4 requires:
   * - version: must be exactly currentVersion + 1
   * - intent: "operate" | "deposit" | "withdraw" (lowercase)
   * - allocations: FINAL state after the operation, NOT delta
   *
   * @param appSessionId  - App session identifier
   * @param intent        - Operation intent
   * @param version       - Next version number (currentVersion + 1)
   * @param allocations   - FINAL allocation state after this update
   * @param sessionData   - Optional application state
   * @param extraSignatures - Additional signatures for multi-party scenarios
   *                          (e.g. depositor's signature when depositor != judge)
   */
  async submitAppState(
    appSessionId: Hash,
    intent: AppSessionIntent,
    version: number,
    allocations: AppSessionAllocation[],
    sessionData?: string,
    extraSignatures?: string[],
  ): Promise<AppSessionState> {
    console.log(
      `[AppSessionService] Submitting ${intent} intent (v${version})...`,
    );
    console.log(`  - Session: ${appSessionId}`);
    console.log(`  - Version: ${version}`);
    console.log(`  - Allocations: ${JSON.stringify(allocations)}`);

    const requestId = this.ws.getNextRequestId();
    let request: RPCRequest = {
      req: [
        requestId,
        'submit_app_state',
        {
          app_session_id: appSessionId,
          intent: intent.toLowerCase(), // Yellow protocol expects lowercase
          version,
          allocations,
          ...(sessionData !== undefined ? { session_data: sessionData } : {}),
        },
        Date.now(),
      ],
      sig: [] as string[],
    };

    // Sign with the primary auth (Judge / creator session key)
    request = await this.auth.signRequest(request);

    // Append any additional signatures (e.g. depositor for DEPOSIT intent)
    if (extraSignatures && extraSignatures.length > 0) {
      request.sig.push(...extraSignatures);
    }

    const response = await this.ws.send(request);

    // Check for error response from clearnode
    if (response.res[1] === 'error') {
      const errorData = response.res[2];
      const errorMsg =
        typeof errorData === 'object' && errorData !== null
          ? errorData.error || JSON.stringify(errorData)
          : String(errorData);
      console.error(`[AppSessionService] ${intent} FAILED:`, errorMsg);
      throw new Error(`submit_app_state (${intent}) failed: ${errorMsg}`);
    }

    const stateData = response.res[2] || {};

    console.log(`[AppSessionService] ${intent} completed!`);
    console.log(`  - Confirmed version: ${stateData.version ?? 'N/A'}`);
    console.log(`  - Status: ${stateData.status ?? 'N/A'}`);

    return {
      app_session_id: appSessionId,
      status: stateData.status || 'open',
      version: stateData.version || version,
      session_data: sessionData,
      allocations,
      signatures: stateData.signatures,
    };
  }

  /**
   * Deposit funds to app session from unified balance (gasless)
   *
   * NOTE: Yellow Network requires the depositing participant to sign,
   * even if quorum is already met. When the depositor is NOT the judge,
   * pass the depositor's signature via extraSignatures.
   *
   * @param appSessionId       - App session identifier
   * @param participant        - Depositor address
   * @param asset              - Asset identifier (e.g., 'usdc')
   * @param amount             - Amount in human-readable format
   * @param currentAllocations - Current allocations (to compute FINAL state)
   * @param version            - Next version (currentVersion + 1)
   * @param extraSignatures    - Depositor's signature if depositor != judge
   * @returns Updated state after deposit
   */
  async depositToAppSession(
    appSessionId: Hash,
    participant: Address,
    asset: string,
    amount: string,
    currentAllocations: AppSessionAllocation[],
    version: number,
    extraSignatures?: string[],
  ): Promise<AppSessionState> {
    console.log(
      `[AppSessionService] Deposit: ${amount} ${asset} from ${participant}`,
    );

    // Calculate FINAL allocations after deposit (adds to participant's balance)
    const newAllocations = this.addAllocation(
      currentAllocations,
      participant,
      asset,
      amount,
    );

    return await this.submitAppState(
      appSessionId,
      'DEPOSIT',
      version,
      newAllocations,
      undefined,
      extraSignatures,
    );
  }

  /**
   * Transfer funds within app session (gasless, OPERATE intent)
   *
   * This is an intra-session redistribution. The total funds in the
   * session stay the same — amounts just move between participants.
   * In the Judge model, only the judge signature is needed (meets quorum).
   *
   * @param appSessionId       - App session identifier
   * @param from               - Sender address
   * @param to                 - Recipient address
   * @param asset              - Asset identifier
   * @param amount             - Amount in human-readable format
   * @param currentAllocations - Current allocations (to compute FINAL state)
   * @param version            - Next version (currentVersion + 1)
   * @returns Updated state after transfer
   */
  async transferInAppSession(
    appSessionId: Hash,
    from: Address,
    to: Address,
    asset: string,
    amount: string,
    currentAllocations: AppSessionAllocation[],
    version: number,
  ): Promise<AppSessionState> {
    console.log(
      `[AppSessionService] Transfer: ${amount} ${asset} from ${from} to ${to}`,
    );

    // Calculate FINAL allocations after transfer
    const newAllocations = this.transferAllocation(
      currentAllocations,
      from,
      to,
      asset,
      amount,
    );

    return await this.submitAppState(
      appSessionId,
      'OPERATE',
      version,
      newAllocations,
    );
  }

  /**
   * Withdraw funds from app session back to unified balance (gasless)
   *
   * In the Judge model, only the judge signature is needed.
   * Yellow docs: "Withdrawing participant signature NOT specifically required
   * (quorum sufficient)."
   *
   * @param appSessionId       - App session identifier
   * @param participant        - Participant whose allocation decreases
   * @param asset              - Asset identifier
   * @param amount             - Amount in human-readable format
   * @param currentAllocations - Current allocations (to compute FINAL state)
   * @param version            - Next version (currentVersion + 1)
   * @returns Updated state after withdrawal
   */
  async withdrawFromAppSession(
    appSessionId: Hash,
    participant: Address,
    asset: string,
    amount: string,
    currentAllocations: AppSessionAllocation[],
    version: number,
  ): Promise<AppSessionState> {
    console.log(
      `[AppSessionService] Withdraw: ${amount} ${asset} to ${participant}`,
    );

    // Calculate FINAL allocations after withdrawal
    const newAllocations = this.subtractAllocation(
      currentAllocations,
      participant,
      asset,
      amount,
    );

    return await this.submitAppState(
      appSessionId,
      'WITHDRAW',
      version,
      newAllocations,
    );
  }

  /**
   * Close app session and return funds to unified balance
   *
   * Per Yellow docs the field is "allocations", not "final_allocations".
   *
   * @param appSessionId    - App session identifier
   * @param finalAllocations - Final fund distribution
   * @returns Closure confirmation
   */
  async closeAppSession(
    appSessionId: Hash,
    finalAllocations: AppSessionAllocation[],
  ): Promise<{ success: boolean }> {
    console.log(`[AppSessionService] Closing app session ${appSessionId}...`);

    const requestId = this.ws.getNextRequestId();
    let request: RPCRequest = {
      req: [
        requestId,
        'close_app_session',
        {
          app_session_id: appSessionId,
          allocations: finalAllocations,
        },
        Date.now(),
      ],
      sig: [] as string[],
    };

    // Sign with session key
    request = await this.auth.signRequest(request);

    const response = await this.ws.send(request);

    // Check for error response from clearnode
    if (response.res[1] === 'error') {
      const errorData = response.res[2];
      const errorMsg =
        typeof errorData === 'object' && errorData !== null
          ? errorData.error || JSON.stringify(errorData)
          : String(errorData);
      console.error('[AppSessionService] close_app_session FAILED:', errorMsg);
      throw new Error(`close_app_session failed: ${errorMsg}`);
    }

    const closeData = response.res[2] || {};

    console.log('[AppSessionService] App session closed!');
    console.log(`  - Funds returned to unified balance`);

    return {
      success: closeData.success || true,
    };
  }

  /**
   * Compute app session ID from definition
   *
   * @param definition - App definition
   * @returns App session ID (deterministic hash)
   */
  computeAppSessionId(definition: AppDefinition): Hash {
    const definitionString = JSON.stringify({
      application: definition.application,
      protocol: definition.protocol,
      participants: definition.participants,
      weights: definition.weights,
      quorum: definition.quorum,
      challenge: definition.challenge,
      nonce: definition.nonce,
    });

    return keccak256(toBytes(definitionString));
  }

  // ============================================================================
  // Private Helper Methods — Safe Decimal Arithmetic
  // ============================================================================

  /**
   * Add amount to participant's allocation (safe decimal math, no floats)
   */
  private addAllocation(
    allocations: AppSessionAllocation[],
    participant: Address,
    asset: string,
    amount: string,
  ): AppSessionAllocation[] {
    const newAllocations = allocations.map((a) => ({ ...a }));
    const existing = newAllocations.find(
      (a) =>
        a.participant.toLowerCase() === participant.toLowerCase() &&
        a.asset === asset,
    );

    if (existing) {
      existing.amount = addDecimal(existing.amount, amount);
    } else {
      newAllocations.push({ participant, asset, amount });
    }

    return newAllocations;
  }

  /**
   * Subtract amount from participant's allocation (safe decimal math)
   */
  private subtractAllocation(
    allocations: AppSessionAllocation[],
    participant: Address,
    asset: string,
    amount: string,
  ): AppSessionAllocation[] {
    const newAllocations = allocations.map((a) => ({ ...a }));
    const existing = newAllocations.find(
      (a) =>
        a.participant.toLowerCase() === participant.toLowerCase() &&
        a.asset === asset,
    );

    if (!existing) {
      throw new Error(`Participant ${participant} has no ${asset} allocation`);
    }

    existing.amount = subtractDecimal(existing.amount, amount);

    return newAllocations;
  }

  /**
   * Transfer amount from one participant to another (safe decimal math)
   */
  private transferAllocation(
    allocations: AppSessionAllocation[],
    from: Address,
    to: Address,
    asset: string,
    amount: string,
  ): AppSessionAllocation[] {
    let newAllocations = this.subtractAllocation(
      allocations,
      from,
      asset,
      amount,
    );
    newAllocations = this.addAllocation(newAllocations, to, asset, amount);
    return newAllocations;
  }
}
