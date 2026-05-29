import { type Page } from 'playwright';
import { type ProductRaw } from '../types/product-raw.type.js';
export function validateProductRaw(product: ProductRaw): { isValid: boolean, reason?: string } {
  if (!product.basic.product_name || product.basic.product_name.trim() === '') {
    return { isValid: false, reason: 'MISSING_PRODUCT_NAME' };
  }

  const hasMarker = 
    !!product.basic.product_code ||
    !!product.medicine.registration_number ||
    !!product.medicine.package_specification ||
    !!product.ingredients.ingredients_text ||
    (product.pricing.available_price_units && product.pricing.available_price_units.length > 0) ||
    (product.media.image_urls && product.media.image_urls.length > 0 && !product.media.primary_image_url?.includes('default'));

  if (!hasMarker) {
    return { isValid: false, reason: 'MISSING_PRODUCT_MARKERS' };
  }

  return { isValid: true };
}

export interface ProductLinkRaw {
  category_code: string;
  category_name: string;
  category_url: string;
  product_name: string | null;
  product_url: string;
  image_url: string | null;
  price_text: string | null;
  collected_at: string;
}

export async function extractProductDetails(page: Page, linkRaw: ProductLinkRaw): Promise<any> {
  const collectedAt = new Date().toISOString();
  
  try {
    await page.waitForSelector('script#__NEXT_DATA__', { timeout: 10000 });
  } catch (e) {}

  const sourceName = process.env.SOURCE_NAME || "Nhà thuốc Long Châu";
  const sourceNote = process.env.SOURCE_NOTE || "Dữ liệu tham khảo phục vụ đồ án PharmaAssist";

  const details = await page.evaluate(({ linkRaw, collectedAt, sourceName, sourceNote }) => {
    (window as any).__name = (func: any) => func;
    
    // 1. Helper to extract Next Data
    function extractNextDataProduct() {
      const nextNode = document.getElementById('__NEXT_DATA__');
      if (!nextNode) return null;
      try {
        const data = JSON.parse(nextNode.textContent || '{}');
        const props = data?.props?.pageProps || {};
        return {
          product: props.product || {},
          content: props.content || {},
          breadcrumbs: props.breadcrumbs || [],
          initPromotionPrices: props.initPromotionPrices || [],
          seo: props.seo || {}
        };
      } catch (e) {
        return null;
      }
    }

    const nextData = extractNextDataProduct() || { product: {}, content: {}, breadcrumbs: [], initPromotionPrices: [], seo: {} };
    const { product, content, breadcrumbs, seo } = nextData;

    // --- Basic Info ---
    const productCode = product.sku || null;
    const h1Text = document.querySelector('h1')?.textContent || null;
    const productName = product.webName || h1Text || null;
    let shortDesc = product.shortDescription || null;
    if (shortDesc) {
        shortDesc = shortDesc.replace(/<[^>]*>?/gm, '').trim();
    }
    
    // --- Media ---
    const primaryImage = product.primaryImage || linkRaw.image_url || null;
    const imageUrls: string[] = [];
    if (primaryImage) imageUrls.push(primaryImage);
    if (Array.isArray(product.secondaryImages)) {
      product.secondaryImages.forEach((img: any) => {
         if (img && !imageUrls.includes(img)) imageUrls.push(img);
      });
    }

    // --- Breadcrumbs ---
    const bcItems = breadcrumbs.map((b: any) => b.name).filter((n: string) => n && n.toLowerCase() !== 'trang chủ');
    const mainCategoryName = bcItems[0] || null;
    const level2CategoryName = bcItems[1] || null;
    const level3CategoryName = bcItems[2] || null;
    const level4CategoryName = bcItems[3] || null;
    const breadcrumbText = bcItems.join(' > ');
    const categoryUrl = breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1].slug : linkRaw.category_url;

    // --- Medicine Info ---
    const isMedicinePath = linkRaw.product_url.includes('/thuoc/');
    const isMedicineCategory = bcItems.some((i: string) => i.toLowerCase() === 'thuốc');
    const isMedicine = isMedicinePath || isMedicineCategory;
    const productType = (linkRaw.product_url.includes('/thuoc/') || mainCategoryName === 'Thuốc') ? "MEDICINE" : null;
    
    const registrationNumber = product.registNum || null;
    const packageSpec = product.specification || null;
    let dosageForm = product.dosageForm || null;
    if (dosageForm) {
       if (dosageForm.length > 80 || dosageForm.toLowerCase().includes('các dạng thuốc')) {
           dosageForm = null;
       }
    }
    const isPrescription = !!product.prescription;
    const medicineType = isPrescription ? "PRESCRIPTION" : "OTC";
    const manufacturingCountry = product.manufactor || null;
    const manufacturer = product.producer || null;
    
    // --- Ingredients ---
    const ingredientUnitContext = product.ingredientFor || null;
    const ingredientsParsed: any[] = [];
    let ingredientsText = '';
    
    if (Array.isArray(product.ingredient)) {
       const parts: string[] = [];
       product.ingredient.forEach((ing: any) => {
          ingredientsParsed.push(ing);
          let p = ing.name || '';
          if (ing.shortDescription) {
             p += ` (${ing.shortDescription})`;
          }
          if (p) parts.push(p);
       });
       if (parts.length > 0) {
          ingredientsText = ingredientUnitContext ? `${ingredientUnitContext} chứa: ` : '';
          ingredientsText += parts.join(', ');
       }
    } else if (product.ingredient && typeof product.ingredient === 'string') {
       ingredientsText = product.ingredient;
    }

    // --- Content ---
    const indications = product.usage || content.usage || null;
    const dosageText = product.dosage || content.dosage || null;
    const sideEffects = product.adverseEffect || content.adverseEffect || null;
    const warningText = content.careful || null;
    const precautions = content.careful || null;
    const storageInstruction = content.preservation || null;
    const overviewContent = product.description || content.description || null;
    
    // --- Pricing ---
    const availablePriceUnits: any[] = [];
    let sellingPrice: number | null = null;
    let defaultUnit: string | null = null;
    let unitPriceText: string | null = null;

    const formatVND = (amount: number | null | undefined): string | null => {
        if (amount === null || amount === undefined) return null;
        return amount.toLocaleString('vi-VN') + 'đ';
    };

    if (Array.isArray(product.prices)) {
       product.prices.forEach((p: any) => {
          availablePriceUnits.push({
             unit_code: p.measureUnitCode,
             unit_name: p.measureUnitName,
             price: p.price,
             price_text: formatVND(p.price),
             currency_symbol: p.currencySymbol || 'đ',
             is_sell_default: p.isSellDefault,
             is_default: p.isDefault,
             level: p.level,
             product_specs: p.productSpecs
          });
       });
    }

    if (availablePriceUnits.length > 0) {
       let selectedPriceObj = availablePriceUnits.find(p => p.is_sell_default === true && typeof p.price === 'number');
       if (!selectedPriceObj) {
           selectedPriceObj = availablePriceUnits.find(p => p.is_default === true && typeof p.price === 'number');
       }
       if (!selectedPriceObj) {
           selectedPriceObj = availablePriceUnits.find(p => typeof p.price === 'number');
       }

       if (selectedPriceObj) {
           sellingPrice = selectedPriceObj.price;
           defaultUnit = selectedPriceObj.unit_name || null;
           unitPriceText = `${formatVND(sellingPrice)} / ${defaultUnit}`;
       }
    }

    let priceStatus: "AVAILABLE" | "CONTACT_REQUIRED" | "NOT_AVAILABLE" | "UNKNOWN" = "UNKNOWN";
    if (sellingPrice !== null) {
        priceStatus = "AVAILABLE";
    } else if (isPrescription) {
        priceStatus = "CONTACT_REQUIRED";
    } else if (availablePriceUnits.length > 0) {
        priceStatus = "CONTACT_REQUIRED";
    } else {
        priceStatus = "UNKNOWN";
    }

    // --- SEO ---
    const metaTitle = seo?.title || document.title;
    const metaDesc = seo?.description || null;
    const canonical = seo?.canonical || null;
    const ogImageSEO = seo?.images?.[0]?.url || null;

    return {
      source: {
        source_name: sourceName,
        source_url: linkRaw.product_url,
        source_category_url: linkRaw.category_url,
        collected_at: collectedAt,
        is_demo_data: true,
        source_note: sourceNote,
        crawl_version: "2.0",
        data_quality_status: "RAW"
      },
      category: {
        breadcrumb_text: breadcrumbText,
        breadcrumb_items: bcItems,
        main_category_name: mainCategoryName,
        level_2_category_name: level2CategoryName,
        level_3_category_name: level3CategoryName,
        level_4_category_name: level4CategoryName,
        category_path: breadcrumbText ? breadcrumbText : linkRaw.category_name,
        category_url: categoryUrl || linkRaw.category_url,
        category_slug: null
      },
      basic: {
        product_code: productCode,
        product_name: productName,
        product_slug: null,
        product_type: productType,
        short_description: shortDesc,
        brand_name: product.brand || null,
        brand_country_name: product.brandOrigin || manufacturingCountry || null,
        display_country_name: product.brandOrigin || manufacturingCountry || null,
        label_text: null,
        availability_text: null,
        product_status: null,
        rating_average: null,
        review_count: null,
        comment_count: null,
        reviews_collected: false,
        qna_collected: false
      },
      pricing: {
        price_status: priceStatus,
        selling_price: sellingPrice,
        selling_price_text: formatVND(sellingPrice),
        original_price: null,
        discount_amount: null,
        discount_percent: null,
        currency: 'VND',
        default_unit: defaultUnit,
        unit_price_text: unitPriceText,
        available_price_units: availablePriceUnits,
        unit_conversion_text: null,
        min_order_quantity: 1,
        max_order_quantity: null
      },
      media: {
        primary_image_url: primaryImage,
        image_urls: imageUrls,
        thumbnail_urls: [],
        image_alt_texts: [],
        image_count: imageUrls.length,
        product_video_url: null,
        image_source_note: null
      },
      medicine: {
        registration_number: registrationNumber,
        registration_lookup_url: null,
        package_specification: packageSpec,
        dosage_form_name: dosageForm,
        requires_prescription_text: isPrescription ? "Thuốc kê đơn" : "Không kê đơn",
        requires_prescription: isPrescription,
        manufacturer_name: manufacturer,
        manufacturer_address: null,
        manufacturing_country: manufacturingCountry,
        shelf_life_text: null,
        shelf_life_months: null,
        storage_instruction_short: storageInstruction,
        medicine_type: medicineType,
        is_medicine: isMedicine
      },
      ingredients: {
        ingredients_text: ingredientsText || null,
        ingredients_html: null,
        ingredient_unit_context: ingredientUnitContext,
        ingredient_table_available: false,
        ingredient_note: null,
        ingredients_parsed: ingredientsParsed
      },
      content: {
        overview_title: null,
        overview_content: overviewContent,
        description_html: null,
        description_text: null,
        
        uses_section_title: 'Công dụng / Chỉ định',
        indications: indications,
        therapeutic_uses: indications,
        pharmacodynamics: null,
        pharmacokinetics: null,
        atc_code: null,
        therapeutic_group: null,
        uses_html: null,
        uses_text: null,

        usage_instruction: dosageText,
        administration_route: null,
        dosage_text: dosageText,
        dosage_adult: null,
        dosage_children: null,
        dosage_elderly: null,
        dosage_frequency: null,
        dosage_duration: null,
        overdose_instruction: null,
        missed_dose_instruction: null,
        emergency_instruction: null,
        usage_html: null,
        usage_text: null,

        side_effects: sideEffects,
        side_effects_html: null,
        adverse_reactions: null,
        common_side_effects: null,
        rare_side_effects: null,
        serious_side_effects: null,
        side_effects_note: null,

        warning_intro: null,
        contraindications: null,
        precautions: precautions,
        pregnancy_lactation_note: null,
        driving_machine_note: null,
        drug_interaction_note: null,
        allergy_warning: null,
        special_population_note: null,
        general_warning_note: null,
        warning_html: null,
        warning_text: warningText,

        storage_instruction: storageInstruction,
        storage_temperature: null,
        storage_light_condition: null,
        storage_humidity_condition: null,
        storage_html: null,
        storage_text: null
      },
      content_reviewer: {
        content_reviewer_name: null,
        content_reviewer_title: null,
        content_reviewed_text: null,
        content_reviewed_at: null,
        content_source_references: null
      },
      seo: {
        meta_title: metaTitle,
        meta_description: metaDesc,
        canonical_url: canonical,
        og_title: null,
        og_description: null,
        og_image: ogImageSEO,
        structured_data_product: null,
        structured_data_breadcrumb: null
      },
      _raw_specs: null
    };
  }, { linkRaw, collectedAt, sourceName, sourceNote }) as any as ProductRaw;
  
  if (details) {
    const url = (linkRaw.product_url || '').toLowerCase();
    const categoryCode = (linkRaw.category_code || '').toUpperCase();
    const mainCategoryName = (details.category.main_category_name || '').toLowerCase();

    let finalProductType = 'OTHER';
    if (url.includes('/thuoc/')) {
      finalProductType = 'MEDICINE';
    } else if (url.includes('/thuc-pham-chuc-nang/')) {
      finalProductType = 'SUPPLEMENT';
    } else if (url.includes('/duoc-my-pham/')) {
      finalProductType = 'COSMETIC';
    } else if (url.includes('/cham-soc-ca-nhan/')) {
      finalProductType = 'PERSONAL_CARE';
    } else if (url.includes('/trang-thiet-bi-y-te/')) {
      finalProductType = 'DEVICE';
    } else {
      if (mainCategoryName.includes('thuốc') || categoryCode.startsWith('CAT_THUOC')) {
        finalProductType = 'MEDICINE';
      } else if (mainCategoryName.includes('thực phẩm chức năng') || mainCategoryName.includes('bảo vệ sức khỏe') || categoryCode.startsWith('CAT_TPCN')) {
        finalProductType = 'SUPPLEMENT';
      } else if (mainCategoryName.includes('mỹ phẩm') || mainCategoryName.includes('dược mỹ phẩm') || categoryCode.startsWith('CAT_DUOC_MY_PHAM')) {
        finalProductType = 'COSMETIC';
      } else if (mainCategoryName.includes('chăm sóc cá nhân') || categoryCode.startsWith('CAT_CHAM_SOC_CA_NHAN')) {
        finalProductType = 'PERSONAL_CARE';
      } else if (mainCategoryName.includes('thiết bị y tế') || mainCategoryName.includes('trang thiết bị') || categoryCode.startsWith('CAT_TBYT')) {
        finalProductType = 'DEVICE';
      }
    }

    details.basic.product_type = finalProductType;

    const isMedicine = finalProductType === 'MEDICINE';
    details.medicine.is_medicine = isMedicine;

    if (isMedicine) {
      if (details.medicine.requires_prescription === true) {
        details.medicine.medicine_type = 'PRESCRIPTION';
      } else if (details.medicine.requires_prescription === false) {
        details.medicine.medicine_type = 'OTC';
      } else {
        details.medicine.medicine_type = 'UNKNOWN';
      }
    } else {
      details.medicine.medicine_type = null;
    }
  }

  return details;
}

export async function crawlSingleProduct(page: Page, link: ProductLinkRaw): Promise<ProductRaw> {
  const response = await page.goto(link.product_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (response && response.status() >= 400) {
    throw new Error(`HTTP Error ${response.status()}`);
  }
  
  const currentUrl = page.url();
  if (!currentUrl.includes('/thuoc/') && !currentUrl.includes('.html')) {
     throw new Error('REDIRECTED_TO_NON_PRODUCT_PAGE');
  }

  const details = await extractProductDetails(page, link);
  
  const validation = validateProductRaw(details);
  if (!validation.isValid) {
     throw new Error(`INVALID_PRODUCT_PAGE (${validation.reason})`);
  }
  
  return details;
}
