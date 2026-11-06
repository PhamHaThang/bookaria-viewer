# Bookaria Viewer

Ứng dụng đọc sách tương tác của Bookaria: đọc trên màn hình, quét trang sách in để xem AR và mở bản xem trước từ Studio. Người đọc không cần đăng nhập.

## Chạy nhanh

Yêu cầu **Node.js >= 22.19.0**, **pnpm 10.34.6** và backend Bookaria đang chạy ở cổng `4000`.

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env
pnpm dev
```

Chỉ sao chép `.env.example` khi chưa có `.env`, để giữ cấu hình local hiện tại. Mở [Viewer local](https://viewer.localhost:5174). Vite dùng HTTPS mặc định, lắng nghe trên mạng LAN và giữ cố định cổng `5174`.

| Đường dẫn                    | Mục đích                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `/`                          | Trang tối giản với logo và hướng dẫn mở liên kết sách hoặc quét QR trên bìa.        |
| `/b/:slug`                   | Màn hình giới thiệu, thông tin sách đã xuất bản.                                    |
| `/b/:slug/p/:page`           | Đọc sách 3D tại trang cụ thể (trang 1-based, ví dụ: `/b/mat-biec/p/2`).             |
| `/b/:slug/camera`            | Màn hình yêu cầu quyền camera trước khi quét AR.                                    |
| `/b/:slug/ar`                | Chế độ quét AR qua camera (tùy chọn trang ưu tiên: `/b/:slug/ar/p/:page`).          |
| `/preview/:token`            | Màn hình giới thiệu bản xem trước bằng liên kết tạm từ Studio.                      |
| `/preview/:token/p/:page`    | Đọc bản xem trước 3D tại trang cụ thể.                                              |
| `/preview/:token/camera`     | Màn hình cấp quyền camera cho bản xem trước.                                        |
| `/preview/:token/ar`         | Chế độ quét AR cho bản xem trước.                                                   |
| `/embed`                     | Bản xem nhúng do Studio điều khiển; mở từ Studio qua iframe postMessage.           |

## Cấu hình

Các giá trị mặc định trong `.env.example`:

```env
VITE_API_BASE_URL=/api/v1
VITE_STUDIO_ORIGIN=http://localhost:5173
VITE_API_PROXY_TARGET=http://localhost:4000
```

- `VITE_API_BASE_URL`: địa chỉ API mà trình duyệt gọi. Dùng `/api/v1` khi chạy local để đi qua proxy của Viewer.
- `VITE_STUDIO_ORIGIN`: origin Studio được phép gửi nội dung vào iframe. Phải khớp giao thức, hostname và cổng đang mở Studio.
- `VITE_API_PROXY_TARGET`: backend nhận các yêu cầu `/api` qua Vite khi phát triển; không phải địa chỉ API trên điện thoại.
- `VIEWER_HTTPS_CERT_FILE` và `VIEWER_HTTPS_KEY_FILE`: tùy chọn chứng chỉ phát triển riêng. Để trống cả hai để dùng `@vitejs/plugin-basic-ssl`.

Khởi động lại Vite sau khi sửa `.env`. Các biến `VITE_*` có thể xuất hiện trong ứng dụng phía trình duyệt, không dùng để lưu bí mật.

Cách dùng điện thoại cùng Wi-Fi, cấu hình liên kết/QR và xử lý chứng chỉ: [HTTPS local](docs/HTTPS-LOCAL.md).

## Luồng sử dụng

1. Mở liên kết `/b/:slug` hoặc quét QR trên bìa để đến trang giới thiệu sách.
2. Chọn **Bắt đầu đọc** để đọc từ trang đầu, chuyển trang bằng thanh trang hoặc danh sách trang.
3. Chọn **Quét sách** để mở màn hình cấp quyền. Camera chỉ được yêu cầu sau khi người dùng bấm cho phép; không yêu cầu micro hoặc vị trí.
4. Hướng camera vào trang hoặc marker đã cấu hình. Khi nhận diện được, Viewer hiển thị nội dung AR của trang tương ứng. Khi mất dấu, đưa camera trở lại trang sách.

Viewer có giao diện sáng/tối, tùy chọn âm thanh, thông tin sách và hướng dẫn đọc. Âm thanh/video có thể cần thao tác của người đọc trước khi phát. Nhấn logo để trở lại bìa sách hiện tại.

Trên máy tính: kéo chuột trái để xoay, chuột phải hoặc `Space` + kéo để dịch góc nhìn, cuộn để zoom; giữ chuột giữa và kéo dọc để zoom nhanh. Trên màn hình cảm ứng: một ngón để xoay, hai ngón để dịch và thu/phóng. Các thao tác này dùng khi đọc trên màn hình; trong AR, góc nhìn đi theo camera thiết bị.

Chỉ luồng sách đã xuất bản ghi sự kiện đọc ẩn danh theo lô và có báo cáo nội dung. Preview và embed không gửi thống kê đọc hoặc hiển thị form báo cáo.

## Kiểm tra và build

```powershell
pnpm check
pnpm test
pnpm build
```

- `check`: kiểm tra tính nguyên vẹn thư viện vendor, định dạng/lint và TypeScript.
- `test`: chạy bộ kiểm thử trong `tests/`.
- `build`: tạo ứng dụng triển khai trong `dist/`.

Thử thủ công trên máy tính và điện thoại: mở sách, chuyển trang, quay về bìa, đổi sáng/tối, thử âm thanh; sau đó thử cấp quyền/từ chối camera và nhận diện marker. Kiểm tra cả trường hợp mất dấu và đưa camera trở lại. AR cần nghiệm thu trên thiết bị thật, đặc biệt iPhone/Android.

## Mã nguồn và đồng bộ

Ứng dụng dùng TypeScript, Vite, Tailwind CSS, Lucide, Three.js **0.161.0** và MindAR **1.2.5**; không phụ thuộc React.

| Thư mục/file                                      | Vai trò                                                  |
| ------------------------------------------------- | -------------------------------------------------------- |
| `src/main.ts`                                     | Khởi tạo router, đăng ký các route và kết nối sự kiện.   |
| `src/router/`                                     | Hệ thống client-side routing, pattern matcher và paths.  |
| `src/routes/`                                     | Các route controller: home, embed, published, preview.   |
| `src/viewer/`                                     | Điều phối hiển thị sách, Three.js, MindAR và tương tác.  |
| `src/reader-ui.ts`, `src/style.css`, `index.html` | Giao diện, theme và các trạng thái hiển thị.             |
| `src/scene-core/`                                 | Dựng scene, điều khiển góc nhìn và chạy tương tác.       |
| `src/tracker/`                                    | Nhận diện ảnh và tìm trang giữa các nhóm marker.         |
| `src/shared/`                                     | API, giao thức Studio, schema và phần render dùng chung. |
| `public/vendor/`                                  | MindAR và Draco decoder được ghim phiên bản.             |

Không sửa tay `src/shared/contracts/`. Khi schema backend thay đổi, đặt repo backend cạnh Viewer rồi chạy:

```powershell
pnpm contract:sync
pnpm contract:check
pnpm contract:verify
```

`contract:check` so sánh với backend; `contract:verify` kiểm tra snapshot hiện có và phiên bản Zod mà không cần repo backend. Có thể chỉ định đường dẫn backend bằng `pnpm contract:sync --backend D:/path/to/bookaria-backend`.

Không sửa hoặc định dạng lại thư viện trong `public/vendor/`: `pnpm vendor:verify` kiểm tra checksum của các tệp này. Tracker/TensorFlow chỉ được nạp khi dùng camera; renderer được nạp khi bắt đầu xem nội dung.

## Triển khai

- Phục vụ `dist/` qua HTTPS, cấu hình SPA fallback về `index.html` cho các đường dẫn sách/preview.
- Proxy `/api` đến backend tại máy chủ triển khai, hoặc cấu hình API origin phù hợp trước khi build. Proxy trong `vite.config.ts` chỉ dùng khi chạy dev.
- Đặt `VITE_STUDIO_ORIGIN` đúng origin Studio trước khi build; cấu hình `VITE_VIEWER_ORIGIN` của Studio và `VIEWER_URL` của backend cùng trỏ về Viewer triển khai.
- Dùng `Cache-Control: no-store` cho HTML/API, `Referrer-Policy: no-referrer` và `X-Robots-Tag: noindex, nofollow`, tương tự cấu hình dev.
- Tài nguyên ảnh, mô hình, media và marker phải tải được từ trình duyệt với CORS phù hợp. Chứng chỉ SSL phát triển không dùng cho production.

Viewer không có service worker hoặc chế độ offline; cần kết nối để tải sách và kiểm tra trạng thái liên kết. Không commit `.env`, chứng chỉ riêng, `node_modules/` hoặc `dist/`.
