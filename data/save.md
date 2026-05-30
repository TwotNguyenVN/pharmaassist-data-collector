Đây là phân tích so sánh chi tiết:

📊 Tổng quan kích thước dữ liệu
Phương thức	Tổng dung lượng	Số file	File lớn nhất
CSV (normalized)	199.44 MB	15 files	product_documents.csv — 163.55 MB
SQL (batched)	238.42 MB	32 files	002_products_batch_010.sql — 12.16 MB
SQL (consolidated)	238.42 MB	1 file	seed_longchau_demo.sql — 238 MB
🏆 Khuyến nghị: Tùy theo nền tảng DB bạn chọn
Phương án 1: Dùng CSV + COPY command (⭐ Khuyến nghị cho PostgreSQL / Supabase CLI)
Ưu điểm	Nhược điểm
Nhanh hơn 5-10x so với INSERT vì PostgreSQL COPY là bulk-load native	Cần tạo schema (DDL) riêng trước
File nhỏ hơn (~199 MB vs 238 MB)	Phải quản lý thứ tự import theo foreign key
Dễ debug, xem bằng Excel/Google Sheets	Không tự xử lý ON CONFLICT
Quy trình:

bash
# 1. Tạo schema trước (cần viết 1 file DDL)
psql -f create_schema.sql
# 2. Import CSV theo thứ tự FK
psql -c "\COPY countries FROM 'countries.csv' WITH CSV HEADER"
psql -c "\COPY manufacturers FROM 'manufacturers.csv' WITH CSV HEADER"
psql -c "\COPY brands FROM 'brands.csv' WITH CSV HEADER"
# ... theo thứ tự phụ thuộc
Phương án 2: Dùng SQL batch files (⭐ Khuyến nghị cho Supabase SQL Editor / dev nhanh)
Ưu điểm	Nhược điểm
Chạy thẳng, không cần cấu hình	Chậm hơn CSV (INSERT từng row/batch)
Đã có sẵn schema + data trong file	File consolidated 238 MB — có thể timeout trên web editor
Xử lý ON CONFLICT sẵn	SQL batch 5-12 MB/file — phải chạy tuần tự 32 lần
Portable, chạy được trên mọi PostgreSQL client	
📌 Tóm lại
Tình huống	Nên dùng
PostgreSQL local / VPS / Supabase CLI	CSV + \COPY — nhanh nhất
Supabase SQL Editor (web)	SQL batch — chạy từng file 001 → 031
Muốn seed nhanh lần đầu, không quan tâm tốc độ	SQL batch — đơn giản nhất
Dataset > 1 triệu rows sau này	CSV bắt buộc, SQL sẽ quá chậm
Bạn đang dùng database nào (PostgreSQL local, Supabase, hay khác)? Tôi sẽ hỗ trợ viết script import phù hợp.







# 🗂️ Đánh Giá & Tối Ưu Trường Dữ Liệu Database

> Phân tích 15 bảng trong `data/normalized/` — Giữ gì, bỏ gì, tại sao.

## 📊 Tổng quan dung lượng hiện tại

| Bảng | Rows | Dung lượng | % Tổng |
|------|------|------------|--------|
| `product_documents` | 1,370,192 | **163.55 MB** | **82.0%** |
| `product_images` | 41,524 | 12.93 MB | 6.5% |
| `medicine_ingredients` | 25,982 | 6.02 MB | 3.0% |
| `products` | 7,609 | 5.85 MB | 2.9% |
| `product_variants` | 15,982 | 4.00 MB | 2.0% |
| `product_prices` | 15,982 | 3.51 MB | 1.8% |
| `active_ingredients` | 5,296 | 1.33 MB | 0.7% |
| `medicines` | 5,657 | 1.23 MB | 0.6% |
| `manufacturers` | 2,106 | 0.52 MB | 0.3% |
| `brands` | 1,064 | 0.23 MB | 0.1% |
| Còn lại (5 bảng) | ~1,225 | 0.29 MB | 0.1% |
| **Tổng** | **~1,491,619** | **199.44 MB** | **100%** |

> [!IMPORTANT]
> **`product_documents` chiếm 82% tổng dung lượng.** Bất kỳ tối ưu nào ở bảng này đều có tác động lớn nhất.

---

## 🔴 CÁC TRƯỜNG "METADATA TRACING" — BỎ TẤT CẢ

