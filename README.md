# PharmaAssist Data Collector

## 1. Giới thiệu
- Tool dùng để thu thập dữ liệu sản phẩm tham khảo từ Nhà thuốc Long Châu.
- Tool chỉ phục vụ seed/demo data cho đồ án PharmaAssist.
- Tool không phải runtime production.
- Dữ liệu không dùng để tư vấn y tế thật.

## 2. Cài đặt
Để cài đặt tool, di chuyển vào thư mục `tools/data-collector` và thực hiện các lệnh sau:
- `npm install`
- `npm run install:browser`

## 3. Cấu hình .env
Sao chép cấu hình mẫu từ `.env.example` bằng lệnh:
```bash
cp .env.example .env
```
Các tham số cấu hình bao gồm:
- **`CRAWL_MODE`**: Chế độ thu thập dữ liệu (`sample` để thử nghiệm hoặc `full` để thu thập toàn bộ).
- **`MAX_PRODUCTS`**: Giới hạn số lượng sản phẩm tối đa sẽ thu thập (chỉ áp dụng ở chế độ `sample`).
- **`REQUEST_DELAY_RANDOM_MIN_MS`**: Thời gian chờ ngẫu nhiên tối thiểu giữa các request (mili-giây) để tránh bị chặn.
- **`REQUEST_DELAY_RANDOM_MAX_MS`**: Thời gian chờ ngẫu nhiên tối đa giữa các request (mili-giây).
- **`BATCH_SIZE`**: Số lượng sản phẩm ghi xuống file raw JSON sau mỗi lượt crawl chi tiết.
- **`HEADLESS`**: Cấu hình ẩn (`true`) hoặc hiện (`false`) cửa sổ trình duyệt Chromium khi Playwright hoạt động.
- **`RESUME`**: Tiếp tục crawl dựa trên trạng thái cũ (`true`) hoặc xóa trạng thái cũ chạy lại từ đầu (`false`).
- **`RETRY_FAILED_LIMIT`**: Giới hạn số lần thử lại tối đa cho mỗi URL bị lỗi khi crawl.
- **`SOURCE_NAME`**: Tên nguồn dữ liệu dùng để ghi nhận log và nguồn gốc dữ liệu (mặc định: `Nhà thuốc Long Châu`).
- **`SOURCE_NOTE`**: Chú thích hoặc ghi chú thêm cho nguồn dữ liệu (mặc định: `Dữ liệu tham khảo phục vụ đồ án PharmaAssist`).

## 4. Quy trình chạy sample
Chạy thử nghiệm với số lượng sản phẩm nhỏ để kiểm định selector và cấu trúc output dữ liệu. Có thể chạy từng bước:
- `npm run collect:links`: Lấy danh sách link sản phẩm.
- `npm run collect:details:sample`: Thu thập chi tiết sản phẩm (chạy theo số lượng giới hạn của `MAX_PRODUCTS`).
- `npm run normalize`: Chuẩn hóa dữ liệu thô sang định dạng CSV.
- `npm run validate:data`: Kiểm tra chất lượng và độ toàn vẹn của dữ liệu CSV đã chuẩn hóa.
- `npm run generate:sql`: Sinh script SQL seed từ dữ liệu CSV để import vào database.

Hoặc chạy toàn bộ quy trình sample (sạch dữ liệu cũ) bằng một lệnh duy nhất:
```bash
npm run pipeline:sample:clean
```

### 💡 Hướng dẫn chạy trên hệ điều hành Windows
Đối với máy chạy Windows, lệnh `npm run pipeline:sample:clean` có thể bị lỗi do Command Prompt hoặc PowerShell mặc định không hỗ trợ các lệnh shell của Linux (`rm`, `mkdir`). Bạn có thể chạy theo một trong các cách sau:

#### Cách 1: Chạy trực tiếp qua Git Bash hoặc WSL
Mở **Git Bash** hoặc **WSL (Windows Subsystem for Linux)**, di chuyển vào thư mục `tools/data-collector` và chạy trực tiếp script:
```bash
bash scripts/run_sample_pipeline.sh
```

#### Cách 2: Cấu hình npm sử dụng Git Bash làm Shell mặc định
Cách này cho phép bạn tiếp tục sử dụng Command Prompt hoặc PowerShell thông thường để chạy lệnh `npm run pipeline:sample:clean`.
1. Mở Command Prompt hoặc PowerShell và chạy lệnh cấu hình sau (điều chỉnh đường dẫn đến file `bash.exe` của Git trên máy của bạn nếu khác):
   ```bash
   npm config set script-shell "C:\\Program Files\\Git\\bin\\bash.exe"
   ```
