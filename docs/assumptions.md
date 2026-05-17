# Giả định & Phạm vi

## Giả định

### Giả định nghiệp vụ
1. **Đặt vé = Giữ chỗ**: Tạo booking nghĩa là "giữ vé". Đơn hàng bắt đầu ở trạng thái `PENDING` và chờ xác nhận thanh toán từ đội vận hành.
2. **Không tích hợp cổng thanh toán**: Hệ thống không kết nối với bất kỳ nhà cung cấp thanh toán nào (Stripe, VNPay...). Xác nhận thanh toán được thực hiện thủ công bởi operator qua API admin (`PATCH /admin/bookings/:id/status`).
3. **Đặt vé cho 1 sự kiện mỗi đơn**: Mỗi đơn hàng chỉ dành cho 1 concert. Muốn đặt vé cho nhiều concert cần tạo nhiều đơn.
4. **Mỗi đơn tối đa 1 voucher**: Một đơn hàng chỉ áp dụng được tối đa 1 mã giảm giá.
5. **Mỗi user chỉ dùng 1 voucher 1 lần**: Mỗi người dùng chỉ được sử dụng một mã voucher cụ thể 1 lần. Cố sử dụng lại sẽ trả về lỗi.
6. **Thời gian giữ vé 10 phút**: Nếu đơn PENDING không được xác nhận trong 10 phút, đơn tự động hết hạn và vé được trả lại pool.

### Giả định kỹ thuật
1. **Triển khai đơn instance**: Kiến trúc hiện tại chạy 1 instance NestJS. Khóa phân tán Redis được thiết kế để hoạt động trong cả môi trường đa instance.
2. **Redis là bắt buộc**: Redis cần hoạt động để hệ thống chạy (lock, idempotency, bộ đếm). Nếu Redis chết, việc tạo booking sẽ trả về lỗi.
3. **PostgreSQL là nguồn dữ liệu chính**: Redis chỉ là tầng cache/lock. PostgreSQL là nơi lưu trữ dữ liệu chính xác nhất. Nếu dữ liệu Redis bị mất, hệ thống tự khôi phục từ DB ở request tiếp theo.

## Đã triển khai

### Tính năng cho khách hàng
| Tính năng | Trạng thái | Chi tiết |
|---|---|---|
| Duyệt concert | Hoàn thành | Danh sách concert đang mở bán, có phân trang + tìm kiếm |
| Xem hạng vé và giá | Hoàn thành | Bao gồm số vé còn lại (totalQty - reservedQty) |
| Đặt vé | Hoàn thành | Luồng giao dịch đầy đủ với bảo vệ đồng thời |
| Áp dụng mã giảm giá | Hoàn thành | Hỗ trợ giảm theo PHẦN TRĂM và SỐ TIỀN CỐ ĐỊNH |
| Theo dõi trạng thái đơn | Hoàn thành | Xem chi tiết đơn hàng với trạng thái hiện tại |

### Tính năng cho đội vận hành (Operation Dashboard)
| Tính năng | Trạng thái | Chi tiết |
|---|---|---|
| Tạo concert | Hoàn thành | Tạo ở trạng thái DRAFT |
| Xuất bản concert | Hoàn thành | Chuyển DRAFT → PUBLISHED |
| Thêm hạng vé | Hoàn thành | VIP, Standard, Economy, v.v. |
| Kiểm tra số vé còn lại | Hoàn thành | Số vé có sẵn theo thời gian thực cho từng hạng |
| Theo dõi đơn hàng | Hoàn thành | Lọc theo trạng thái, concertId, có phân trang |
| Cập nhật trạng thái đơn | Hoàn thành | State machine chỉ cho phép chuyển trạng thái hợp lệ |
| Xử lý đơn lỗi | Hoàn thành | Trạng thái CANCELLED + tự động hoàn tồn kho |
| Tạo chiến dịch voucher | Hoàn thành | PERCENTAGE / FIXED_AMOUNT với giới hạn maxUses |
| Danh sách voucher kèm thống kê | Hoàn thành | Số lần sử dụng, số lần còn lại |
| Chi tiết voucher kèm lịch sử | Hoàn thành | Những đơn hàng nào đã dùng voucher này |

### Xử lý đồng thời & Độ tin cậy
| Tính năng | Trạng thái | Chi tiết |
|---|---|---|
| Chống bán quá số lượng | Hoàn thành | Khóa phân tán Redis theo từng hạng vé |
| Chống đặt vé trùng lặp | Hoàn thành | Khóa idempotency (UUID do client tạo trong header) |
| Chống lạm dụng voucher | Hoàn thành | Giới hạn theo user + bộ đếm toàn cục + dự phòng DB |
| Tự động hết hạn đơn chờ | Hoàn thành | Cron job mỗi phút, ngưỡng 10 phút |
| Quản lý tồn kho nguyên tử | Hoàn thành | DB transaction cho tất cả thao tác ghi |
| Xử lý lỗi toàn diện | Hoàn thành | Global exception filter + response chuẩn hóa |