**5 trường sau xuất hiện ở TẤT CẢ 15 bảng** và chỉ phục vụ mục đích truy vết nguồn gốc dữ liệu (data lineage), **KHÔNG cần thiết cho ứng dụng PharmaAssist:**

| Trường | Mẫu dữ liệu | Lý do bỏ |
|--------|-------------|---------|
| `source_name` | `"Nhà thuốc Long Châu"` | Luôn giống nhau — 100% từ Long Châu |
| `source_url` | `"https://nhathuoclongchau.com.vn/..."` | URL gốc đã có trong `products.source_url` |
| `source_note` | `"Dữ liệu tham khảo phục vụ đồ án PharmaAssist"` | Chuỗi cố định, không có giá trị |
| `is_demo_data` | `true` | Luôn `true` — không phân biệt gì |
| `collected_at` | `"2026-05-28T21:57:18.481Z"` | Timestamp cào dữ liệu, không cần cho app |

> [!TIP]
> **Ước tính tiết kiệm:** ~200-250 bytes/row × 1,491,619 rows ≈ **~35-40 MB** (khoảng 18-20% tổng dung lượng)

---

## 📋 Phân Tích Chi Tiết Từng Bảng

### Ký hiệu đánh giá:
- ✅ **GIỮ** — Cần thiết cho ứng dụng
- ⚠️ **CÂN NHẮC** — Tùy mục đích sử dụng
- ❌ **BỎ** — Không cần, lãng phí dung lượng

---

### 1. `products.csv` — Bảng sản phẩm chính (7,609 rows / 5.85 MB)

| Trường | Đánh giá | Ghi chú |
|--------|---------|---------|
| `product_code` | ✅ GIỮ | Primary Key |
| `category_code` | ✅ GIỮ | FK → `product_categories` |
| `brand_code` | ✅ GIỮ | FK → `brands` |
| `manufacturer_code` | ✅ GIỮ | FK → `manufacturers` |
| `country_code` | ✅ GIỮ | FK → `countries` |
| `product_name` | ✅ GIỮ | Tên sản phẩm — bắt buộc |
| `product_slug` | ⚠️ CÂN NHẮC | Dùng cho SEO/URL. Nếu app không cần URL thân thiện → **bỏ** |
| `product_type` | ✅ GIỮ | Phân loại: MEDICINE, PERSONAL_CARE, etc. |
| `short_description` | ⚠️ CÂN NHẮC | Mô tả ngắn. Có thể **rút gọn** hoặc **bỏ** nếu đã có `product_documents.OVERVIEW` |
| `rating_average` | ⚠️ CÂN NHẮC | Hầu hết trống. Giữ nếu muốn hiển thị đánh giá |
| `review_count` | ⚠️ CÂN NHẮC | Hầu hết trống. Cùng nhóm với `rating_average` |
| `base_unit_code` | ✅ GIỮ | Đơn vị cơ bản (Hộp, Chai, ...) |
| `price_status` | ✅ GIỮ | `AVAILABLE` / `PRESCRIPTION_ONLY` / `CONTACT` |
| `source_url` | ⚠️ CÂN NHẮC | **Chỉ giữ ở bảng `products`** nếu cần link gốc. Bỏ ở tất cả bảng khác |

**Khuyến nghị:** Giữ `product_slug` nếu build web app. Bỏ `short_description` nếu dùng `product_documents.OVERVIEW` thay thế.

---

### 2. `product_documents.csv` — ⚡ Bảng NẶNG NHẤT (1,370,192 rows / 163.55 MB)

| Trường | Đánh giá | Ghi chú |
|--------|---------|---------|
| `product_code` | ✅ GIỮ | FK → `products` |
| `document_type` | ✅ GIỮ | `OVERVIEW`, `INDICATIONS`, `DOSAGE`, `PRECAUTIONS`, `STORAGE`, `SIDE_EFFECTS` |
| `title` | ⚠️ CÂN NHẮC | Tiêu đề section. Có thể sinh từ `document_type` → **bỏ** để giảm tải |
| `content` | ✅ GIỮ | Nội dung text thuần — cần cho search, AI, chatbot |
| `content_html` | ❌ **BỎ** | HTML markup. Nặng gấp 1.5-2x `content`. Chỉ cần nếu render HTML trên web |

