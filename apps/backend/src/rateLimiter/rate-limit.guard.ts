import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js'; // Adjust path if needed
import { verifyProof } from 'zkarb-sdk';
import path from 'path';

const LIMIT = 100;
const WINDOW_MS = 24*60*60 * 1000; // Change to 24*60*60*1000 for production

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const deviceId: string = req.deviceId;

    if (!deviceId) {
      this.logger.warn('No deviceId found – allowing request');
      return true;
    }

    const nowMs = Date.now();
    const windowEndMs = nowMs + WINDOW_MS;

    this.logger.log(`[RateLimit] Request for device ${deviceId} at ${new Date(nowMs).toISOString()}`);

    return this.prisma.$transaction(async (tx: any) => {
      // Fetch current record
      let record = await tx.rateLimit.findUnique({
        where: { deviceId },
      });

      this.logger.debug(`[RateLimit] DB record: ${JSON.stringify(record)}`);

      let shouldReset = !record || (record.resetAt?.getTime() ?? 0) < nowMs;

      this.logger.log(
        `[RateLimit] shouldReset = ${shouldReset} | resetAt = ${
          record?.resetAt ? new Date(record.resetAt).toISOString() : 'none'
        } | now = ${new Date(nowMs).toISOString()}`,
      );

      if (shouldReset) {
        this.logger.log(`[RateLimit] Resetting window – setting count=1`);
        record = await tx.rateLimit.upsert({
          where: { deviceId },
          create: {
            deviceId,
            count: 1,
            resetAt: new Date(windowEndMs),
          },
          update: {
            count: 1,
            resetAt: new Date(windowEndMs),
          },
        });
      } else {
        this.logger.log(`[RateLimit] Window still active – current count = ${record.count}`);
      }

      // At this point record.count should reflect the real value
      this.logger.log(`[RateLimit] Final count before ZK = ${record.count}`);

      // Prepare ZK input with REAL count
      const zkInput = {
        count: record.count,
        limit: LIMIT,
      };

      this.logger.log(`[ZK] Input being sent: ${JSON.stringify(zkInput)}`);

      const generatedFolder = path.resolve(process.cwd(), 'zk/rate-limit');

      // Run ZK verification
      let zkResult: any;
      try {
        zkResult = await verifyProof(zkInput, generatedFolder);
        this.logger.log(`[ZK] Verification result: ${JSON.stringify(zkResult)}`);
      } catch (err: any) {
        this.logger.error(`[ZK] Proof verification failed: ${err.message}`, err.stack);
        throw new HttpException(
          { message: 'ZK verification error' },
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      // Assuming publicSignals[0] === "1" means allowed (count < limit)
      const isAllowed = zkResult?.publicSignals?.[0] === '1' || zkResult?.publicSignals?.[0] === 1;

      if (!isAllowed) {
        const retryAfter = Math.ceil((record.resetAt.getTime() - nowMs) / 1000);
        this.logger.warn(`[RateLimit] ZK denied – count ${record.count} >= ${LIMIT}`);

        throw new HttpException(
          {
            message: 'ZK-verified rate limit exceeded. Try again later.',
            retryAfterSeconds: retryAfter,
            limit: LIMIT,
            remaining: 0,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // ZK passed → safe to increment
      this.logger.log(`[RateLimit] ZK allowed – incrementing count to ${record.count + 1}`);

      await tx.rateLimit.update({
        where: { deviceId },
        data: { count: { increment: 1 } },
      });

      // Fetch final state for response headers / info
      record = await tx.rateLimit.findUniqueOrThrow({
        where: { deviceId },
      });
      req.deviceLimitRemaining = LIMIT - record.count;
      req.deviceLimitResetsAt = record.resetAt.getTime();

      return true;
    });
  }
}