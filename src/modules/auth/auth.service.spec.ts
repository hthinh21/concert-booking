import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../../database/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from '../../database/redis.service';
import { UnauthorizedException, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

// Mock bcrypt
jest.mock('bcryptjs');

describe('AuthService', () => {
  let service: AuthService;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let redis: RedisService;

  // Mock user trả về từ DB
  const mockUser = {
    id: 'user-uuid-123',
    email: 'test@test.com',
    name: 'Test User',
    password: 'hashed-password',
    role: 'CUSTOMER',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          // Mock PrismaService — không cần kết nối DB thật
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn(),
              create: jest.fn(),
            },
          },
        },
        {
          // Mock JwtService
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('mock-jwt-token'),
            decode: jest.fn().mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 }),
          },
        },
        {
          // Mock RedisService
          provide: RedisService,
          useValue: {
            set: jest.fn(),
            get: jest.fn(),
            del: jest.fn(),
            exists: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get<PrismaService>(PrismaService);
    jwtService = module.get<JwtService>(JwtService);
    redis = module.get<RedisService>(RedisService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── LOGIN ────────────────────────────────────────────

  describe('login', () => {
    const loginDto = { email: 'test@test.com', password: 'password123' };

    it('should return token and user on valid credentials', async () => {
      // Arrange — chuẩn bị dữ liệu giả
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      // Act — gọi hàm cần test
      const result = await service.login(loginDto);

      // Assert — kiểm tra kết quả
      expect(result.accessToken).toBe('mock-jwt-token');
      expect(result.user.email).toBe('test@test.com');
      expect(result.user.role).toBe('CUSTOMER');
      // Kiểm tra password KHÔNG được trả về
      expect(result.user).not.toHaveProperty('password');
      // Kiểm tra Redis cache user
      expect(redis.set).toHaveBeenCalledWith(
        `user:${mockUser.id}`,
        expect.any(String),
        3600,
      );
    });

    it('should throw UnauthorizedException if user not found', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if password is wrong', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false); // Sai password

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ─── REGISTER ─────────────────────────────────────────

  describe('register', () => {
    const registerDto = {
      email: 'new@test.com',
      name: 'New User',
      password: 'password123',
    };

    it('should create user and return token', async () => {
      const newUser = { ...mockUser, email: 'new@test.com', name: 'New User' };

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null); // Email chưa tồn tại
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
      (prisma.user.create as jest.Mock).mockResolvedValue(newUser);

      const result = await service.register(registerDto);

      expect(result.accessToken).toBe('mock-jwt-token');
      expect(result.user.email).toBe('new@test.com');
      expect(result.user).not.toHaveProperty('password');
    });

    it('should throw ConflictException if email already exists', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser); // Email đã tồn tại

      await expect(service.register(registerDto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ─── LOGOUT ───────────────────────────────────────────

  describe('logout', () => {
    it('should blacklist token in Redis with correct TTL', async () => {
      const futureExp = Math.floor(Date.now() / 1000) + 1800; // Còn 30 phút
      (jwtService.decode as jest.Mock).mockReturnValue({ exp: futureExp });

      await service.logout('some-jwt-token');

      expect(redis.set).toHaveBeenCalledWith(
        'blacklist:some-jwt-token',
        '1',
        expect.any(Number), // TTL tính bằng giây
      );
    });

    it('should NOT blacklist if token already expired', async () => {
      const pastExp = Math.floor(Date.now() / 1000) - 100; // Đã hết hạn
      (jwtService.decode as jest.Mock).mockReturnValue({ exp: pastExp });

      await service.logout('expired-token');

      // Redis.set KHÔNG được gọi vì token đã hết hạn
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  // ─── TOKEN BLACKLIST CHECK ────────────────────────────

  describe('isTokenBlacklisted', () => {
    it('should return true if token is blacklisted', async () => {
      (redis.exists as jest.Mock).mockResolvedValue(true);

      const result = await service.isTokenBlacklisted('blacklisted-token');
      expect(result).toBe(true);
    });

    it('should return false if token is NOT blacklisted', async () => {
      (redis.exists as jest.Mock).mockResolvedValue(false);

      const result = await service.isTokenBlacklisted('valid-token');
      expect(result).toBe(false);
    });
  });
});