2. Sau khi chạy cấu hình trên, bạn có thể chạy lệnh gộp trực tiếp ở bất kỳ terminal nào trên Windows:
   ```bash
   npm run pipeline:sample:clean
   ```
3. *(Tùy chọn)* Nếu muốn hoàn tác (reset) npm shell về mặc định sau này, chạy:
   ```bash
   npm config delete script-shell
   ```

*Lưu ý: File script `.sh` đã được cấu hình `.gitattributes` bắt buộc định dạng xuống dòng LF (Unix-style) để tránh lỗi cú pháp `\r: command not found` khi chạy bằng Git Bash trên Windows.*


## 5. Quy trình chạy full
Thu thập dữ liệu đầy đủ từ nguồn Nhà thuốc Long Châu:
- `npm run collect:links`: Thu thập danh sách link sản phẩm từ tất cả danh mục.
- `npm run collect:details:full`: Thu thập chi tiết toàn bộ các sản phẩm từ danh sách link.
- `npm run retry:failed`: Thử lại các sản phẩm bị lỗi trong quá trình thu thập chi tiết.
- `npm run normalize`: Chuẩn hóa toàn bộ dữ liệu thô sang các file CSV.
- `npm run validate:data`: Kiểm tra chất lượng dữ liệu CSV đã chuẩn hóa.
- `npm run generate:sql`: Sinh script SQL seed từ dữ liệu CSV để sẵn sàng import.

## 6. Retry failed
Khi tiến trình cào dữ liệu gặp lỗi mạng hoặc timeout đối với một số sản phẩm, sử dụng lệnh sau để chạy lại:
```bash
npm run retry:failed
```
Giải thích cơ chế hoạt động và cấu trúc file:
- **`failed_urls.json`**: Lưu trữ danh sách các URL crawl thất bại kèm theo lý do lỗi (error message) và số lần đã retry.
- **`retry_count`**: Đếm số lần hệ thống đã thử cào lại một URL lỗi, tự động dừng khi vượt quá ngưỡng cấu hình `RETRY_FAILED_LIMIT`.
- **`completed_urls.json`**: Chứa danh sách các URL đã cào thành công để tool bỏ qua không cào lại, tối ưu tài nguyên và thời gian.

## 7. Normalize data
Chuẩn hóa dữ liệu thô (raw JSON) thu thập được sang dạng bảng dữ liệu có quan hệ (RDBMS):
```bash
npm run normalize
```
- **Output**: Các file CSV chuẩn hóa được lưu trữ tại thư mục `data/normalized/*.csv` (gồm 15 file tương ứng với 15 bảng cơ sở dữ liệu như `products.csv`, `active_ingredients.csv`, `product_documents.csv`...).

## 8. Validate data
Kiểm tra chất lượng, dữ liệu trống và tính toàn vẹn của các file CSV:
```bash
npm run validate:data
```
- **Output**: File báo cáo chất lượng dữ liệu dưới dạng Markdown được tạo tại `data/output/data_quality_report.md`. Báo cáo đánh giá tỷ lệ điền thông tin và cảnh báo nếu phát hiện lỗi logic dữ liệu.

## 9. Generate SQL
Chuyển đổi dữ liệu CSV đã chuẩn hóa sang các script SQL INSERT để nạp dữ liệu demo cho database Supabase PostgreSQL:
```bash
npm run generate:sql
```
- **Output**:
  - `data/output/seed_longchau_demo.sql`: File SQL tổng hợp chứa toàn bộ lệnh nạp dữ liệu.
  - `data/output/sql/001_master_data.sql`: Chứa dữ liệu master dùng chung (danh mục, thương hiệu, nhà sản xuất, quốc gia, đơn vị tính, hoạt chất...).
  - `data/output/sql/002_products_batch_001.sql`: Chứa dữ liệu sản phẩm, biến thể, hình ảnh, giá và tài liệu hướng dẫn sử dụng thuộc lô dữ liệu 001.

## 10. Cấu trúc output
Thư mục dữ liệu đầu ra được cấu trúc rõ ràng như sau:
- **`data/raw`**: Chứa dữ liệu thô thu thập từ website ở định dạng JSON (chia theo batch).
- **`data/normalized`**: Chứa 15 file CSV chuẩn hóa.
- **`data/state`**: Lưu trữ các file trạng thái crawler (`completed_urls.json`, `failed_urls.json`, `duplicate_urls.json`, checkpoint...).
- **`data/output`**: Chứa file báo cáo chất lượng (`data_quality_report.md`) và script SQL seed tổng hợp (`seed_longchau_demo.sql`).
- **`data/output/sql`**: Chứa các file script SQL seed nhỏ được chia theo từng batch.
- **`logs`**: Chứa file log chi tiết các bước thu thập và xử lý dữ liệu.

