# Đánh giá chi tiết điểm yếu dữ liệu & Đề xuất giải pháp tối ưu cho PharmaAssist

Tài liệu này phân tích sâu các điểm yếu/cảnh báo được phát hiện từ quá trình thu thập và chuẩn hóa dữ liệu của hệ thống PharmaAssist, đồng thời đề xuất các phương án xử lý chi tiết ở mức thiết kế Database (PostgreSQL/Supabase) và Logic Backend/Frontend.

---

## 1. Phân tích chi tiết Điểm yếu & Cảnh báo (Detailed Weaknesses & Warnings Analysis)

### 🔴 1.1. Thiếu thông tin giá bán (Missing Prices - 58.4%)
*   **Thực trạng:** 
    *   Tổng số sản phẩm chuẩn hóa: 7.608.
    *   Số sản phẩm có giá bán hợp lệ: 3.164 (~41.6%).
    *   Số sản phẩm hoàn toàn không có giá bán: 4.444 (~58.4%).
*   **Nguyên nhân:** 
    *   *Thuốc kê đơn (Rx):* Theo quy định của Bộ Y tế, thuốc kê đơn không được phép bán lẻ trực tuyến rộng rãi mà phải có đơn thuốc của bác sĩ. Website Nhà thuốc Long Châu chỉ hiển thị trạng thái "Sản phẩm chỉ bán khi có đơn thuốc" hoặc "Liên hệ tư vấn" để tuân thủ pháp luật.
    *   *Thiết bị y tế đặc chủng & Sản phẩm mới:* Các trang thiết bị lớn hoặc mặt hàng hiếm thường không có giá niêm yết cố định mà phụ thuộc vào báo giá tại thời điểm mua hoặc chỉ có trực tiếp tại cửa hàng vật lý.
*   **Ảnh hưởng hệ thống:**
    *   *Lỗi Logic Frontend:* Nếu client-side mặc định render giá và thực hiện các phép tính toán (`cart_item_total = price * quantity`), giá trị `null` hoặc `NaN` sẽ gây crash giao diện hoặc sai lệch giỏ hàng.
    *   *Trải nghiệm người dùng (UX):* Người dùng không biết làm thế nào để mua hoặc đặt hàng đối với các sản phẩm thiếu giá này.
    *   *Bộ lọc giá (Price Filtering):* Việc tìm kiếm sản phẩm theo khoảng giá sẽ hoạt động không chính xác hoặc bỏ sót lượng lớn sản phẩm.

### 🔴 1.2. Thiếu hoàn toàn thông tin hạn dùng (Shelf Life - Trống 100%)
*   **Thực trạng:**
    *   Trường `shelf_life_months` trong bảng `medicines.csv` có giá trị trống (`null`) trên toàn bộ 5.657 bản ghi thuốc.
*   **Nguyên nhân:**
    *   Thông tin hạn dùng (ví dụ: "36 tháng kể từ ngày sản xuất") thường nằm sâu trong nhãn phụ sản phẩm, hình ảnh bao bì, hoặc tệp hướng dẫn PDF đi kèm mà không được cấu hình dưới dạng thuộc tính văn bản có cấu trúc (structured metadata) trên website gốc để crawler có thể bóc tách dễ dàng.
*   **Ảnh hưởng hệ thống:**
    *   *Tính năng Quản lý Kho (Inventory Management):* Đồ án PharmaAssist định hướng là hệ thống quản lý dược phẩm thông minh. Nếu thiếu hạn dùng của thuốc, hệ thống sẽ không thể xây dựng các tính năng cốt lõi như:
        *   Cảnh báo thuốc sắp hết hạn (Expired Alerts).
        *   Quản lý xuất kho theo cơ chế FEFO (First Expired, First Out - Hàng hết hạn trước xuất trước).
        *   Lên kế hoạch khuyến mãi thanh lý hàng cận date.

### 🔴 1.3. Văn bản chuyên môn quá dài (Long Text Content Warning)
*   **Thực trạng:**
    *   Hàng trăm sản phẩm thuốc có các trường tài liệu chuyên môn dài bất thường trong `product_documents.csv`.
    *   *Ví dụ điển hình:* Trường Thận trọng (`PRECAUTIONS`) của sản phẩm `P002353` dài tới **31.848 ký tự**, Chỉ định (`INDICATIONS`) của sản phẩm `P001736` dài **31.518 ký tự**.
