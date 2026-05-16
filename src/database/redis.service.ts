import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis;

  onModuleInit() {
    this.client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  // Lưu một giá trị với thời gian hết hạn (giây)
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, value);
    } else {
      await this.client.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  // Tăng counter nguyên tử — an toàn khi nhiều request đồng thời
  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  // Giảm counter nguyên tử
  async decr(key: string): Promise<number> {
    return this.client.decr(key);
  }

  // Xóa nhiều key theo pattern, VD: 'concerts:list:*'
  // Dùng SCAN thay vì KEYS để tránh block Redis trên Production
  async delByPattern(pattern: string): Promise<void> {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } while (cursor !== '0');
  }

  // ─── Distributed Lock ───────────────────────────────────
  // SET NX EX — nguyên tử, chống oversell concurrent
  // ttlMs: thời gian lock tối đa (ms), tự release nếu process crash
  async acquireLock(resource: string, ttlMs: number): Promise<boolean> {
    const key = `lock:${resource}`;
    const result = await this.client.set(key, '1', 'PX', ttlMs, 'NX');
    return result === 'OK';
  }

  async releaseLock(resource: string): Promise<void> {
    await this.client.del(`lock:${resource}`);
  }

  // ─── Idempotency ────────────────────────────────────────
  // Lưu kết quả booking để chống duplicate khi client retry
  async getIdempotency(key: string): Promise<string | null> {
    return this.client.get(`idempotency:${key}`);
  }

  async setIdempotency(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.setex(`idempotency:${key}`, ttlSeconds, value);
  }
}
