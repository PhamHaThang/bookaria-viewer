# Kiểm thử nhận diện AR

## Thử nghiệm ổn định nội dung — 07/11/2026

Cập nhật sau đối chiếu REA Pictarize: tracker phân biệt `trackingStates[target].isTracking` của MindAR 1.2.5 với ma trận cuối mà engine vẫn phát trong thời gian chờ. Chỉ pose đang tracking thật được đưa vào bộ lọc. Khi mẫu đầu tiên mất tracking hoặc bị loại do nhảy bất thường, bắt đầu một hạn chờ 450 ms; pose cũ và callback mất dấu lặp không kéo dài hạn này. Hết hạn, tracker phát đúng một lần mất dấu và đặt lại bộ lọc. Viewer không cộng thêm timer mất dấu thứ hai. Nhận lại trong hạn giữ nguyên runtime/âm thanh và không phát lại sự kiện found/start; chuyển target/nhóm hoặc dừng camera hủy timer cũ.

Mốc 450 ms tính từ mẫu đầu tiên tracker quan sát là không hợp lệ, không phải từ thời điểm vật lý ảnh bị che, và timer vẫn phụ thuộc lịch thực thi trình duyệt. Các ghi chú khoảng chờ 300 ms bên dưới mô tả lượt thử trước; cấu hình hiện tại dùng hạn duy nhất 450 ms.

Camera ưu tiên 1280 × 720 (thiết bị có thể cấp độ phân giải khác). Viewer bổ sung lọc pose trước khi đổi từ tọa độ marker sang tọa độ trang, để marker đặt ở góc vẫn giữ đúng phép biến đổi của trang:

- Làm mượt vị trí, hướng quay và tỉ lệ theo thời gian, dùng quaternion cho góc quay; giảm độ trễ khi chuyển động nhanh.
- Bỏ qua một cú nhảy vị trí/góc/tỉ lệ bất thường; chuyển động lớn cần các mẫu gần nhau nhất quán trước khi chấp nhận. Pose không hợp lệ được xử lý như mất dấu.
- Đặt lại bộ lọc khi đổi target/nhóm hoặc nhận lại sau mất dấu dài, tránh nội suy từ trang cũ sang trang mới.
- `missTolerance` giữ 8 khung hình cho engine. Lượt thử đầu dùng thêm 300 ms sau khi engine báo mất pose; lượt hiện tại đã thay bằng hạn 450 ms bắt đầu ngay từ mẫu đầu mất tracking, không cộng thêm hạn thứ hai trong Viewer.

Khi thử trên điện thoại, so sánh giữ máy đứng yên, dịch máy chậm/nhanh, che marker thoáng qua, che vài giây rồi đưa lại, đổi trang và xoay dọc/ngang. Kiểm tra nội dung có theo máy chậm quá không, có nhảy qua vị trí trang trước không và có bị giữ trên màn hình quá lâu sau mất dấu không. Giữ vị trí cuối không bù được chuyển động camera khi marker bị che; vẫn cần quét marker để bám đúng trang. Camera giả lập và unit test không xác nhận được độ rung/độ nóng trên iPhone thật.

## Phạm vi

Bộ kiểm thử trình duyệt dùng **MindAR 1.2.5 thật**, ảnh và file `.mind` của bộ 20 marker Bookaria trong backend. Camera được thay bằng video từ canvas, không truy cập camera thật, không tạo sách hoặc ghi báo cáo lên backend.

Mục tiêu là phát hiện nhận sai marker, lỗi chuyển nhóm, mất dấu/nhận diện lại, lỗi render nội dung sau khi nhận diện và rò rỉ tài nguyên khi thoát. Kết quả camera giả lập không thay thế nghiệm thu trên sách in và điện thoại thật.

## Chạy tự động

