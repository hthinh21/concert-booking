# Nền tảng Đặt Vé Concert — Backend

Hệ thống Backend API cho Nền tảng Đặt Vé Concert, được thiết kế để xử lý các tình huống Flash Sale với lượng truy cập đồng thời cao. Ở đây được triển khai bằng Redis chứ chưa áp dụng Kafka,... vì yêu cầu chỉ xử lý khoảng 50,000 users, đỉnh điểm traffic khoảng 300-500 requests/phút thì Redis có thể xử lý tốt. Có thể hệ thống chưa hoàn hảo
nhưng với thời gian ngắn hạn thì là có thể chấp nhận được. Trong tương lai có thể tối ưu hoặc thay thế bằng Kafka,... Trong hệ thống đã lược bỏ phần Payment và chỉ dừng lại ở trạng thái booking thành công, sau đó sẽ tự động chuyển đổi status của booking sau 10 phút nếu chưa thanh toán( có cron job để kiểm tra các booking quá hạn và chuyển sang status CANCELLED).

## Công nghệ sử dụng

| Layer | Technology |
|---|---|
| Framework | NestJS (TypeScript) |
| Database | PostgreSQL 15 |
| Cache / Lock | Redis 7 |
| ORM | Prisma 7 |
| Auth | JWT Bearer Token |
| API Docs | Swagger (auto-generated) |
| Container | Docker Compose |
| Scheduler | @nestjs/schedule (Cron) |

## Khởi chạy nhanh (Docker)

```bash
git clone https://github.com/hthinh21/concert-booking.git
cd concert-booking
docker compose up --build
```

Chỉ cần 1 lệnh duy nhất. Hệ thống sẽ tự động:
1. Khởi động PostgreSQL + Redis
2. Build ứng dụng NestJS
3. Chạy database migration
4. Seed dữ liệu mẫu (users, concerts, vouchers)
5. Khởi động server

**Server:** http://localhost:3000
**Swagger API Docs:** http://localhost:3000/api/docs

## Khởi chạy local (cho Developer)

```bash
# 1. Cài đặt dependencies
npm install

# 2. Chỉ khởi động PostgreSQL + Redis
docker compose up -d postgres redis

# 3. Tạo file cấu hình
cp .env.example .env

# 4. Chạy migration
npx prisma migrate dev

# 5. Seed dữ liệu mẫu
npx prisma db seed

# 6. Khởi động server (có hot reload)
npm run start:dev
```

## Tài khoản test (đã được seed sẵn)

| Vai trò | Email | Mật khẩu |
|---|---|---|
| Khách hàng | customer@test.com | password123 |
| Vận hành | operator@test.com | password123 |
| Quản trị | admin@test.com | password123 |

## Tài liệu API

Swagger UI tại: **http://localhost:3000/api/docs**

### Tổng quan API

#### API dành cho khách hàng
| Method | Endpoint | Mô tả |
|---|---|---|
| POST | `/api/v1/auth/login` | Đăng nhập, nhận JWT token |
| POST | `/api/v1/auth/register` | Đăng ký tài khoản mới |
| POST | `/api/v1/auth/logout` | Đăng xuất, vô hiệu hóa token |
| GET | `/api/v1/concerts` | Duyệt danh sách concert đang mở bán |
| GET | `/api/v1/concerts/:id` | Chi tiết concert |
| GET | `/api/v1/concerts/:id/tickets` | Xem hạng vé và giá |
| POST | `/api/v1/bookings` | Đặt vé (yêu cầu header `X-Idempotency-Key`) |
| GET | `/api/v1/bookings/my` | Danh sách đơn hàng của tôi (lọc theo trạng thái) |
| GET | `/api/v1/bookings/:id` | Chi tiết đơn hàng + theo dõi trạng thái |
| POST | `/api/v1/vouchers/validate` | Kiểm tra mã giảm giá trước khi đặt |