*   **Nguyên nhân:**
    *   Dữ liệu y tế là tài liệu hướng dẫn sử dụng chi tiết (package insert) của nhà sản xuất, bao gồm các cảnh báo lâm sàng, cơ chế tương tác sinh hóa phức tạp, và hướng dẫn cho mọi nhóm đối tượng đặc biệt.
*   **Ảnh hưởng hệ thống:**
    *   *Hiệu năng Database:* Việc lưu trữ chuỗi ký tự quá lớn trong các cột cơ sở dữ liệu nếu thiết kế không tối ưu sẽ gây tăng dung lượng bản ghi (Row Size), làm chậm quá trình quét chỉ mục (Index Scan) và tốn bộ nhớ đệm (Buffer Pool).
    *   *Hiệu năng Mạng & API:* Khi API trả về danh sách sản phẩm (Product List API) mà vô tình kèm theo toàn bộ nội dung tài liệu dài hàng chục KB này cho mỗi sản phẩm, payload size sẽ phình to gấp 10-20 lần, gây lag đường truyền và chậm trễ thời gian phản hồi (TTFB/INP).

---

## 2. Đề xuất giải pháp cải thiện chi tiết (Proposed Solutions & Architectures)

### 💡 2.1. Giải pháp xử lý Thiếu Giá bán
Để vừa tuân thủ nghiệp vụ y tế vừa đảm bảo tính ổn định của phần mềm, kiến trúc DB và API cần được tối ưu như sau:

1.  **Thiết kế Schema Database:**
    Bổ sung các trường quản lý trạng thái hiển thị giá vào bảng `product_prices` và `products`:
    ```sql
    ALTER TABLE products ADD COLUMN price_status VARCHAR(50) DEFAULT 'AVAILABLE'; 
    -- Các trạng thái: 'AVAILABLE' (Có giá), 'CONTACT' (Liên hệ), 'PRESCRIPTION_ONLY' (Chỉ bán theo đơn)
    
    ALTER TABLE product_prices ADD COLUMN is_contact_price BOOLEAN DEFAULT FALSE;
    ```
2.  **Logic xử lý tại Backend:**
    *   Nếu sản phẩm thuộc loại `Rx` (yêu cầu kê đơn) hoặc không cào được giá: Thiết lập `price = 0` (hoặc `NULL`) và gán `is_contact_price = TRUE` kèm `price_status = 'PRESCRIPTION_ONLY'`.
    *   Khi tính toán giỏ hàng, Backend phải từ chối tính tiền trực tiếp cho các sản phẩm có `is_contact_price = TRUE` và chuyển trạng thái của item đó trong giỏ hàng thành "Đặt yêu cầu báo giá/Gửi đơn thuốc" thay vì "Thanh toán online".
3.  **Xử lý ở Frontend UI/UX:**
    *   Khi hiển thị danh sách và chi tiết sản phẩm:
        ```javascript
        if (product.price_status === 'PRESCRIPTION_ONLY') {
          renderPrice("Liên hệ - Cần có đơn thuốc");
          renderButton("Gửi toa thuốc mua");
        } else if (product.price_status === 'CONTACT' || !product.price) {
          renderPrice("Giá liên hệ");
          renderButton("Yêu cầu báo giá");
        } else {
          renderPrice(formatCurrency(product.price));
          renderButton("Thêm vào giỏ hàng");
        }
        ```

### 💡 2.2. Giải pháp xử lý Thiếu Hạn dùng (`shelf_life`)
Do đây là dữ liệu demo phục vụ học tập/đồ án, chúng ta có thể áp dụng chiến lược kết hợp tự động điền (Seeding Script) và giao diện cập nhật thủ công:

