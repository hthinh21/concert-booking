# Tài liệu Thiết kế Hệ thống

## 1. Tổng quan Kiến trúc

```
┌──────────────────────────────────────────────────────────┐
│                    Tầng Client                           │
│              (Web App / Mobile / Postman)                 │
└───────────────────────┬──────────────────────────────────┘
                        │ HTTPS + JWT Bearer Token
                        ▼
┌──────────────────────────────────────────────────────────┐
│                   Ứng dụng NestJS                        │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  Guards: Xác thực JWT → Phân quyền theo vai trò     │ │
│  │  Interceptors: Bọc response chuẩn                   │ │
│  │  Filters: Xử lý lỗi toàn cục                        │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌────────┐   │
│  │   Auth   │  │  Concerts │  │ Bookings │  │Vouchers│   │
│  │  Module  │  │  Module   │  │  Module  │  │ Module │   │
│  └──────────┘  └───────────┘  └──────────┘  └────────┘   │
│                                     │                    │
│                          ┌──────────┴──────────┐         │
│                          │ Booking Scheduler   │         │
│                          │ (Cron: mỗi phút)    │         │
│                          └─────────────────────┘         │
└─────────┬────────────────────────────────┬───────────────┘
          │                                │
          ▼                                ▼
┌──────────────────┐            ┌──────────────────────┐
│   PostgreSQL 15  │            │      Redis 7         │
│                  │            │                      │
│  - Users         │            │  - Khóa phân tán     │
│  - Concerts      │            │  - Cache idempotency │
│  - TicketCategory│            │  - Bộ đếm voucher    │
│  - Bookings      │            │  - Cache phiên user  │
│  - BookingItems  │            │  - Blacklist token   │
│  - Vouchers      │            │                      │
│  - BookingVoucher│            │                      │
└──────────────────┘            └──────────────────────┘
```

## 2. Thiết kế Cơ sở dữ liệu

### Sơ đồ quan hệ thực thể (ER Diagram)

```
┌──────────────┐       ┌───────────────┐       ┌──────────────────┐
│    Users     │       │   Concerts    │       │ TicketCategories │
├──────────────┤       ├───────────────┤       ├──────────────────┤
│ id       (PK)│       │ id        (PK)│──────>│ id           (PK)│
│ email (UQ)   │       │ name          │       │ concertId    (FK)│
│ name         │       │ description   │       │ name             │
│ password     │       │ venue         │       │ price            │
│ role         │       │ date          │       │ totalQty         │
│ createdAt    │       │ status        │       │ reservedQty      │
│ updatedAt    │       │ createdAt     │       │ createdAt        │
└──────┬───────┘       │ updatedAt     │       │ updatedAt        │
       │               └───────┬───────┘       └────────┬─────────┘
       │                       │                        │
       │               ┌──────┴────────┐                │
       │               │   Bookings    │                │
       │               ├───────────────┤                │
       └──────────────▶│ id        (PK)│               │
                       │ userId    (FK)│                │
                       │ concertId (FK)│                │
                       │ status        │                │
                       │ idempotencyKey│                │
                       │ totalAmount   │                │
                       │ createdAt     │                │
                       │ updatedAt     │                │
                       └───┬───────┬───┘                │
                           │       │                    │
                  ┌────────┘       └────────┐           │
                  ▼                         ▼           │
         ┌────────────────┐       ┌─────────────────┐   │
         │ BookingVouchers│       │  BookingItems   │   │
         ├────────────────┤       ├─────────────────┤   │
         │ bookingId  (FK)│       │ id          (PK)│   │
         │ voucherId  (FK)│       │ bookingId   (FK)│   │
         └───────┬────────┘       │ ticketCatId (FK)│◀──┘
                 │                │ quantity        │
                 ▼                │ unitPrice       │
         ┌───────────────┐        └─────────────────┘
         │   Vouchers    │
         ├───────────────┤
         │ id        (PK)│
         │ code   (UQ)   │
         │ discountType  │
         │ discountValue │
         │ maxUses       │
         │ usedCount     │
         │ expiresAt     │
         │ createdAt     │
         └───────────────┘
```

### Lý do thiết kế

| Quyết định | Lý do |
|---|---|
| `reservedQty` trên TicketCategory | Cho phép kiểm tra số vé còn lại O(1): `totalQty - reservedQty`. Không cần SUM từ booking items mỗi lần truy vấn. |
| `idempotencyKey` trên Booking (UNIQUE) | Ngăn chặn đặt vé trùng lặp do client retry. Ràng buộc ở tầng DB là lớp bảo vệ cuối cùng. |
| `BookingVoucher` tách bảng riêng | Cho phép theo dõi booking nào dùng voucher nào. Hỗ trợ kiểm tra giới hạn sử dụng voucher theo từng user. |
| `Decimal(10,2)` cho giá | Tránh lỗi làm tròn số thực (floating-point) của JavaScript. |
| `status` là ENUM | Ràng buộc ở tầng DB các trạng thái hợp lệ. Tầng ứng dụng dùng state machine để kiểm soát chuyển trạng thái. |

