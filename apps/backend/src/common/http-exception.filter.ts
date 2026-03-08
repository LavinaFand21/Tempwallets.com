/**
 * Global HTTP exception filter.
 *
 * Catches all exceptions and returns a consistent JSON shape:
 *   { ok: false, message: "Short user-facing explanation" }
 *
 * Strips internal details (stack traces, raw Error classes) so the
 * frontend always receives a usable error message.
 */

import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

/** Map common error patterns to short, user-facing messages. */
function friendlyMessage(raw: string): string {
  const lower = raw.toLowerCase();

  if (lower.includes('not authenticated'))
    return 'Not authenticated with Yellow Network. Please re-authenticate.';
  if (lower.includes('not a participant'))
    return 'You are not a participant in this session.';
  if (lower.includes('insufficient') || lower.includes('not enough'))
    return 'Insufficient balance for this operation.';
  if (lower.includes('zero-sum') || lower.includes('non-zero allocations sum'))
    return 'OPERATE failed: allocations must sum to exactly the current session total.';
  if (lower.includes('session') && lower.includes('closed'))
    return 'This session is already closed.';
  if (lower.includes('channel') && lower.includes('already exists'))
    return 'A payment channel already exists for this wallet.';
  if (lower.includes('timeout') || lower.includes('timed out'))
    return 'The operation timed out. Please try again.';
  if (lower.includes('nonce'))
    return 'Transaction nonce conflict. Please wait a moment and retry.';
  if (lower.includes('revert'))
    return 'On-chain transaction reverted. Check your balance and try again.';

  // Fallback — use the raw message but cap length
  return raw.length > 200 ? raw.slice(0, 200) + '...' : raw;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let rawMessage = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      rawMessage =
        typeof body === 'string'
          ? body
          : (body as any)?.message
            ? Array.isArray((body as any).message)
              ? (body as any).message.join('. ')
              : String((body as any).message)
            : exception.message;
    } else if (exception instanceof Error) {
      rawMessage = exception.message;
    }

    // Log the full error server-side for debugging
    console.error(
      `[ExceptionFilter] ${status} - ${rawMessage}`,
      exception instanceof Error ? exception.stack : '',
    );

    response.status(status).json({
      ok: false,
      message: friendlyMessage(rawMessage),
    });
  }
}