### Hạ tầng
| Tính năng | Trạng thái | Chi tiết |
|---|---|---|
| Docker Compose | Hoàn thành | Khởi chạy 1 lệnh: `docker compose up --build` |
| Database migration | Hoàn thành | Prisma migrate (tự chạy trong Docker) |
| Dữ liệu mẫu | Hoàn thành | Users, concerts, vouchers |
| Tài liệu API | Hoàn thành | Swagger tự sinh từ decorators |
| Postman collection | Hoàn thành | Cấu hình sẵn với biến tự động lưu |
| Unit test | Hoàn thành | AuthService với mock dependencies |

## Chưa triển khai (Giới hạn)

| Tính năng | Lý do | Phương án thay thế |
|---|---|---|
| Tích hợp cổng thanh toán | Ngoài phạm vi — cần SDK Stripe/VNPay | Operator xác nhận thủ công qua API admin |
| Cập nhật/xóa voucher | Ưu tiên phạm vi — đọc + tạo đã đủ use case | Có thể thêm endpoint PATCH/DELETE |
| Cập nhật/xóa concert | Ưu tiên phạm vi — tạo + xuất bản đã đủ flow | Có thể thêm sau |
| Thông báo email/SMS | Cần dịch vụ bên ngoài (SendGrid, Twilio) | Trạng thái đơn theo dõi qua API |
| Rate limiting | Cần `@nestjs/throttler` | Khóa Redis giảm thiểu một phần lạm dụng |
| Mở rộng ngang (Horizontal scaling) | Triển khai đơn instance | Kiến trúc hỗ trợ sẵn (khóa Redis là phân tán) |
| Coverage test đầy đủ | Giới hạn thời gian — module auth test làm mẫu | Các module khác theo cùng pattern |
| Webhook callback | Không có nhà cung cấp thanh toán để callback | Polling trạng thái qua GET /bookings/:id |
| Quản lý hồ sơ người dùng | Không phải luồng cốt lõi của đặt vé | Có thể thêm module riêng |
| Chọn ghế ngồi | Đơn giản hóa thành đặt theo hạng vé | Cần thêm data model bản đồ ghế |
| Danh sách chờ / hàng đợi | Ngoài phạm vi MVP | Có thể dùng Redis sorted sets |

## Đánh đổi trong thiết kế (Trade-offs)

### Tại sao dùng khóa Redis thay vì khóa hàng DB?
- **Khóa DB** (`SELECT ... FOR UPDATE`) chặn ở tầng cơ sở dữ liệu, tạo áp lực lên connection pool khi tải cao
- **Khóa Redis** thất bại nhanh (phản hồi 409 ngay lập tức) và giải phóng nhanh, trải nghiệm tốt hơn trong flash sale
- **Đánh đổi**: Yêu cầu Redis phải hoạt động; nếu Redis chết, không thể đặt vé

### Tại sao tách trường `reservedQty` thay vì đếm từ BookingItems?
- **Đếm**: `SELECT SUM(quantity) FROM booking_items WHERE status NOT IN ('CANCELLED', 'EXPIRED')` — cần JOIN + aggregation mỗi lần kiểm tra
- **Trường bộ đếm**: `totalQty - reservedQty` — truy vấn O(1), không cần join
- **Đánh đổi**: Phải đảm bảo bộ đếm luôn đồng bộ (xử lý bằng DB transaction + cron job hoàn tồn kho)

### Tại sao Idempotency Key do client tạo thay vì server?
- **Server tạo**: Client không biết request đã thành công chưa (trường hợp timeout mạng)
- **Client tạo**: Client gửi cùng UUID khi retry → server trả về kết quả cache
- **Đánh đổi**: Yêu cầu client phải tạo UUID (đã ghi tài liệu trong Swagger + Postman pre-request script tự xử lý)

### Tại sao dùng cron thay vì delayed job?
- **Delayed job** (Bull/BullMQ): Hết hạn chính xác 10 phút cho mỗi đơn, nhưng thêm phức tạp hạ tầng
- **Cron (mỗi phút)**: Đơn giản hơn, chậm tối đa 1 phút so với ngưỡng 10 phút
- **Đánh đổi**: Đơn hàng có thể tồn tại tối đa ~11 phút thay vì chính xác 10 phút
Vì thời gian giới hạn cũng như với traffic dự kiến thì cron là hợp lý và đơn giản hơn.

## Phân tích kịch bản Flash Sale

Với lưu lượng dự kiến: **~50,000 người dùng, 300-500 request/phút ở đỉnh**

### Hệ thống xử lý như thế nào:

1. **Khóa phân tán** ngăn bán quá số lượng ngay cả khi truy cập đồng thời
2. **Idempotency** ngăn đặt vé trùng từ các lần bấm retry nhiều lần
3. **Bộ đếm Redis** kiểm tra voucher nhanh chóng mà không cần truy vấn DB nhiều lần
4. **DB transaction** đảm bảo tính nguyên tử — hoặc toàn bộ booking thành công hoặc không ghi gì
5. **Tự động hết hạn** trả vé chưa thanh toán về pool trong 10 phút
6. **Phản hồi 409 nhanh** khi lock đang bị giữ — client thử lại sau khoảng thời gian ngắn

### Điểm nghẽn tiềm ẩn & cách giảm thiểu:
- **Khóa Redis đơn cho mỗi hạng vé**: Dưới tải cực cao (>1000 req/giây cho cùng hạng vé), tranh chấp lock tăng. Giảm thiểu: giảm TTL lock, triển khai retry với exponential backoff phía client.