### Indexes (tự động tạo bởi Prisma)
- `users.email` — UNIQUE
- `vouchers.code` — UNIQUE
- `bookings.idempotencyKey` — UNIQUE
- `booking_vouchers.bookingId` — UNIQUE (1 booking → tối đa 1 voucher)

## 3. Luồng đặt vé chính

### Sơ đồ tuần tự (Sequence Diagram)

```
Client                  Controller              Service                 Redis                  PostgreSQL
  │                        │                       │                      │                       │
  │ POST /bookings         │                       │                      │                       │
  │ + X-Idempotency-Key    │                       │                      │                       │
  │───────────────────────▶│                       │                      │                       │
  │                        │  create(dto, key)      │                      │                       │
  │                        │──────────────────────▶│                      │                       │
  │                        │                       │                      │                       │
  │                        │                       │ BƯỚC 1: Kiểm tra    │                       │
  │                        │                       │ idempotency          │                       │
  │                        │                       │─────────────────────▶│                       │
  │                        │                       │◀─────────────────────│                       │
  │                        │                       │                      │                       │
  │                        │                       │ BƯỚC 2-3: Kiểm tra  │                       │
  │                        │                       │ concert + hạng vé   │                       │
  │                        │                       │──────────────────────┼──────────────────────▶│
  │                        │                       │◀─────────────────────┼──────────────────────│
  │                        │                       │                      │                       │
  │                        │                       │ BƯỚC 4: Lấy khóa    │                       │
  │                        │                       │ phân tán (lock)      │                       │
  │                        │                       │─────────────────────▶│                       │
  │                        │                       │  (SET NX PX cho     │                       │
  │                        │                       │   từng ticketCatId) │                       │
  │                        │                       │◀─────────────────────│                       │
  │                        │                       │                      │                       │
  │                        │                       │ BƯỚC 5-6: Kiểm tra  │                       │
  │                        │                       │ tồn kho + voucher   │                       │
  │                        │                       │──────────────────────┼──────────────────────▶│
  │                        │                       │◀─────────────────────┼──────────────────────│
  │                        │                       │                      │                       │
  │                        │                       │ BƯỚC 7: Tính tổng   │                       │
  │                        │                       │ tiền                 │                       │
  │                        │                       │                      │                       │
  │                        │                       │ BƯỚC 8: DB           │                       │
  │                        │                       │ Transaction          │                       │
  │                        │                       │──────────────────────┼──────────────────────▶│
  │                        │                       │  BEGIN               │                       │
  │                        │                       │  INSERT booking      │                       │
  │                        │                       │  INSERT bookingItems │                       │
  │                        │                       │  UPDATE reservedQty  │                       │
  │                        │                       │  UPDATE voucherCount │                       │
  │                        │                       │  COMMIT              │                       │
  │                        │                       │◀─────────────────────┼──────────────────────│
  │                        │                       │                      │                       │
  │                        │                       │ BƯỚC 9: Đồng bộ     │                       │
  │                        │                       │ Redis                │                       │
  │                        │                       │─────────────────────▶│                       │
  │                        │                       │                      │                       │
  │                        │                       │ BƯỚC 10: Cache kết   │                       │
  │                        │                       │ quả idempotency 24h  │                       │
  │                        │                       │─────────────────────▶│                       │
  │                        │                       │                      │                       │
  │                        │                       │ BƯỚC 11: Giải phóng │                       │
  │                        │                       │ tất cả locks         │                       │
  │                        │                       │─────────────────────▶│                       │
  │                        │                       │                      │                       │
  │◀───────────────────────│◀──────────────────────│                      │                       │
  │  200 OK + dữ liệu     │                       │                      │                       │
```

## 4. Xử lý đồng thời & Race Condition

### Vấn đề: Bán quá số lượng vé (Overselling)
Hai người dùng cùng đặt vé VIP cuối cùng đồng thời.

### Giải pháp: Khóa phân tán Redis + DB Transaction

```
User A: POST /bookings (VIP x1)          User B: POST /bookings (VIP x1)
         │                                         │
         ▼                                         ▼
    Redis LOCK "lock:vip-cat-id"              Redis LOCK "lock:vip-cat-id"
     Lấy được lock                           Thất bại (key đã tồn tại)
         │                                         │
         ▼                                         ▼
    Kiểm tra tồn kho: còn 1 vé               Trả về 409 Conflict
    DB Transaction: đặt 1 vé                  "Vui lòng thử lại sau"
    Giải phóng lock
         │
         ▼
     Đặt vé thành công
```