> [!WARNING]
> **`content_html` là "thủ phạm" chính!**
> - Ước tính `content_html` chiếm **60-70 MB** (gấp 1.5-2x `content` vì chứa HTML tags).
> - Bỏ trường này giảm bảng từ **163 MB → ~95-100 MB**.
> - Nếu cần HTML sau này, có thể chuyển `content` → HTML bằng markdown parser.

> [!IMPORTANT]
> **Về số dòng 1,370,192:** Con số này rất lớn vì mỗi sản phẩm có tối đa **6 loại document** (`OVERVIEW`, `INDICATIONS`, `DOSAGE`, `PRECAUTIONS`, `STORAGE`, `SIDE_EFFECTS`) và nội dung text được split theo dòng. Đây là thiết kế chuẩn hóa (long-format), nhưng bạn có thể **gộp lại** thành 1 row/product/type nếu muốn giảm rows.

**Phân bố document_type:**

| Type | Rows | Mô tả |
|------|------|-------|
| `DOSAGE` | 7,604 | Liều dùng — ✅ Rất quan trọng cho thuốc |
| `PRECAUTIONS` | 7,582 | Thận trọng khi dùng — ✅ Bắt buộc |
| `STORAGE` | 7,520 | Bảo quản — ⚠️ Có thể rút gọn |
| `INDICATIONS` | 7,498 | Chỉ định — ✅ Quan trọng |
| `SIDE_EFFECTS` | 6,864 | Tác dụng phụ — ✅ Bắt buộc |
| `OVERVIEW` | 1,737 | Tổng quan — ⚠️ Trùng với `short_description` |

---

### 3. `product_images.csv` — Ảnh sản phẩm (41,524 rows / 12.93 MB)

| Trường | Đánh giá | Ghi chú |
|--------|---------|---------|
| `product_code` | ✅ GIỮ | FK → `products` |
| `image_url` | ✅ GIỮ | **Nhưng cần fix!** Hiện lưu dạng JSON `{"url":"...", "alternativeText":null}`. Nên chỉ lưu URL string thuần |
| `is_primary` | ✅ GIỮ | Ảnh chính hay phụ |
| `display_order` | ✅ GIỮ | Thứ tự hiển thị |

> [!TIP]
> **Tối ưu `image_url`:** Hiện tại lưu dạng JSON object, chứa `alternativeText: null` thừa. Nên extract chỉ URL → giảm ~30-40% dung lượng cột.
>
> **Giới hạn ảnh:** Trung bình 5.5 ảnh/sản phẩm, max 36 ảnh. Có thể chỉ giữ **3-5 ảnh đầu** mỗi sản phẩm (filter `display_order <= 5`) → giảm từ 41K → ~30K rows.

---

### 4. `product_variants.csv` — Biến thể sản phẩm (15,982 rows / 4 MB)

| Trường | Đánh giá | Ghi chú |
|--------|---------|---------|
| `variant_code` | ✅ GIỮ | PK |
| `product_code` | ✅ GIỮ | FK → `products` |
| `sku` | ✅ GIỮ | Mã SKU — duy nhất, quan trọng |
| `unit_code` | ✅ GIỮ | FK → `medicine_units` |
| `unit_name` | ❌ **BỎ** | **Trùng lặp!** Đã có trong `medicine_units.unit_name` qua `unit_code`. Denormalized thừa |
| `packaging_size` | ✅ GIỮ | "Hộp 3 Cái", "Chai 100ml" — thông tin quan trọng |
| `is_default` | ✅ GIỮ | Biến thể mặc định |
| `is_sell_default` | ⚠️ CÂN NHẮC | Gần như luôn trùng `is_default`. **Bỏ** nếu luôn giống nhau |

---

### 5. `product_prices.csv` — Giá bán (15,982 rows / 3.51 MB)

| Trường | Đánh giá | Ghi chú |
|--------|---------|---------|
| `variant_code` | ✅ GIỮ | FK → `product_variants` |
| `unit_code` | ✅ GIỮ | Đơn vị giá |
| `price` | ✅ GIỮ | Giá bán — bắt buộc |
| `currency` | ⚠️ CÂN NHẮC | Luôn là "đ" (VND). Nếu chỉ dùng 1 currency → **bỏ**, hardcode trong app |
| `is_default` | ✅ GIỮ | Giá mặc định |
| `is_contact_price` | ✅ GIỮ | Thuốc kê đơn cần liên hệ |
| `conversion_factor` | ⚠️ CÂN NHẮC | Hệ số quy đổi. Hầu hết trống. Giữ nếu có quy đổi Viên → Hộp |

