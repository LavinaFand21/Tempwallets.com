import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

@Injectable()
export class DeviceIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    let deviceId = req.cookies?.deviceId;

    if (!deviceId) {
      deviceId = randomUUID();
      res.cookie('deviceId', deviceId, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 365 * 24 * 60 * 60 * 1000,
      });
    }

    (req as any).deviceId = deviceId;
    next();
  }
}
