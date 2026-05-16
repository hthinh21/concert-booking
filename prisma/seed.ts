import { PrismaClient, Role, ConcertStatus, DiscountType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Users
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

  // Concerts
  const concert = await prisma.concert.create({
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
  });

  // Vouchers
  await prisma.voucher.createMany({
    data: [
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
    ],
  });

}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());