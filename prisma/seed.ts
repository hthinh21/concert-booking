import { PrismaClient, Role, ConcertStatus, DiscountType } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import { Logger } from '@nestjs/common';
import 'dotenv/config';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  Logger.log('Starting seed...');

  // ── Users ──────────────────────────────────────────────
  const hashedPassword = await bcrypt.hash('password123', 10);

  const customer = await prisma.user.upsert({
    where: { email: 'customer@test.com' },
    update: {},
    create: {
      email: 'customer@test.com',
      name: 'Test Customer',
      password: hashedPassword,
      role: Role.CUSTOMER,
    },
  });

  const operator = await prisma.user.upsert({
    where: { email: 'operator@test.com' },
    update: {},
    create: {
      email: 'operator@test.com',
      name: 'Test Operator',
      password: hashedPassword,
      role: Role.OPERATOR,
    },
  });

  const admin = await prisma.user.upsert({
    where: { email: 'admin@test.com' },
    update: {},
    create: {
      email: 'admin@test.com',
      name: 'Test Admin',
      password: hashedPassword,
      role: Role.ADMIN,
    },
  });

  Logger.log('Users seeded:', customer.email, operator.email, admin.email);

  // ── Concerts ───────────────────────────────────────────
  // Dùng upsert theo name để tránh duplicate khi chạy seed nhiều lần
  const existingConcert = await prisma.concert.findFirst({
    where: { name: 'HOANGTHINH CONCERT 2026' },
  });

  let concert;
  if (!existingConcert) {
    concert = await prisma.concert.create({
      data: {
        name: 'HOANGTHINH CONCERT 2026',
        description: 'The most anticipated concert of the year',
        venue: 'Phú Thọ Stadium, Ho Chi Minh',
        date: new Date('2026-12-31T19:00:00Z'),
        status: ConcertStatus.PUBLISHED,
        ticketCategories: {
          create: [
            {
              name: 'VIP',
              price: 5000000,
              totalQty: 100,
              reservedQty: 0,
            },
            {
              name: 'Standard',
              price: 2000000,
              totalQty: 500,
              reservedQty: 0,
            },
            {
              name: 'Economy',
              price: 800000,
              totalQty: 1000,
              reservedQty: 0,
            },
          ],
        },
      },
      include: { ticketCategories: true },
    });
    Logger.log('Concert seeded:', concert.name);
    Logger.log('Ticket categories:');
    concert.ticketCategories.forEach((t) => {
      Logger.log(`   - ${t.name}: ${t.price.toLocaleString()}đ x ${t.totalQty} tickets`);
    });
  } else {
    concert = existingConcert;
    Logger.log('Concert already exists, skipping:', concert.name);
  }

  // Seed 1 concert DRAFT để test publish flow
  const existingDraft = await prisma.concert.findFirst({
    where: { name: 'DRAFT CONCERT - TEST PUBLISH' },
  });

  if (!existingDraft) {
    const draftConcert = await prisma.concert.create({
      data: {
        name: 'DRAFT CONCERT - TEST PUBLISH',
        description: 'Use this to test the publish flow',
        venue: 'Hội trường Thống Nhất, Ho Chi Minh',
        date: new Date('2027-06-15T18:00:00Z'),
        status: ConcertStatus.DRAFT,
        ticketCategories: {
          create: [
            {
              name: 'Standard',
              price: 1500000,
              totalQty: 200,
              reservedQty: 0,
            },
          ],
        },
      },
    });
    Logger.log('Draft concert seeded:', draftConcert.name);
  }

  // ── Vouchers ───────────────────────────────────────────
  const vouchers = [
    {
      code: 'FLASHSALE50',
      discountType: DiscountType.PERCENTAGE,
      discountValue: 50,
      maxUses: 100,
      usedCount: 0,
      expiresAt: new Date('2026-12-31'),
    },
    {
      code: 'WELCOME100K',
      discountType: DiscountType.FIXED_AMOUNT,
      discountValue: 100000,
      maxUses: 200,
      usedCount: 0,
      expiresAt: new Date('2026-12-31'),
    },
    {
      code: 'GEEKUP20',
      discountType: DiscountType.PERCENTAGE,
      discountValue: 20,
      maxUses: 50,
      usedCount: 0,
      expiresAt: new Date('2026-12-31'),
    },
  ];

  for (const v of vouchers) {
    const existing = await prisma.voucher.findUnique({
      where: { code: v.code },
    });
    if (!existing) {
      await prisma.voucher.create({ data: v });
      Logger.log(`Voucher seeded: ${v.code} (${v.discountValue}${v.discountType === DiscountType.PERCENTAGE ? '%' : 'đ'} off)`);
    } else {
      Logger.log(`Voucher already exists: ${v.code}`);
    }
  }

  // ── Summary ────────────────────────────────────────────
  Logger.log('Seed completed!');
  Logger.log('─'.repeat(40));
  Logger.log('Test accounts:');
  Logger.log('   Customer : customer@test.com / password123');
  Logger.log('   Operator : operator@test.com / password123');
  Logger.log('   Admin    : admin@test.com    / password123');
  Logger.log('Concerts:');
  Logger.log('   HOANGTHINH CONCERT 2026 (PUBLISHED)');
  Logger.log('   DRAFT CONCERT - TEST PUBLISH (DRAFT)');
  Logger.log('Vouchers:');
  Logger.log('   FLASHSALE50 → 50% off (max 100 uses)');
  Logger.log('   WELCOME100K → 100,000đ off (max 200 uses)');
  Logger.log('   GEEKUP20    → 20% off (max 50 uses)');
  Logger.log('─'.repeat(40));
}

main()
  .catch(Logger.error)
  .finally(() => prisma.$disconnect());