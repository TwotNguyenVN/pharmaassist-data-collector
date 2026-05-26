export interface ProductRaw {
  source: {
    source_name: string;
    source_url: string;
    source_category_url: string | null;
    collected_at: string;
    is_demo_data: boolean;
    source_note: string | null;
    crawl_version: string;
    raw_html_file: string | null;
    data_quality_status: string | null;
  };

  category: {
    breadcrumb_text: string | null;
    breadcrumb_items: string[];
    main_category_name: string | null;
    level_2_category_name: string | null;
    level_3_category_name: string | null;
    level_4_category_name: string | null;
    category_path: string[];
    category_url: string | null;
    category_slug: string | null;
  };

  basic: {
    product_code: string | null;
    product_name: string;
    product_slug: string;
    product_type: string | null;
    short_description: string | null;
    brand_name: string | null;
    brand_country_name: string | null;
    display_country_name: string | null;
    label_text: string | null;
    availability_text: string | null;
    product_status: string | null;
    rating_average: number | null;
    review_count: number | null;
    comment_count: number | null;
    reviews_collected: any[];
    qna_collected: any[];
  };

  pricing: {
    price_status: "AVAILABLE" | "CONTACT_REQUIRED" | "NOT_AVAILABLE" | "UNKNOWN" | null;
    selling_price: number | null;
    selling_price_text: string | null;
    original_price: number | null;
    discount_amount: number | null;
    discount_percent: number | null;
    currency: string | null;
    default_unit: string | null;
    unit_price_text: string | null;
    available_price_units: any[];
    unit_conversion_text: string | null;
    min_order_quantity: number | null;
    max_order_quantity: number | null;
  };

  media: {
    primary_image_url: string | null;
    image_urls: string[];
    thumbnail_urls: string[];
    image_alt_texts: string[];
    image_count: number;
    product_video_url: string | null;
    image_source_note: string | null;
  };

  medicine: {
    registration_number: string | null;
    registration_lookup_url: string | null;
    package_specification: string | null;
    dosage_form_name: string | null;
    requires_prescription_text: string | null;
    requires_prescription: boolean;
    manufacturer_name: string | null;
    manufacturer_address: string | null;
    manufacturing_country: string | null;
    shelf_life_text: string | null;
    shelf_life_months: number | null;
    storage_instruction_short: string | null;
    medicine_type: string | null;
    is_medicine: boolean;
  };

  ingredients: {
    ingredients_text: string | null;
    ingredients_html: string | null;
    ingredient_unit_context: string | null;
    ingredient_table_available: boolean;
    ingredient_note: string | null;
    ingredients_parsed: any[];
  };

  content: {
    overview_title: string | null;
    overview_content: string | null;
    description_html: string | null;
    description_text: string | null;
    uses_section_title: string | null;
    indications: string | null;
    therapeutic_uses: string | null;
    pharmacodynamics: string | null;
    pharmacokinetics: string | null;
    atc_code: string | null;
    therapeutic_group: string | null;
    uses_html: string | null;
    uses_text: string | null;
    usage_instruction: string | null;
    administration_route: string | null;
    dosage_text: string | null;
    dosage_adult: string | null;
    dosage_children: string | null;
    dosage_elderly: string | null;
    dosage_frequency: string | null;
    dosage_duration: string | null;
    overdose_instruction: string | null;
    missed_dose_instruction: string | null;
    emergency_instruction: string | null;
    usage_html: string | null;
    usage_text: string | null;
    side_effects: string | null;
    side_effects_html: string | null;
    adverse_reactions: string | null;
    common_side_effects: string | null;
    rare_side_effects: string | null;
    serious_side_effects: string | null;
    side_effects_note: string | null;
    warning_intro: string | null;
    contraindications: string | null;
    precautions: string | null;
    pregnancy_lactation_note: string | null;
    driving_machine_note: string | null;
    drug_interaction_note: string | null;
    allergy_warning: string | null;
    special_population_note: string | null;
    general_warning_note: string | null;
    warning_html: string | null;
    warning_text: string | null;
    storage_instruction: string | null;
    storage_temperature: string | null;
    storage_light_condition: string | null;
    storage_humidity_condition: string | null;
    storage_html: string | null;
    storage_text: string | null;
  };

  content_reviewer: {
    content_reviewer_name: string | null;
    content_reviewer_title: string | null;
    content_reviewed_text: string | null;
    content_reviewed_at: string | null;
    content_source_references: string | null;
  };

  seo: {
    meta_title: string | null;
    meta_description: string | null;
    canonical_url: string | null;
    og_title: string | null;
    og_description: string | null;
    og_image: string | null;
    structured_data_product: any | null;
    structured_data_breadcrumb: any | null;
  };
}