---

### 6. `medicines.csv` — Thông tin thuốc (5,657 rows / 1.23 MB)

| Trường | Đánh giá | Ghi chú |
|--------|---------|---------|
| `product_code` | ✅ GIỮ | FK → `products` |
| `registration_number` | ✅ GIỮ | Số đăng ký — quan trọng cho dược phẩm |
| `dosage_form_code` | ✅ GIỮ | FK → `dosage_forms` |
| `requires_prescription` | ✅ GIỮ | Cần kê đơn không — bắt buộc |
| `shelf_life_months` | ✅ GIỮ | Hạn sử dụng (tháng) — vừa enriched |
| `temperature_condition` | ⚠️ CÂN NHẮC | Điều kiện bảo quản nhiệt độ. Hầu hết trống |
| `light_condition` | ⚠️ CÂN NHẮC | Điều kiện ánh sáng. Hầu hết trống |
| `humidity_condition` | ⚠️ CÂN NHẮC | Điều kiện độ ẩm. Hầu hết trống |

> [!NOTE]
> 3 trường condition (`temperature`, `light`, `humidity`) hầu hết trống. Có thể **gộp thành 1 cột JSON** `storage_conditions` hoặc **bỏ** nếu thông tin bảo quản đã có trong `product_documents.STORAGE`.

---

### 7. `medicine_ingredients.csv` — Thành phần thuốc (25,982 rows / 6.02 MB)

| Trường | Đánh giá | Ghi chú |
|--------|---------|---------|
| `product_code` | ✅ GIỮ | FK → `products` |
| `ingredient_code` | ✅ GIỮ | FK → `active_ingredients` |
| `strength_value` | ✅ GIỮ | Hàm lượng (500, 250, ...) |
| `strength_unit` | ✅ GIỮ | Đơn vị (mg, ml, ...) |
| `raw_text` | ❌ **BỎ** | Text gốc chưa parse. Đã có `ingredient_code` + `strength` → thừa |

---

### 8. `active_ingredients.csv` — Hoạt chất (5,296 rows / 1.33 MB)

| Trường | Đánh giá | Ghi chú |
|--------|---------|---------|
| `ingredient_code` | ✅ GIỮ | PK |
| `ingredient_name` | ✅ GIỮ | Tên hoạt chất — bắt buộc |
| `ingredient_slug` | ⚠️ CÂN NHẮC | Slug cho URL. Bỏ nếu không build web |
| `description` | ⚠️ CÂN NHẮC | Hầu hết trống. Bỏ nếu không có dữ liệu |

---

### 9-15. Các bảng master data nhỏ (tổng ~0.97 MB)

Các bảng này rất nhỏ, **giữ nguyên tất cả trường** (trừ 5 trường metadata tracing).

| Bảng | Rows | Đánh giá |
|------|------|---------|
| `manufacturers` | 2,106 | ✅ Giữ: `manufacturer_code`, `manufacturer_name`. ⚠️ Bỏ `manufacturer_slug` nếu không cần |
| `brands` | 1,064 | ✅ Giữ: `brand_code`, `brand_name`. ⚠️ Bỏ `brand_slug` nếu không cần |
| `product_categories` | 257 | ✅ Giữ tất cả: `category_code`, `parent_category_code`, `category_name`, `category_slug`, `level` |
| `category_closures` | 710 | ✅ Giữ tất cả: `ancestor_code`, `descendant_code`, `depth` — cần cho truy vấn cây danh mục |
| `dosage_forms` | 176 | ✅ Giữ: `dosage_form_code`, `dosage_form_name`. ⚠️ Bỏ `dosage_form_slug` |
| `countries` | 58 | ✅ Giữ: `country_code`, `country_name`. ⚠️ Bỏ `country_slug` |
| `medicine_units` | 24 | ✅ Giữ tất cả: `unit_code`, `unit_name` |

---

## 📈 Tổng kết — Ước tính tiết kiệm

### Phương án A: Tối ưu TỐI THIỂU (safe)
> Chỉ bỏ các trường chắc chắn không cần

