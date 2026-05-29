# 💊 PharmaAssist Data Collector

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-blue.svg)](https://nodejs.org/)
[![Playwright](https://img.shields.io/badge/playwright-%5E1.49.0-green.svg)](https://playwright.dev/)
[![TypeScript](https://img.shields.io/badge/typescript-%5E5.7.0-blue.svg)](https://www.typescriptlang.org/)
[![License: Private](https://img.shields.io/badge/License-Private-red.svg)](#)

Bộ công cụ thu thập, xử lý và chuẩn hóa dữ liệu sản phẩm tham khảo từ website **Nhà thuốc Long Châu**. Dữ liệu sau khi xử lý sẽ được định dạng cấu trúc dạng quan hệ (CSV) và sẵn sàng sinh mã SQL để nạp dữ liệu demo cho đồ án **PharmaAssist**.

---

## 📌 Mục lục
1. [Giới thiệu](#1-giới-thiệu)
2. [Cài đặt](#2-cài-đặt)
3. [Cấu hình .env](#3-cấu-hình-env)
4. [Hướng dẫn sử dụng](#4-hướng-dẫn-sử-dụng)
   - [Quy trình chạy thử nghiệm (Sample Mode)](#quy-trình-chạy-thử-nghiệm-sample-mode)
   - [Quy trình chạy toàn bộ dữ liệu (Full Mode)](#quy-trình-chạy-toàn-bộ-dữ-liệu-full-mode)
   - [Hướng dẫn cào lại sạch từ đầu (Scrape from Scratch)](#hướng-dẫn-cào-lại-sạch-từ-đầu-scrape-from-scratch)
5. [Cấu trúc dữ liệu đầu ra](#5-cấu-trúc-dữ-liệu-đầu-ra)
6. [Quy tắc an toàn và bảo mật](#6-quy-tắc-an-toàn-và-bảo-mật)
7. [Xử lý sự cố (Troubleshooting)](#7-xử-lý-sự-cố-troubleshooting)
8. [Disclaimer (Tuyên bố từ chối trách nhiệm)](#8-disclaimer-tuyên-bố-từ-chối-trách-nhiệm)

---

## 1. Giới thiệu

Công cụ được xây dựng nhằm thu thập tự động danh mục, sản phẩm, giá bán, hình ảnh và hoạt chất của các nhóm dược phẩm từ Long Châu. 

### 🚀 Tính năng nổi bật
* **Quét dữ liệu siêu tốc bằng API nội bộ:** Chuyển đổi từ cơ chế cuộn DOM truyền thống sang gọi API phân trang nội bộ của Long Châu, nâng hiệu suất quét liên kết lên gấp nhiều lần.
* **Cơ chế Checkpoint & Resume thông minh:** Cho phép lưu trạng thái cào theo thời gian thực (đến từng trang danh mục). Nếu bị gián đoạn hoặc chặn IP, bạn chỉ cần cấu hình `RESUME=true` để cào tiếp tục từ vị trí dừng mà không phải cào lại từ đầu.
* **Chuẩn hóa quan hệ RDBMS:** Tự động tách dữ liệu thô (JSON) thành **15 bảng dữ liệu quan hệ** (CSV) như bảng sản phẩm, giá bán, biến thể, hình ảnh, hoạt chất, v.v.
* **Tự động sinh SQL Seed:** Chuyển đổi trực tiếp các file CSV đã kiểm tra tính toàn vẹn thành mã lệnh SQL (`INSERT`) tương thích với PostgreSQL / Supabase.

---

## 2. Cài đặt

Để cài đặt và chuẩn bị môi trường chạy công cụ, hãy di chuyển vào thư mục dự án và thực hiện các lệnh sau:

1. **Di chuyển vào thư mục dự án:**
   ```bash
   cd tools/data-collector
   ```

2. **Cài đặt các gói phụ thuộc (Dependencies):**
   ```bash
   npm install
   ```

3. **Cài đặt trình duyệt ẩn cho Playwright (Chromium):**
   ```bash
   npm run install:browser
   ```

---

## 3. Cấu hình .env

Sao chép tệp cấu hình mẫu từ `.env.example` để tạo file cấu hình cá nhân:
```bash
cp .env.example .env
```

Mở file `.env` và điều chỉnh các tham số cấu hình tùy theo nhu cầu:

| Biến cấu hình | Giá trị mặc định | Giải thích |
| :--- | :--- | :--- |
| **`CRAWL_MODE`** | `sample` | Chế độ chạy: `sample` (chạy thử nghiệm số lượng nhỏ) hoặc `full` (quét toàn bộ). |
| **`MAX_PRODUCTS`** | `8000` | Giới hạn số lượng sản phẩm tối đa sẽ thu thập (chỉ áp dụng ở chế độ `sample`). |
| **`REQUEST_DELAY_RANDOM_MIN_MS`** | `2000` | Thời gian chờ ngẫu nhiên tối thiểu (ms) giữa các request để tránh bị chặn. |
| **`REQUEST_DELAY_RANDOM_MAX_MS`** | `5000` | Thời gian chờ ngẫu nhiên tối đa (ms) giữa các request. |
| **`BATCH_SIZE`** | `50` | Số lượng sản phẩm ghi xuống file raw JSON sau mỗi lượt cào chi tiết. |
| **`HEADLESS`** | `false` | `true` để chạy ngầm trình duyệt, `false` để hiển thị trình duyệt Chromium khi cào. |
| **`RESUME`** | `true` | Tiếp tục cào dựa trên trạng thái checkpoint cũ (`true`) hoặc xóa bỏ chạy lại (`false`). |
| **`RETRY_FAILED_LIMIT`** | `3` | Số lần thử lại tối đa cho mỗi URL bị lỗi khi cào chi tiết. |

---

## 4. Hướng dẫn sử dụng

### Quy trình chạy thử nghiệm (Sample Mode)
Quy trình chạy thử với số lượng sản phẩm nhỏ để kiểm định cấu trúc dữ liệu đầu ra. Bạn có thể chạy từng bước:
1. Thu thập liên kết sản phẩm: `npm run collect:links`
2. Thu thập chi tiết mẫu: `npm run collect:details:sample`
3. Chuẩn hóa dữ liệu sang CSV: `npm run normalize`
4. Kiểm tra tính hợp lệ của CSV: `npm run validate:data`
5. Tạo file SQL Seed: `npm run generate:sql`

*Hoặc chạy toàn bộ quy trình bằng lệnh gộp duy nhất (Tự động dọn sạch dữ liệu cũ):*

#### 💻 Trên hệ điều hành macOS (MacBook)
macOS hỗ trợ chạy trực tiếp các kịch bản shell Linux. Bạn chỉ cần chạy lệnh sau trong Terminal:
```bash
npm run pipeline:sample:clean
```

#### 💻 Trên hệ điều hành Windows
Mặc định hệ thống Windows không hỗ trợ trực tiếp các lệnh shell của Linux (`rm`, `mkdir`). Bạn có thể chạy bằng 1 trong 2 cách:
* **Cách 1 (Khuyên dùng):** Cấu hình npm sử dụng Git Bash làm Shell mặc định bằng cách chạy lệnh sau trong Command Prompt hoặc PowerShell (thay đổi đường dẫn `bash.exe` nếu bạn cài Git ở ổ đĩa khác):
  ```bash
  npm config set script-shell "C:\\Program Files\\Git\\bin\\bash.exe"
  ```
  Sau khi chạy xong lệnh trên, bạn có thể chạy lệnh gộp trực tiếp ở bất kỳ terminal nào trên Windows:
  ```bash
  npm run pipeline:sample:clean
  ```
* **Cách 2:** Chạy thông qua công cụ **Git Bash** được cài đặt kèm theo Git:
  Mở Git Bash tại thư mục dự án và chạy:
  ```bash
  bash scripts/run_sample_pipeline.sh
  ```

---

### Quy trình chạy toàn bộ dữ liệu (Full Mode)
Quy trình thu thập toàn bộ dữ liệu từ nguồn Nhà thuốc Long Châu (Áp dụng chung cho cả Windows và macOS):

1. **Thu thập danh sách liên kết sản phẩm:**
   ```bash
   npm run collect:links
   ```
   *Lệnh này sử dụng API mới phân trang siêu tốc để quét hàng ngàn sản phẩm chỉ trong vài phút.*

2. **Thu thập chi tiết toàn bộ sản phẩm:**
   ```bash
   npm run collect:details:full
   ```
   *Truy cập từng sản phẩm để lấy thông tin chi tiết (thành phần, hình ảnh, đơn vị tính, hướng dẫn sử dụng...).*

3. **Cào lại các sản phẩm lỗi (nếu có):**
   ```bash
   npm run retry:failed
   ```

4. **Chuẩn hóa dữ liệu thô sang CSV:**
   ```bash
   npm run normalize
   ```

5. **Kiểm định dữ liệu đầu ra:**
   ```bash
   npm run validate:data
   ```

6. **Sinh mã SQL Seed:**
   ```bash
   npm run generate:sql
   ```

---

### Hướng dẫn cào lại sạch từ đầu (Scrape from Scratch)
Khi bạn muốn bỏ qua toàn bộ checkpoint cũ, làm sạch bộ nhớ đệm và cào lại tất cả từ trang đầu tiên:

#### 1. Dọn sạch thư mục dữ liệu cũ
* **💻 Trên hệ điều hành Windows:**
  * **Nếu sử dụng PowerShell:**
    ```powershell
    Remove-Item -Recurse -Force data/raw/products, data/state, data/normalized, data/output -ErrorAction Ignore
    Remove-Item -Force data/raw/product_links.raw.json -ErrorAction Ignore
    New-Item -ItemType Directory -Force data/raw/products, data/state, data/normalized, data/output, data/output/sql
    ```
  * **Nếu sử dụng Command Prompt (cmd):**
    ```cmd
    rmdir /s /q data\raw\products
    rmdir /s /q data\state
    rmdir /s /q data\normalized
    rmdir /s /q data\output
    del data\raw\product_links.raw.json
    mkdir data\raw\products
    mkdir data\state
    mkdir data\normalized
    mkdir data\output
    mkdir data\output\sql
    ```

* **💻 Trên hệ điều hành macOS (MacBook):**
  Chạy lệnh sau trong Terminal:
  ```bash
  rm -rf data/raw/products data/state data/normalized data/output data/raw/product_links.raw.json
  mkdir -p data/raw/products data/state data/normalized data/output data/output/sql
  ```

#### 2. Cập nhật lại file `.env`
Thiết lập các cấu hình sau trong file `.env`:
```env
RESUME=false
CRAWL_MODE=full
```

#### 3. Thực hiện chạy tuần tự
Tiến hành chạy lại quy trình Full Mode bắt đầu từ lệnh `npm run collect:links`.

---

## 5. Cấu trúc dữ liệu đầu ra

Thư mục dữ liệu sau khi cào và chuẩn hóa thành công:
```
data-collector/
├── data/
│   ├── raw/                 # Dữ liệu thô JSON (chia theo từng nhóm sản phẩm)
│   ├── normalized/          # 15 file dữ liệu quan hệ CSV (products.csv, brands.csv,...)
│   ├── state/               # Checkpoint lưu trạng thái (completed_urls.json, failed_urls.json)
│   └── output/
│       ├── data_quality_report.md     # Báo cáo đánh giá chất lượng dữ liệu
│       ├── seed_longchau_demo.sql     # File SQL seed tổng hợp cho PostgreSQL
│       └── sql/                       # Các file SQL phân đoạn theo batch nhỏ
└── logs/                    # Ghi nhận log chi tiết tiến trình cào và lỗi (errors.log)
```

---

## 6. Quy tắc an toàn và bảo mật

* **Không gửi request dồn dập:** Luôn thiết lập tham số trễ ngẫu nhiên (`REQUEST_DELAY_RANDOM_MIN_MS` & `REQUEST_DELAY_RANDOM_MAX_MS`) tối thiểu 2-3 giây.
* **Không cào dữ liệu người dùng:** Tool chỉ lấy thông tin sản phẩm công khai, tuyệt đối không lấy dữ liệu bình luận chi tiết hay thông tin khách hàng.
* **Không commit dữ liệu thô:** Thư mục dữ liệu `data/` (ngoại trừ cấu hình) đã được đưa vào `.gitignore` để tránh việc đẩy file dung lượng lớn lên GitHub.
* **Không tải ảnh về máy:** Tool chỉ lấy liên kết hình ảnh gốc trên CDN Long Châu và lưu vào cơ sở dữ liệu để tiết kiệm tài nguyên.

---

## 7. Xử lý sự cố (Troubleshooting)

* **Lỗi thiếu browser Playwright:**
  * *Triệu chứng:* Báo lỗi thiếu thư viện Chromium khi chạy script.
  * *Khắc phục:* Chạy lại lệnh `npm run install:browser`.
* **Trang web bị chặn bởi Cloudflare:**
  * *Triệu chứng:* Báo lỗi 403 Forbidden hoặc WAF Block.
  * *Khắc phục:* Đổi địa chỉ IP mạng (ví dụ kết nối qua mạng 4G phát từ điện thoại), đổi cấu hình `HEADLESS=false` để thực hiện xác minh tay trên màn hình Chromium nếu được yêu cầu.
* **Lỗi ràng buộc khóa ngoại (Foreign Key) khi import SQL:**
  * *Khắc phục:* Bạn phải import file chứa dữ liệu master data trước (`001_master_data.sql`), sau đó mới import các batch sản phẩm (`002_products_batch_001.sql`).

---

## 8. Disclaimer (Tuyên bố từ chối trách nhiệm)

> ⚠️ **MỤC ĐÍCH HỌC TẬP:** Dữ liệu thu thập từ Nhà thuốc Long Châu thông qua công cụ này chỉ nhằm mục đích thử nghiệm và làm dữ liệu demo cho đồ án học tập PharmaAssist. Thông tin chi tiết về thuốc, cách sử dụng, liều dùng và chỉ định KHÔNG sử dụng làm tài liệu tư vấn y khoa thực tế.