Các quyết định thiết kế quan trọng:
- **Mức độ chi tiết của lock**: Theo `ticketCategoryId`, không phải theo concert — cho phép đặt vé đồng thời cho các hạng khác nhau
- **Thứ tự lock**: Sắp xếp category ID trước khi lấy lock — tránh deadlock
- **TTL của lock**: 10 giây — tự giải phóng nếu tiến trình crash
- **Lock voucher**: Khóa riêng `voucher-apply:<code>` — ngăn sử dụng trùng giữa các hạng vé khác nhau

### Vấn đề: Đặt vé trùng lặp do retry
Mạng timeout khiến client gửi lại cùng request.

### Giải pháp: Khóa Idempotency

```
Request 1: POST /bookings (Key: abc-123)   Request 2: POST /bookings (Key: abc-123)
         │                                           │
         ▼                                           ▼
    Redis: GET idempotency:abc-123             Redis: GET idempotency:abc-123
    → null (lần đầu)                           → có kết quả cache!
         │                                           │
         ▼                                           ▼
    Xử lý đặt vé bình thường                  Trả về kết quả cache
    Cache kết quả → Redis (TTL 24h)            (_fromCache: true)
```

### Vấn đề: Lạm dụng mã giảm giá (Voucher abuse)
Một user dùng cùng voucher cho nhiều đơn.

### Giải pháp: Kiểm tra nhiều tầng

```
Tầng 1: Flag Redis theo user   — voucher:used:{voucherId}:{userId}
Tầng 2: DB BookingVoucher      — dự phòng khi Redis mất cache
Tầng 3: Bộ đếm Redis toàn cục  — voucher:usedCount:{voucherId} so với maxUses
Tầng 4: DB usedCount           — nguồn dữ liệu chính xác nhất
```

## 5. Máy trạng thái Đơn hàng (State Machine)

```
                    ┌─────────────┐
                    │   PENDING   │
                    │ (Chờ xử lý) │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
      ┌───────────┐  ┌──────────┐  ┌─────────┐
      │ CONFIRMED │  │CANCELLED │  │ EXPIRED │
      │(Xác nhận) │  │ (Đã hủy) │  │(Hết hạn)│
      └─────┬─────┘  └──────────┘  └────┬────┘
            │                            │
            └─────────┐    ┌─────────────┘
                      ▼    ▼
                 ┌──────────┐
                 │CANCELLED │
                 │ (Đã hủy) │
                 └──────────┘
```

| Chuyển trạng thái | Kích hoạt bởi | Hành động với tồn kho |
|---|---|---|
| PENDING → CONFIRMED | Vận hành xác nhận thanh toán | Không (vé đã được giữ) |
| PENDING → CANCELLED | Vận hành/khách hàng hủy | Hoàn lại reservedQty + voucher |
| PENDING → EXPIRED | Cron job (quá 10 phút) | Hoàn lại reservedQty + voucher |
| CONFIRMED → CANCELLED | Vận hành hoàn tiền | Hoàn lại reservedQty + voucher |
| EXPIRED → CANCELLED | Vận hành dọn dẹp | Không (đã hoàn lại rồi) |

### Cơ chế tự động hết hạn
Cron job chạy **mỗi phút** và:
1. Tìm tất cả đơn hàng PENDING quá 10 phút
2. Chạy DB transaction cho từng đơn: chuyển EXPIRED + hoàn tồn kho
3. Dùng `Promise.allSettled` — một đơn lỗi không ảnh hưởng đơn khác
4. Đồng bộ bộ đếm Redis sau khi DB commit

## 6. Tổng hợp cách sử dụng Redis

| Mẫu Key | Mục đích | TTL |
|---|---|---|
| `lock:<resource>` | Khóa phân tán (SET NX PX) | 10 giây |
| `idempotency:<key>` | Cache kết quả đặt vé | 24 giờ |
| `voucher:usedCount:<id>` | Bộ đếm voucher toàn cục | Không hết hạn |
| `voucher:used:<vId>:<uId>` | Flag voucher theo user | Không hết hạn |
| `user:<userId>` | Cache phiên người dùng | 1 giờ |
| `blacklist:<token>` | Blacklist JWT sau đăng xuất | Bằng thời gian còn lại của token |

## 7. Bảo mật

| Cơ chế | Triển khai |
|---|---|
| Xác thực | JWT Bearer Token (hết hạn sau 7 ngày) |
| Phân quyền | Theo vai trò: CUSTOMER, OPERATOR, ADMIN |
| Blacklist Token | Redis blacklist khi đăng xuất (TTL = thời gian token còn lại) |
| Mật khẩu | Mã hóa bcrypt (10 vòng salt) |
| Kiểm tra đầu vào | class-validator decorators trên tất cả DTO |
| Chống SQL Injection | Prisma parameterized queries (tầng ORM) |