| Hành động | Tiết kiệm ước tính |
|-----------|-------------------|
| Bỏ 5 trường metadata tracing (tất cả 15 bảng) | ~35-40 MB |
| Bỏ `content_html` trong `product_documents` | ~60-70 MB |
| Bỏ `raw_text` trong `medicine_ingredients` | ~2-3 MB |
| Bỏ `unit_name` trùng trong `product_variants` | ~0.5 MB |
| **Tổng tiết kiệm** | **~97-113 MB (~50-57%)** |
| **Dung lượng còn lại** | **~86-102 MB** |

### Phương án B: Tối ưu MẠNH (cho app nhẹ)
> Bỏ thêm các trường ít sử dụng

| Hành động (thêm vào Phương án A) | Tiết kiệm thêm |
|-----------------------------------|----------------|
| Bỏ tất cả `*_slug` (6 bảng) | ~1-2 MB |
| Bỏ `short_description` (dùng OVERVIEW thay) | ~2-3 MB |
| Bỏ `title` trong `product_documents` | ~1-2 MB |
| Bỏ `currency` (hardcode VND) | ~0.2 MB |
| Gộp 3 condition → 1 JSON column | ~0.1 MB |
| Giới hạn ảnh ≤ 5/sản phẩm | ~3-4 MB |
| Clean `image_url` (bỏ JSON, giữ URL thuần) | ~3-4 MB |
| Fix `product_documents` rows (gộp content) | ~10-15 MB |
| **Tổng tiết kiệm Phương án B** | **~118-140 MB (~59-70%)** |
| **Dung lượng còn lại** | **~59-81 MB** |

---

## 🎯 Bảng tổng kết theo từng bảng

| Bảng | Trường GIỮ | Trường BỎ | Trường CÂN NHẮC |
|------|-----------|----------|-----------------|
| `products` | `product_code`, `category_code`, `brand_code`, `manufacturer_code`, `country_code`, `product_name`, `product_type`, `base_unit_code`, `price_status` | 5 metadata | `product_slug`, `short_description`, `rating_average`, `review_count`, `source_url` |
| `product_documents` | `product_code`, `document_type`, `content` | 5 metadata + `content_html` | `title` |
| `product_images` | `product_code`, `image_url` (clean), `is_primary`, `display_order` | 5 metadata | Giới hạn ≤ 5 ảnh/SP |
| `product_variants` | `variant_code`, `product_code`, `sku`, `unit_code`, `packaging_size`, `is_default` | 5 metadata + `unit_name` | `is_sell_default` |
| `product_prices` | `variant_code`, `unit_code`, `price`, `is_default`, `is_contact_price` | 5 metadata | `currency`, `conversion_factor` |
| `medicines` | `product_code`, `registration_number`, `dosage_form_code`, `requires_prescription`, `shelf_life_months` | 5 metadata | `temperature_condition`, `light_condition`, `humidity_condition` |
| `medicine_ingredients` | `product_code`, `ingredient_code`, `strength_value`, `strength_unit` | 5 metadata + `raw_text` | — |
| `active_ingredients` | `ingredient_code`, `ingredient_name` | 5 metadata | `ingredient_slug`, `description` |
| `manufacturers` | `manufacturer_code`, `manufacturer_name` | 5 metadata | `manufacturer_slug` |
| `brands` | `brand_code`, `brand_name` | 5 metadata | `brand_slug` |
| `product_categories` | Giữ tất cả trường chính | 5 metadata | — |
| `category_closures` | Giữ tất cả trường chính | 5 metadata | — |
| `dosage_forms` | `dosage_form_code`, `dosage_form_name` | 5 metadata | `dosage_form_slug` |
| `countries` | `country_code`, `country_name` | 5 metadata | `country_slug` |
| `medicine_units` | Giữ tất cả | 5 metadata | — |

---

## ❓ Câu hỏi cần bạn quyết định

1. **Bạn có cần build web app với SEO-friendly URLs không?** → Quyết định giữ/bỏ `*_slug`
2. **App có cần render HTML (content_html) hay chỉ cần text thuần (content)?** → Quyết định bỏ `content_html`
3. **Bạn chọn Phương án A (safe) hay Phương án B (tối ưu mạnh)?**
4. **Có muốn tôi viết script tự động clean/optimize các CSV không?**