#### API dành cho vận hành (Operation Dashboard)
| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/v1/admin/concerts` | Danh sách tất cả concert kèm thống kê |
| POST | `/api/v1/admin/concerts` | Tạo concert mới (trạng thái DRAFT) |
| PATCH | `/api/v1/admin/concerts/:id/publish` | Xuất bản concert (DRAFT → PUBLISHED) |
| POST | `/api/v1/admin/concerts/:id/tickets` | Thêm hạng vé cho concert |
| GET | `/api/v1/admin/concerts/:id/tickets/availability` | Kiểm tra số vé còn lại |
| GET | `/api/v1/admin/bookings` | Theo dõi tất cả đơn hàng (lọc theo trạng thái/concert) |
| GET | `/api/v1/admin/bookings/:id` | Chi tiết đơn hàng (góc nhìn admin) |
| PATCH | `/api/v1/admin/bookings/:id/status` | Cập nhật trạng thái đơn hàng thủ công |
| POST | `/api/v1/admin/vouchers` | Tạo chiến dịch mã giảm giá |
| GET | `/api/v1/admin/vouchers` | Danh sách mã giảm giá kèm thống kê sử dụng |
| GET | `/api/v1/admin/vouchers/:id` | Chi tiết mã giảm giá kèm lịch sử sử dụng |

## Postman Collection

Import file `postman/geekup-concert-booking.postman_collection.json` vào Postman.

Chạy theo thứ tự:
1. **Login - Customer** → tự động lưu token vào biến collection
2. **Login - Operator** → tự động lưu token
3. **List Published Concerts** → tự động lưu `concertId`
4. **Get Ticket Categories** → tự động lưu `ticketCategoryId`
5. **Create Booking** → tự động tạo `X-Idempotency-Key`, lưu `bookingId`
6. **Retry Same Booking** → kiểm tra idempotency (phải trả về kết quả cache)
7. **Confirm Booking** (operator) → kiểm tra state machine

## Unit Test

```bash
# Chạy tất cả tests
npm run test

# Chạy test 1 file cụ thể
npm run test -- auth.service.spec

# Chạy kèm báo cáo coverage
npm run test:cov
```

## Quy ước viết code

### Cách tạo API mới

```
1. Định nghĩa DTO   → src/modules/<module>/dto/<module>.dto.ts
2. Viết Service      → src/modules/<module>/<module>.service.ts
3. Viết Controller   → src/modules/<module>/<module>.controller.ts
4. Đăng ký Module    → src/modules/<module>/<module>.module.ts
5. Import vào App    → src/app.module.ts (nếu là module mới)
```

### Cách viết unit test

```typescript
// src/modules/<module>/<module>.service.spec.ts
describe('MyService', () => {
  let service: MyService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        MyService,
        { provide: PrismaService, useValue: { /* mock */ } },
        { provide: RedisService, useValue: { /* mock */ } },
      ],
    }).compile();
    service = module.get(MyService);
  });

  it('should do something', async () => {
    const result = await service.someMethod(dto);
    expect(result).toBeDefined();
  });
});
```

## Cấu trúc dự án

```
src/
├── modules/
│   ├── auth/            # Đăng nhập / đăng ký / đăng xuất (JWT)
│   ├── concerts/        # API concert cho khách hàng + vận hành
│   ├── bookings/        # API đặt vé cho khách hàng + vận hành
│   │   ├── bookings.service.ts         # Logic đặt vé chính
│   │   └── booking-scheduler.service.ts # Cron job tự động hết hạn
│   └── vouchers/        # API mã giảm giá cho khách hàng + vận hành
├── common/
│   ├── guards/          # JwtAuthGuard, RolesGuard
│   ├── filters/         # HttpExceptionFilter
│   ├── interceptors/    # ResponseInterceptor
│   └── decorators/      # @CurrentUser(), @Roles()
├── config/              # Cấu hình môi trường
├── database/
│   ├── prisma.service.ts  # Kết nối cơ sở dữ liệu
│   └── redis.service.ts   # Cache + Lock + Idempotency
└── main.ts              # Khởi tạo ứng dụng + Swagger
prisma/
├── schema.prisma        # Schema cơ sở dữ liệu
├── migrations/          # Migration tự động sinh
└── seed.ts              # Dữ liệu mẫu
postman/                 # Postman collection
docs/                    # Tài liệu thiết kế hệ thống
```

## Reset Database

```bash
npm run db:reset
```