Yêu cầu đã cài Chrome và các dependency của Viewer:

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm test:ar
```

`test:ar` tự chạy Vite trên **https://localhost:5184**, một worker để tránh nhiều tracker tranh GPU. Cổng này tách khỏi Viewer dev 5174. Bộ thử mặc định đọc marker từ `../bookaria-backend/assets/bookaria-markers/` và kiểm tra checksum theo manifest trước khi chạy.

Nếu bộ marker nằm chỗ khác, cấu hình thư mục chứa `manifest.json`, `png/` và `mind/`:

```powershell
$env:BOOKARIA_MARKERS_DIR = 'D:/path/to/bookaria-markers'
pnpm test:ar
```

Không cần seed database hoặc chạy backend để chạy bộ thử này. Bộ thử ghép file `.mind` tạm trong bộ nhớ theo định dạng MessagePack v2 của MindAR, không sửa file seed.

Nếu không dùng Chrome đã cài, có thể cài Chromium cho Playwright:

```powershell
pnpm exec playwright install chromium
$env:AR_BROWSER_CHANNEL = 'chromium'
pnpm test:ar
```

Báo cáo JSON và trace/screenshot khi thất bại nằm trong `test-results/` (đã gitignore). Các phép đo thời gian cũng được in ra terminal; không dùng một ngưỡng mili giây cố định để kết luận điện thoại nhanh/chậm từ máy chạy test.

Chỉ chạy phép so sánh một nhóm 20 marker với hai nhóm 10 marker:

```powershell
pnpm test:ar --grep benchmark
```

Phép so sánh chạy cả lượt khởi động và lượt GPU đã được làm nóng. `readyMs` là thời gian chuẩn bị tracker đầu tiên; `searchMs` là thời gian từ lúc tracker sẵn sàng đến khi nhận diện marker 20; `totalMs` là tổng hai phần. `targetTensorBytes` chỉ ước tính dữ liệu tensor của nhóm marker hiện tại, không phải tổng RAM hoặc bộ nhớ GPU của ứng dụng.

## Những gì bộ thử kiểm tra

- Cả 20 marker được thử với một nhóm 20 target và hai nhóm 10 target, gồm các trang ở hai phía ranh giới nhóm 10/11, để kiểm tra đúng ID.
- Xoay ảnh khoảng ±10 độ, thu nhỏ một số ảnh và xen khung trắng để thử mất dấu rồi nhận diện lại.
- Tự tìm nhóm khác và ưu tiên nhóm khi người đọc chọn trang.
- Giữ một camera/controller trong cùng phiên; giải phóng tensor marker khi đổi nhóm và khi dừng.
- Vào sách chưa xin camera, màn hình cấp quyền chưa tự xin, bấm cho phép mới yêu cầu camera.
- Khi nội dung tải chậm sau nhận diện, camera và nút điều khiển vẫn hiện; trạng thái tải nhỏ chỉ xuất hiện sau 250 ms. Thoát giữa chừng không làm nội dung cũ hiện lại. Thử cả giao diện sáng desktop và tối mobile, gồm chế độ giảm chuyển động.
- AR không tải/giải mã ảnh nền giấy đang bị ẩn. Shader/texture được chuẩn bị trước khi hiện nội dung.
- Nhận diện phải dẫn đến nội dung thật được render: kiểm tra pixel của một đối tượng thử, không chỉ kiểm tra dòng “Đã nhận diện”.
- Về bìa dừng camera; từ chối quyền có thể quay lại bìa.

## Kiểm tra cache file ảnh/model

Bài thử `reader:` còn kiểm tra số request của một ảnh dùng chung khi đổi trang và quay lại: file chỉ tải một lần trong phiên sách. Sau khi thay phiên bản sách, cùng URL phải được tải lại để tránh dùng dữ liệu cũ. Các ảnh khác được cố tình trì hoãn để tiếp tục kiểm tra camera trong lúc chờ và việc thoát giữa chừng.

Unit test kiểm tra giới hạn 24 MiB tổng/8 MiB mỗi file, loại file ít dùng, file lớn không làm tràn cache, hủy/lỗi tải, kết quả cũ trả về sau khi đổi phiên và thử lại sau lỗi giải mã. Model GLB được parse thật qua hai runtime độc lập; bitmap ảnh được đóng khi runtime không còn dùng. Cache này giữ byte file, không giữ scene hoặc texture đã giải mã.

## Chính sách tìm nhóm hiện tại

- Chỉ một nhóm được đưa vào GPU tại một thời điểm, dùng một camera và một controller.
- Nhóm chưa tìm thấy marker được giữ ít nhất 1,2 giây và 12 khung hình đã xử lý. Máy chậm được chờ thêm, với cơ chế thoát khi không có tiến triển.
- Khi MindAR đang làm nóng một ứng viên nhận diện, không chuyển nhóm giữa chừng. Chỉ pose chính thức của MindAR mới được dùng để hiển thị nội dung.
- Nhóm đang nhận diện được giữ nguyên. Mất dấu có khoảng chờ 1,8 giây để tìm lại trước khi thử nhóm lân cận.
- Tải trước tối đa một nhóm kế tiếp; cache dữ liệu `.mind` tối đa 30 MiB, mỗi file tối đa 10 MiB. Tải trước lỗi không hiện thông báo và không thử lại ở mỗi khung hình; tải khi thật sự cần vẫn được phép thử lại.
- Yêu cầu tải dữ liệu nhóm có thời hạn 10 giây. Dừng camera hủy yêu cầu và xóa cache phiên.

Bộ tracker có thể đọc file chứa 20 target trong bộ thử. **Luồng xuất bản backend và schema manifest hiện vẫn giới hạn 10 target/nhóm**; phép thử một nhóm gọi tracker trực tiếp, không thay đổi hợp đồng API hay dữ liệu sách đã xuất bản. Muốn dùng một nhóm 20 trong sách thực tế cần sửa giới hạn backend, đồng bộ schema và kiểm tra lại luồng xuất bản.

## Độ ổn định khi bám marker

Tham số tập trung trong `src/tracker/tracking-config.ts`: giữ `warmupTolerance` và `missTolerance` bằng 5, `filterMinCF = 0.001`, chỉnh `filterBeta = 0.3` để giảm dao động nhỏ. Không sửa vendor hoặc hạ ngưỡng nhận diện. Cách đánh đổi độ ổn định/độ trễ được mô tả trong [Tracking Config của MindAR](https://hiukim.github.io/mind-ar-js-doc/quick-start/tracking-config/).

Luồng hiển thị có khoảng đệm mất dấu tối đa 180 ms sau tín hiệu mất dấu của MindAR. Nếu tìm lại cùng trang trong khoảng này, scene/media tiếp tục; nếu mất thật, nội dung ẩn và có hướng dẫn. Đổi nhóm, đổi trang hoặc dừng camera hủy khoảng đệm ngay. Không ngoại suy vị trí khi mất marker và không tăng thời gian giữ dấu trong tracker.

Chạy phép đo bằng MindAR thật với video canvas có rung nhẹ và dịch/xoay trong khung:

```powershell
pnpm test:ar --grep "tracking probe:"
```

Lượt đo tham chiếu trên máy tính ngày 04/11/2026, video 640 × 480: beta mặc định 1000 có RMS dao động ở góc khoảng 1,58 px; beta 0.3 khoảng 1,01 px. Sai lệch trung bình ở góc khi dịch/xoay tăng từ khoảng 1,82 px lên 2,35 px trong cùng bài thử. Đây là dữ liệu camera giả lập, chưa phải kết quả iPhone hoặc cam kết ở mọi khoảng cách/ánh sáng.

Bài thử `reader:` hiện mô phỏng engine vẫn phát ma trận cũ dù `isTracking=false`: giữ 220 ms không làm ẩn scene, đổi pose/runtime hoặc gọi lại start/resume/markerFound/markerLost; đến 550 ms nội dung đã ẩn theo hạn duy nhất 450 ms. Unit test dùng đồng hồ điều khiển xác nhận chính xác mốc 450 ms ở nhịp mẫu nhanh/chậm. Khi thử điện thoại, cần di chuyển chậm rồi nhanh dần, kiểm tra cả rung khi giữ yên lẫn độ bám khi xoay. Chuyển động quá nhanh, ảnh mờ, lóa hoặc marker ra ngoài khung vẫn có thể làm mất dấu.

## Nghiệm thu thủ công trên iPhone/Safari

Chuẩn bị sách thử có đủ 20 marker, mỗi trang có nội dung dễ phân biệt (ví dụ chữ “Trang 01” đến “Trang 20” và một đối tượng 3D). Dùng liên kết xuất bản mới nhất, in marker đúng tỉ lệ và cấu hình HTTPS theo [HTTPS local](HTTPS-LOCAL.md).

Ghi phiên bản iOS, mẫu điện thoại, chế độ tiết kiệm pin, điều kiện ánh sáng và cách in. Mỗi kết quả cần ghi marker đang quét, trang Viewer nhận diện, thời gian chờ ước lượng và nội dung có hiện đúng hay không.

| Tình huống | Thao tác | Kết quả cần đạt |
| --- | --- | --- |
| Cấp quyền | Mở bìa, vào Quét sách, cho phép hoặc từ chối camera | Đúng bước cấp quyền; từ chối có hướng dẫn và quay lại được. |
| Định danh | Quét lần lượt 01–20, sau đó quét theo thứ tự ngẫu nhiên | Không báo sai trang; nội dung khớp marker. |
| Đổi nhóm | Quét 01 → 20 → 02 → 19 và 10 ↔ 11 | Tự tìm trang, không cần chọn nhóm bằng tay. |
| Mất dấu ngắn | Che marker hoặc đưa camera lệch rồi quay lại ngay | Tìm lại trang, không mở trang khác hoặc phát âm thanh chồng. |
| Mất dấu dài | Hướng camera ra ngoài vài giây, sau đó quét marker khác | Trở lại tìm kiếm, nhận diện và hiện trang mới. |
| Hai marker | Đưa hai trang vào khung rồi giữ một trang ở giữa | Theo dõi tối đa một trang; không nhảy liên tục giữa hai trang. |
| Góc và khoảng cách | Thay đổi khoảng cách/góc nhìn, thử ánh sáng yếu và phản sáng | Ghi phạm vi hoạt động; khi mất dấu có hướng dẫn, không hiện sai trang. |
| Dọc/ngang | Xoay điện thoại trong khi quét và khi đã nhận diện | Nội dung bám đúng marker, không bị lật, lệch hoặc biến mất. |
| Vị trí nội dung | So với bản đã lưu trong Editor/Preview | Đúng loại đối tượng, vị trí, tỉ lệ, hướng, ẩn/hiện và ánh sáng. |
| Media | Phát/dừng audio, video; đổi trang trong khi đang phát | Không phát chồng, âm thanh tắt đúng, thao tác chạm dùng được. |
| Rời ứng dụng | Đổi tab/khóa máy rồi quay lại; nhấn logo về bìa | Camera và media dừng phù hợp; có thể quét lại, không bị kẹt. |
| Mạng yếu | Chậm/ngắt mạng khi đang mở AR hoặc đổi nhóm | Có cách thử lại, không đứng vô hạn hoặc hiện sai trang. |
| Dùng lâu | Đổi/quét trang liên tục ít nhất 10 phút | Không crash; ghi lại độ nóng và mức giật để so sánh thiết bị. |

Nếu thử phương án một nhóm 20 marker, cần tạo dữ liệu thử tương ứng trong môi trường dev trước. Không chỉ so thời gian tìm trang: phải kiểm tra cả thời gian mở camera, bộ nhớ, độ ổn định và mức nóng máy. Chỉ chốt cấu trúc xuất bản sau khi có kết quả điện thoại thật.


## Kết quả tham chiếu ngày 03/11/2026

Trên Chrome máy tính, video canvas 640 × 480 với 20 marker seed:

- Hai nhóm 10: nhận đúng 20/20 marker trong chuỗi đổi trang, xoay ±10 độ và thu nhỏ một số ảnh; không ghi nhận ID khác với ảnh đang thử.
- Một nhóm 20: cũng nhận đúng 20/20 trong cùng chuỗi thử, không ghi nhận ID khác. Thời gian từ khi đưa ảnh vào video đến pose hợp lệ khoảng 0,15–0,55 giây trong lượt đo này, sau khi tracker đã chuẩn bị.
- Trong phép so sánh GPU đã được làm nóng, mở AR với marker 20: một nhóm mất khoảng 0,80–0,85 giây tổng cộng; hai nhóm khoảng 2,67 giây. Lượt đầu hai nhóm có thêm chi phí khởi động, khoảng 4,28 giây; không dùng lượt này để so trực tiếp với lượt đã làm nóng.
- Dữ liệu tensor marker được đếm khoảng 0,63 MiB cho nhóm 10 và 1,25 MiB cho nhóm 20. Đây không phải tổng bộ nhớ GPU/RAM; chưa đo mức nóng hoặc hiệu năng iPhone.

Các số trên chỉ mô tả điều kiện thử giả lập và sẽ thay đổi theo máy. Một nhóm 20 là ứng viên hợp lý để thử trên điện thoại; chưa dùng kết quả này để tự đổi giới hạn xuất bản production.