## 11. Quy tắc an toàn
- **Không crawl quá nhanh**: Luôn bật cấu hình delay ngẫu nhiên hợp lý (`REQUEST_DELAY_RANDOM_MIN_MS` & `REQUEST_DELAY_RANDOM_MAX_MS`) để tránh tạo tải lớn lên server Nhà thuốc Long Châu.
- **Không lấy dữ liệu cá nhân**: Tool chỉ lấy thông tin công khai của sản phẩm, không thu thập bất kỳ dữ liệu cá nhân nào của khách hàng hoặc nhân viên.
- **Không lấy nội dung review/Q&A**: Chỉ thu thập rating trung bình (`rating_average`), số lượt đánh giá (`review_count`) và bình luận (`comment_count`) dưới dạng số liệu thống kê nếu có sẵn. Không cào nội dung bình luận của người dùng.
- **Không tải ảnh hàng loạt về repo**: Chỉ lưu trữ URL tuyệt đối trỏ đến ảnh sản phẩm gốc, tuyệt đối không download file ảnh trực tiếp về thư mục mã nguồn.
- **Không commit raw/output/state/logs**: Đảm bảo các thư mục dữ liệu phát sinh trong quá trình chạy được loại trừ hoàn toàn trong file `.gitignore` để tránh đẩy dữ liệu cào thô và log lên GitHub.
- **Không dùng dữ liệu để tư vấn y tế thật**: Dữ liệu chỉ phục vụ mục đích kiểm thử và xây dựng dữ liệu demo cho đồ án học tập.

## 12. Troubleshooting
- **Playwright chưa cài browser**:
  - *Sự cố*: Báo lỗi thiếu thư viện Chromium khi chạy tiến trình crawl.
  - *Khắc phục*: Chạy lệnh `npm run install:browser` để cài đặt môi trường browser cho Playwright.
- **Không lấy được product links**:
  - *Sự cố*: File link sản phẩm trống hoặc không lấy đủ link của danh mục.
  - *Khắc phục*: Kiểm tra cấu trúc trang web nguồn xem class/id của thẻ danh mục hoặc danh sách sản phẩm có thay đổi không và cập nhật lại selector tương ứng trong script link collector.
- **Website đổi layout**:
  - *Sự cố*: Tiến trình cào chi tiết bị lỗi hoặc lưu dữ liệu trống (null) ở nhiều trường.
  - *Khắc phục*: Mở Developer Tools (F12) trên trình duyệt, kiểm tra cấu trúc DOM mới và cập nhật lại selector trong file details collector.
- **Crawler timeout**:
  - *Sự cố*: Tiến trình crawl bị đứng hoặc lỗi kết nối do phản hồi chậm từ máy chủ nguồn.
  - *Khắc phục*: Tăng thời gian chờ (timeout) trong cấu hình của Playwright hoặc chuyển cấu hình `HEADLESS=false` để quan sát trực tiếp bot hoạt động và xử lý captcha nếu có.
- **failed_urls có URL lỗi**:
  - *Sự cố*: Một số sản phẩm bị lỗi 404 hoặc bị chặn bởi cơ chế bảo mật (Cloudflare).
  - *Khắc phục*: Kiểm tra URL trực tiếp trên trình duyệt. Nếu do lỗi Cloudflare, cân nhắc cấu hình proxy hoặc tối ưu lại HTTP headers (User-Agent).
- **CSV lỗi encoding**:
  - *Sự cố*: Khi mở file CSV chuẩn hóa trên MS Excel bị hiển thị lỗi font tiếng Việt.
  - *Khắc phục*: Sử dụng chức năng Import Data (From Text/CSV) trong Excel và chọn Encoding là UTF-8 thay vì mở trực tiếp bằng cách click đúp.
- **SQL quá lớn**:
  - *Sự cố*: File `seed_longchau_demo.sql` có dung lượng quá lớn dẫn đến lỗi timeout khi import bằng giao diện web của Supabase.
  - *Khắc phục*: Sử dụng các file SQL phân đoạn nhỏ trong thư mục `data/output/sql/` để import từng phần.
- **Supabase import lỗi**:
  - *Sự cố*: Lỗi ràng buộc khóa ngoại (foreign key constraint) khi import dữ liệu.
  - *Khắc phục*: Nhất thiết phải import file chứa dữ liệu danh mục/master data trước (`001_master_data.sql`), sau đó mới import các batch sản phẩm (`002_products_batch_001.sql`).

## 13. Disclaimer y tế
> **“Thông tin thuốc, cách dùng, liều dùng, tương tác thuốc và khuyến nghị chỉ là dữ liệu tham khảo phục vụ đồ án, không thay thế tư vấn của dược sĩ, bác sĩ hoặc chuyên gia y tế.”**
