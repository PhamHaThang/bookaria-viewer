# Chạy Viewer bằng HTTPS trên máy tính và điện thoại

Viewer dùng HTTPS mặc định ở cổng **5174** qua `@vitejs/plugin-basic-ssl`. Không cần tự tạo chứng chỉ để bắt đầu chạy dev; plugin tạo chứng chỉ tự ký, còn việc tin cậy chứng chỉ phụ thuộc trình duyệt và thiết bị.

## 1. Chạy trên máy tính

Khởi động backend và worker theo hướng dẫn của backend, sau đó chạy Viewer:

```powershell
cd D:\bookaria\bookaria-viewer
pnpm dev
```

Mở [https://viewer.localhost:5174](https://viewer.localhost:5174). Nếu trình duyệt báo chứng chỉ tự ký, xử lý cảnh báo cho đúng địa chỉ dev đó trước khi dùng Viewer hoặc mở preview trong Studio.

Cấu hình mặc định của Viewer trong `.env`:

```env
VITE_API_BASE_URL=/api/v1
VITE_STUDIO_ORIGIN=http://localhost:5173
VITE_API_PROXY_TARGET=http://localhost:4000
```

Studio mặc định chạy tại `http://localhost:5173`, backend tại `http://localhost:4000`. Viewer chuyển yêu cầu `/api` đến backend qua proxy, nên backend local không cần HTTPS riêng.

## 2. Dùng điện thoại cùng Wi-Fi

Chạy `ipconfig` trên máy tính, lấy địa chỉ IPv4 của kết nối đang dùng. Ví dụ dưới đây dùng **192.168.1.79**; thay bằng IP thật của bạn trong tất cả cấu hình.

| Nơi mở Viewer | Địa chỉ |
| --- | --- |
| Trình duyệt trên máy tính | `https://viewer.localhost:5174` |
| Điện thoại cùng mạng | `https://192.168.1.79:5174` |

`localhost` và `viewer.localhost` trỏ về chính thiết bị đang mở trình duyệt. Vì vậy, liên kết hoặc QR dành cho điện thoại phải dùng IP LAN của máy tính, hoặc hostname mà điện thoại truy cập được.

Để Studio tạo liên kết thử AR bằng điện thoại, sửa `.env` của Studio:

```env
VITE_VIEWER_ORIGIN=https://192.168.1.79:5174
```

Để backend tạo liên kết/QR sách đúng địa chỉ, sửa `.env` của backend:

```env
VIEWER_URL=https://192.168.1.79:5174
CORS_ORIGINS=http://localhost:5173,https://localhost:5174,https://viewer.localhost:5174,https://192.168.1.79:5174
```

Nếu đã có các origin khác trong `CORS_ORIGINS`, giữ lại và thêm origin Viewer cần dùng. Cấu hình Viewer vẫn giữ API base `/api/v1` và proxy target `http://localhost:4000`.

`VITE_STUDIO_ORIGIN` trong Viewer phải khớp địa chỉ Studio thực tế. Nếu Studio vẫn được mở trên máy tính bằng `http://localhost:5173`, giữ nguyên giá trị đó; không thay chỉ vì điện thoại đang mở Viewer bằng IP.

Khởi động lại dịch vụ đã đổi cấu hình. Mở Viewer bằng IP trực tiếp trên điện thoại, xử lý cảnh báo chứng chỉ nếu trình duyệt cho phép, rồi mở liên kết sách `/b/<slug>`. Kiểm tra các liên kết và QR được tạo sau khi đổi cấu hình; QR/PDF đã tải xuống trước đó vẫn chứa địa chỉ cũ.

## 3. Thử camera trên iPhone/Safari

1. Mở liên kết sách bằng HTTPS trên Safari.
2. Chọn **Quét sách** để đến giao diện cấp quyền.
3. Bấm **Cho phép camera** rồi chấp nhận yêu cầu của Safari.
4. Hướng camera vào đúng trang hoặc marker đã được cấu hình trong sách.

Viewer không tự xin camera khi vừa vào bìa sách và không xin quyền micro/vị trí. Nếu từ chối camera, giao diện hướng dẫn cấp lại quyền và có nút **Quay lại**. Khi thử lại, kiểm tra quyền camera cho website trong Safari.

Nếu Basic SSL đã hoạt động và dùng được camera trên thiết bị của bạn, tiếp tục dùng cấu hình mặc định. Plugin không tự cài chứng chỉ tin cậy vào điện thoại. Nếu thiết bị vẫn chặn camera hoặc kết nối vì chứng chỉ, dùng chứng chỉ được thiết bị tin cậy hoặc môi trường HTTPS triển khai để nghiệm thu.

## 4. Preview nhúng trong Studio

- Mở trực tiếp **đúng origin Viewer mà Studio đang cấu hình**, xử lý cảnh báo chứng chỉ trước, rồi trở lại Studio mở preview.
- Chấp nhận chứng chỉ ở `viewer.localhost` không đồng nghĩa đã chấp nhận ở địa chỉ IP LAN.
- `VITE_STUDIO_ORIGIN` phải khớp origin Studio để Viewer nhận thông điệp preview. Đường dẫn `/embed` được Studio tạo kèm thông tin xác thực phiên làm việc; mở trực tiếp đường dẫn này sẽ không có nội dung.
- Để thử AR trên điện thoại, mở liên kết xem trước do Studio tạo hoặc liên kết sách đã xuất bản, thay vì mở iframe `/embed` trực tiếp.

## 5. Chứng chỉ riêng (tùy chọn)

Nếu đã có cặp chứng chỉ/khóa phù hợp, đặt chúng trong `.certs/` của Viewer và cấu hình:

```env
VIEWER_HTTPS_CERT_FILE=.certs/viewer.pem
VIEWER_HTTPS_KEY_FILE=.certs/viewer-key.pem
```

Chứng chỉ phải còn hạn, khớp khóa và bao gồm hostname/IP đang dùng trong SAN; thiết bị thử cần tin cậy chứng chỉ hoặc CA tương ứng. Đường dẫn tương đối được tính từ thư mục Viewer.

Đặt cả hai biến hoặc để trống cả hai. Cấu hình thiếu, không đọc được, hết hạn hoặc không khớp khóa sẽ làm dev server báo lỗi; không tự chuyển sang chứng chỉ khác. Đây là biến phía dev server, không dùng tiền tố `VITE_`. `.certs/` đã được gitignore; build không cần các tệp chứng chỉ dev.

## Xử lý lỗi thường gặp

| Hiện tượng | Kiểm tra |
| --- | --- |
| Điện thoại không kết nối được | Đúng IP, cùng mạng, Viewer đang chạy cổng 5174; kiểm tra mạng khách/cách ly thiết bị và Windows Firewall cho Node.js/cổng 5174 trên mạng Private. |
| `http://...:5174` không tải | Chuyển sang `https://`; dev server này phục vụ HTTPS. |
| API lỗi hoặc mixed content | Giữ API base `/api/v1`, kiểm tra backend/proxy cổng 4000. Không dùng `http://localhost:4000` làm API base trên điện thoại. |
| Preview nhúng lỗi | Mở trực tiếp origin Viewer để xử lý chứng chỉ; đối chiếu `VITE_VIEWER_ORIGIN` và `VITE_STUDIO_ORIGIN`. |
| Camera bị từ chối/không khả dụng | Kiểm tra HTTPS, quyền website, camera đang bị ứng dụng khác sử dụng hoặc yêu cầu cấp quyền đang chờ. |
| Nhận diện được nhưng không thấy nội dung | Kiểm tra trang đã xuất bản có đối tượng đang hiển thị, tài nguyên tải được; lùi camera để thấy toàn trang và làm theo hướng dẫn trên màn hình. |
| QR mở sai địa chỉ | Đối chiếu `VIEWER_URL`, khởi động lại backend và tạo lại tài liệu/QR cần dùng. |

Không commit `.env` hoặc khóa riêng. Khi IP LAN thay đổi, cập nhật origin liên quan và tạo lại liên kết/QR cần thử trên điện thoại.
