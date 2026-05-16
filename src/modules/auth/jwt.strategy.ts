import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET || 'null',
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: { sub: string; email: string; role: string }) {
    // Lấy token raw từ Authorization header
    const token = req.headers.authorization?.split(' ')[1];

    // Kiểm tra xem token có nằm trong blacklist không
    if (token) {
      const isBlacklisted = await this.redis.exists(`blacklist:${token}`);
      if (isBlacklisted) throw new UnauthorizedException('Token has been revoked');
    }

    // Thử lấy user từ Redis cache trước
    const cachedUser = await this.redis.get(`user:${payload.sub}`);
    if (cachedUser) {
      return JSON.parse(cachedUser);
    }

    // Nếu không có cache thì truy vấn DB
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, role: true },
    });
    if (!user) throw new UnauthorizedException();

    // Lưu vào cache cho lần sau
    await this.redis.set(`user:${payload.sub}`, JSON.stringify(user), 3600);

    return user;
  }
}