1.  **Chạy kịch bản tự động điền (Auto-seed / Data Augmentation):**
    Viết một script bổ sung giá trị ngẫu nhiên có căn cứ y tế cho cột `shelf_life_months` trong file `medicines.csv` trước khi sinh SQL Seed.
    *   *Quy tắc gán giá trị hợp lý:*
        *   Thuốc kháng sinh, kháng nấm (hỗn dịch): 12 - 24 tháng.
        *   Thuốc viên, viên nang cứng/mềm: 24 - 36 tháng.
        *   Dịch truyền, thuốc tiêm: 18 - 24 tháng.
    *   *Đoạn mã gợi ý bổ sung trong pipeline chuẩn hóa:*
        ```typescript
        function generateDemoShelfLife(dosageFormName: string | null): number {
          if (!dosageFormName) return 24; // mặc định 2 năm
          const name = dosageFormName.toLowerCase();
          if (name.includes('tiêm') || name.includes('truyền') || name.includes('hỗn dịch')) {
            return 18; // 1.5 năm
          }
          if (name.includes('viên') || name.includes('nang') || name.includes('nén')) {
            return 36; // 3 năm
          }
          return 24;
        }
        ```
2.  **Xây dựng UI Admin bổ sung:**
    Thiết kế giao diện quản trị (Admin Portal) cho hệ thống PharmaAssist cho phép Dược sĩ/Quản kho cập nhật lại trường Hạn dùng (`shelf_life_months`) và cấu hình ngày sản xuất (`manufacturing_date`) của từng lô hàng cụ thể khi nhập kho thực tế.

### 💡 2.3. Giải pháp tối ưu Tài liệu dài (Long Text Optimization)
Đây là bài toán tối ưu hiệu năng cơ sở dữ liệu và băng thông truyền tải rất quan trọng:

1.  **Thiết kế Cơ sở dữ liệu (PostgreSQL / Supabase):**
    *   Sử dụng kiểu dữ liệu `TEXT` cho các cột `content` và `content_html` trong bảng `product_documents`. Tránh tuyệt đối dùng `VARCHAR(N)` vì nội dung y tế có thể vượt giới hạn bất kỳ lúc nào.
    *   Tách biệt hoàn toàn bảng `product_documents` khỏi bảng `products` (đã thực hiện đúng trong cấu trúc chuẩn hóa hiện tại). Khi truy vấn thông tin sản phẩm thông thường, **không** thực hiện `JOIN` với bảng tài liệu để tránh tải dữ liệu không cần thiết.
2.  **Tối ưu hóa API trả về (API Payload Optimization):**
    *   *API Danh mục/Tìm kiếm sản phẩm (Product List API):* Tuyệt đối không trả về trường `content` hay `content_html`. Chỉ trả về các trường cơ bản (`product_code`, `product_name`, `price`, `image`).
    *   *API Chi tiết sản phẩm (Product Detail API):* Chỉ load tài liệu khi người dùng truy cập vào trang chi tiết sản phẩm. Có thể áp dụng kỹ thuật **Lazy Loading** (tải trước thông tin cơ bản, sau đó gọi một API riêng để lấy tài liệu hướng dẫn sử dụng khi người dùng click vào tab "Thông tin chi tiết").
3.  **Áp dụng Tìm kiếm Toàn văn (Full-Text Search - FTS) trong PostgreSQL:**
    Để hỗ trợ tìm kiếm nhanh các từ khóa y học nằm sâu trong tài liệu dài (ví dụ: tìm thuốc điều trị "đau đầu", "sốt xuất huyết"), hãy cấu hình FTS trên PostgreSQL:
    ```sql
    -- Tạo cột index tìm kiếm toàn văn sử dụng ngôn ngữ tiếng Anh/Việt
    ALTER TABLE product_documents ADD COLUMN fts_document tsvector;
    
    -- Cập nhật chỉ mục FTS tự động từ trường plain-text content
    CREATE FUNCTION product_document_trigger() RETURNS trigger AS $$
    begin
      new.fts_document := to_tsvector('simple', coalesce(new.content, ''));
      return new;
    end
    $$ LANGUAGE plpgsql;
    
    CREATE TRIGGER tsvectorupdate BEFORE INSERT OR UPDATE
    ON product_documents FOR EACH ROW EXECUTE FUNCTION product_document_trigger();
    
    -- Tạo index hiệu năng cao GIN
    CREATE INDEX idx_product_docs_fts ON product_documents USING gin(fts_document);
    ```
