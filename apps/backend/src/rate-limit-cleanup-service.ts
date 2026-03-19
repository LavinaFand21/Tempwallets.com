import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from './database/prisma.service.js';

@Injectable()
export class RateLimitCleanupService {
  private readonly logger = new Logger(RateLimitCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT) // Runs at 00:00:00 every day (server time)
  async cleanupExpiredRateLimits() {
    this.logger.log('Starting cleanup of expired rate limit records...');

    try {
      const result = await this.prisma.rateLimit.deleteMany({
        where: {
          resetAt: {
            lt: new Date(), // Deletes records where resetAt is in the past
          },
        },
      });

      this.logger.log(`Cleanup done: deleted ${result.count} expired records`);
    } catch (error: any) {
      this.logger.error('Cleanup failed', error.stack);
    }
  }
}