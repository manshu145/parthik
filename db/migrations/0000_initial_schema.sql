CREATE TYPE "public"."address_type" AS ENUM('HOME', 'WORK', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."assignment_response" AS ENUM('ACCEPTED', 'DECLINED', 'TIMEOUT', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'STATUS_CHANGE', 'APPROVE', 'REJECT', 'REFUND', 'ASSIGN', 'EXPORT', 'SETTING_CHANGE', 'CASH_DEPOSIT_VERIFY', 'PII_REVEAL');--> statement-breakpoint
CREATE TYPE "public"."auth_method" AS ENUM('PHONE_OTP', 'EMAIL_PASSWORD', 'EMAIL_OTP');--> statement-breakpoint
CREATE TYPE "public"."banner_placement" AS ENUM('HOME_HERO', 'HOME_STRIP', 'CATEGORY', 'OFFERS');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('DRAFT', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."campaign_type" AS ENUM('NOTIFICATION', 'COUPON_DROP', 'BANNER');--> statement-breakpoint
CREATE TYPE "public"."cancellation_actor_role" AS ENUM('CUSTOMER', 'VENDOR', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."cash_deposit_method" AS ENUM('BANK_TRANSFER', 'OFFICE_CASH', 'UPI');--> statement-breakpoint
CREATE TYPE "public"."cash_deposit_status" AS ENUM('DECLARED', 'VERIFIED', 'REJECTED', 'PARTIAL');--> statement-breakpoint
CREATE TYPE "public"."cash_entry_type" AS ENUM('COLLECTION', 'DEPOSIT', 'ADJUSTMENT', 'WRITE_OFF');--> statement-breakpoint
CREATE TYPE "public"."cms_page_type" AS ENUM('LEGAL', 'INFO', 'LANDING');--> statement-breakpoint
CREATE TYPE "public"."cod_collection_method" AS ENUM('CASH');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."coupon_restriction_type" AS ENUM('CATEGORY', 'PRODUCT', 'VENDOR', 'ZONE', 'USER');--> statement-breakpoint
CREATE TYPE "public"."coupon_type" AS ENUM('FLAT', 'PERCENTAGE', 'FREE_DELIVERY');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('PENDING_ASSIGNMENT', 'OFFERED', 'ASSIGNED', 'EN_ROUTE_TO_STORE', 'AT_STORE', 'PICKED_UP', 'EN_ROUTE_TO_CUSTOMER', 'AT_CUSTOMER', 'DELIVERED', 'FAILED', 'CANCELLED', 'RETURNED_TO_STORE');--> statement-breakpoint
CREATE TYPE "public"."discount_scope" AS ENUM('CART', 'CATEGORY', 'PRODUCT', 'VENDOR', 'DELIVERY');--> statement-breakpoint
CREATE TYPE "public"."dispatch_mode" AS ENUM('AUTO_NEAREST', 'BROADCAST', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."driver_availability" AS ENUM('OFFLINE', 'ONLINE', 'ON_DELIVERY', 'ON_BREAK');--> statement-breakpoint
CREATE TYPE "public"."driver_doc_type" AS ENUM('DL', 'AADHAAR', 'PAN', 'RC', 'INSURANCE', 'POLICE_VERIFICATION', 'PHOTO');--> statement-breakpoint
CREATE TYPE "public"."driver_status" AS ENUM('APPLIED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."earning_type" AS ENUM('DELIVERY_FEE', 'INCENTIVE', 'TIP', 'ADJUSTMENT', 'PENALTY');--> statement-breakpoint
CREATE TYPE "public"."inventory_reference_type" AS ENUM('ORDER', 'MANUAL', 'IMPORT', 'RETURN');--> statement-breakpoint
CREATE TYPE "public"."inventory_txn_type" AS ENUM('PURCHASE', 'SALE', 'RESERVE', 'RELEASE', 'ADJUSTMENT', 'RETURN', 'DAMAGE', 'CANCELLATION');--> statement-breakpoint
CREATE TYPE "public"."kyc_status" AS ENUM('NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."locale_code" AS ENUM('en', 'hi');--> statement-breakpoint
CREATE TYPE "public"."notification_category" AS ENUM('ORDER', 'PROMOTION', 'ACCOUNT', 'SUPPORT');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('PUSH', 'IN_APP', 'EMAIL', 'SMS', 'WHATSAPP');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'READ');--> statement-breakpoint
CREATE TYPE "public"."order_source" AS ENUM('WEB', 'PWA', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('PENDING_PAYMENT', 'CONFIRMED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'PAYMENT_FAILED', 'REFUNDED', 'RETURNED', 'FAILED_DELIVERY');--> statement-breakpoint
CREATE TYPE "public"."otp_purpose" AS ENUM('LOGIN', 'SIGNUP', 'PHONE_VERIFY', 'EMAIL_VERIFY', 'ORDER_DELIVERY', 'PASSWORD_RESET');--> statement-breakpoint
CREATE TYPE "public"."payee_type" AS ENUM('VENDOR', 'DRIVER');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('UPI', 'CARD', 'COD', 'NETBANKING', 'WALLET');--> statement-breakpoint
CREATE TYPE "public"."payment_method_scope" AS ENUM('ALL', 'PREPAID', 'COD');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('CREATED', 'PENDING', 'AUTHORIZED', 'PAID', 'FAILED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('DRAFT', 'APPROVED', 'PAID', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'INACTIVE', 'REJECTED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."promotion_type" AS ENUM('BUY_X_GET_Y', 'CATEGORY_DISCOUNT', 'VENDOR_CAMPAIGN', 'FLASH_SALE', 'FREE_DELIVERY', 'NEW_CUSTOMER');--> statement-breakpoint
CREATE TYPE "public"."proof_type" AS ENUM('OTP', 'PHOTO', 'SIGNATURE', 'CUSTOMER_CONFIRMATION');--> statement-breakpoint
CREATE TYPE "public"."push_permission" AS ENUM('GRANTED', 'DENIED', 'DEFAULT');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('INITIATED', 'PROCESSING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."refund_type" AS ENUM('FULL', 'PARTIAL');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'HIDDEN');--> statement-breakpoint
CREATE TYPE "public"."role_key" AS ENUM('CUSTOMER', 'VENDOR_OWNER', 'VENDOR_STAFF', 'DRIVER', 'ADMIN', 'ADMIN_SUPPORT', 'ADMIN_OPS', 'ADMIN_FINANCE', 'SUPER_ADMIN');--> statement-breakpoint
CREATE TYPE "public"."role_scope_type" AS ENUM('GLOBAL', 'VENDOR', 'STORE');--> statement-breakpoint
CREATE TYPE "public"."seller_type" AS ENUM('PLATFORM', 'VENDOR');--> statement-breakpoint
CREATE TYPE "public"."store_status" AS ENUM('OPEN', 'CLOSED', 'TEMPORARILY_CLOSED', 'OFFLINE_BY_ADMIN');--> statement-breakpoint
CREATE TYPE "public"."system_event_severity" AS ENUM('INFO', 'WARNING', 'ERROR', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."target_audience" AS ENUM('ALL', 'NEW_USERS', 'RETURNING', 'SEGMENT');--> statement-breakpoint
CREATE TYPE "public"."ticket_category" AS ENUM('PAYMENT', 'DELIVERY', 'PRODUCT', 'REFUND', 'COUPON', 'ACCOUNT', 'VENDOR', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."ticket_priority" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('PENDING', 'ACTIVE', 'SUSPENDED', 'BANNED', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."vehicle_type" AS ENUM('BIKE', 'SCOOTER', 'BICYCLE', 'CAR', 'VAN');--> statement-breakpoint
CREATE TYPE "public"."vendor_doc_type" AS ENUM('GST', 'PAN', 'FSSAI', 'SHOP_LICENSE', 'ADDRESS_PROOF', 'CANCELLED_CHEQUE');--> statement-breakpoint
CREATE TYPE "public"."vendor_status" AS ENUM('APPLIED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."webhook_direction" AS ENUM('INBOUND', 'OUTBOUND');--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_fingerprint" text,
	"platform" text,
	"fcm_token" text,
	"fcm_token_updated_at" timestamp with time zone,
	"push_permission" "push_permission" DEFAULT 'DEFAULT' NOT NULL,
	"last_active_at" timestamp with time zone,
	"is_trusted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"identifier" text,
	"identifier_type" text,
	"ip_hash" text,
	"success" boolean NOT NULL,
	"failure_reason" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_verifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid,
	"destination" text NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"purpose" "otp_purpose" NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"resource" text NOT NULL,
	"action" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" "role_key" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"active_role_id" uuid,
	"device_id" uuid,
	"firebase_token_issued_at" timestamp with time zone,
	"ip_hash" text,
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"scope_type" "role_scope_type" DEFAULT 'GLOBAL' NOT NULL,
	"scope_id" uuid,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"firebase_uid" text NOT NULL,
	"phone" text,
	"phone_verified_at" timestamp with time zone,
	"email" text,
	"email_verified_at" timestamp with time zone,
	"full_name" text,
	"preferred_locale" "locale_code" DEFAULT 'en' NOT NULL,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"anonymized_at" timestamp with time zone,
	CONSTRAINT "users_contact_present" CHECK ("users"."phone" is not null or "users"."email" is not null)
);
--> statement-breakpoint
CREATE TABLE "delivery_zones" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"center_latitude" numeric(9, 6),
	"center_longitude" numeric(9, 6),
	"radius_km" integer,
	"base_delivery_fee_paise" bigint DEFAULT 0 NOT NULL,
	"free_delivery_threshold_paise" bigint,
	"min_order_paise" bigint DEFAULT 0 NOT NULL,
	"per_km_fee_paise" bigint,
	"max_delivery_fee_paise" bigint,
	"avg_delivery_minutes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zone_pincodes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"delivery_zone_id" uuid NOT NULL,
	"pincode" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blog_posts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"cover_image_key" text,
	"author_user_id" uuid,
	"category" text,
	"tags" jsonb,
	"status" "content_status" DEFAULT 'DRAFT' NOT NULL,
	"seo_meta_id" uuid,
	"published_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cancellation_reasons" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"display_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_pages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"page_type" "cms_page_type" DEFAULT 'INFO' NOT NULL,
	"status" "content_status" DEFAULT 'DRAFT' NOT NULL,
	"seo_meta_id" uuid,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "faqs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"category" text,
	"display_order" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "home_layouts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"sections" jsonb NOT NULL,
	"delivery_zone_id" uuid,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redirects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"source_path" text NOT NULL,
	"target_path" text NOT NULL,
	"status_code" smallint DEFAULT 301 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"last_hit_at" timestamp with time zone,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_meta" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"canonical_url" text,
	"og_image_key" text,
	"twitter_card" text,
	"schema_type" text,
	"robots_index" boolean DEFAULT true NOT NULL,
	"robots_follow" boolean DEFAULT true NOT NULL,
	"include_in_sitemap" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supported_locales" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" "locale_code" NOT NULL,
	"name" text NOT NULL,
	"native_name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"display_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_delivery_zones" (
	"store_id" uuid NOT NULL,
	"delivery_zone_id" uuid NOT NULL,
	CONSTRAINT "store_delivery_zones_store_id_delivery_zone_id_pk" PRIMARY KEY("store_id","delivery_zone_id")
);
--> statement-breakpoint
CREATE TABLE "store_hours" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"store_id" uuid NOT NULL,
	"day_of_week" smallint NOT NULL,
	"opens_at" time,
	"closes_at" time,
	"is_closed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_hours_day_range" CHECK ("store_hours"."day_of_week" between 0 and 6)
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "store_status" DEFAULT 'CLOSED' NOT NULL,
	"description" text,
	"logo_key" text,
	"banner_key" text,
	"line1" text,
	"line2" text,
	"city" text,
	"state" text,
	"pincode" text,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"delivery_radius_km" integer,
	"cod_enabled" boolean DEFAULT true NOT NULL,
	"min_order_paise" bigint DEFAULT 0 NOT NULL,
	"avg_prep_time_minutes" integer,
	"rating_avg" numeric(5, 2),
	"rating_count" integer DEFAULT 0 NOT NULL,
	"is_accepting_orders" boolean DEFAULT false NOT NULL,
	"closed_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vendor_bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"account_holder_name" text NOT NULL,
	"account_number_encrypted" text NOT NULL,
	"account_number_last4" text NOT NULL,
	"ifsc" text NOT NULL,
	"bank_name" text,
	"is_verified" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vendor_documents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"doc_type" "vendor_doc_type" NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text,
	"mime_type" text,
	"size_bytes" integer,
	"kyc_status" "kyc_status" DEFAULT 'PENDING' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"designation" text,
	"invited_by" uuid,
	"invited_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"business_name" text NOT NULL,
	"legal_name" text,
	"slug" text NOT NULL,
	"status" "vendor_status" DEFAULT 'APPLIED' NOT NULL,
	"gstin" text,
	"pan" text,
	"fssai_license" text,
	"contact_phone" text,
	"contact_email" text,
	"commission_rate" numeric(5, 2),
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"rejection_reason" text,
	"suspended_at" timestamp with time zone,
	"suspension_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"logo_key" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"parent_id" uuid,
	"slug" text NOT NULL,
	"icon_key" text,
	"image_key" text,
	"display_order" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"seo_meta_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"storage_key" text NOT NULL,
	"alt_text" text NOT NULL,
	"display_order" smallint DEFAULT 0 NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text,
	"mrp_paise" bigint DEFAULT 0 NOT NULL,
	"price_paise" bigint DEFAULT 0 NOT NULL,
	"unit_label" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"display_order" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "product_variants_price_lte_mrp" CHECK ("product_variants"."price_paise" <= "product_variants"."mrp_paise")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"brand_id" uuid,
	"slug" text NOT NULL,
	"status" "product_status" DEFAULT 'DRAFT' NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"is_popular" boolean DEFAULT false NOT NULL,
	"unit_label" text,
	"hsn_code" text,
	"tax_rate" numeric(5, 2),
	"is_tax_inclusive" boolean DEFAULT true NOT NULL,
	"mrp_paise" bigint DEFAULT 0 NOT NULL,
	"price_paise" bigint DEFAULT 0 NOT NULL,
	"cost_paise" bigint,
	"rating_avg" numeric(5, 2),
	"rating_count" integer DEFAULT 0 NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"sold_count" integer DEFAULT 0 NOT NULL,
	"seo_meta_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "products_price_lte_mrp" CHECK ("products"."price_paise" <= "products"."mrp_paise"),
	CONSTRAINT "products_prices_non_negative" CHECK ("products"."price_paise" >= 0 and "products"."mrp_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"variant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"quantity_available" integer DEFAULT 0 NOT NULL,
	"quantity_reserved" integer DEFAULT 0 NOT NULL,
	"low_stock_threshold" integer DEFAULT 0 NOT NULL,
	"track_inventory" boolean DEFAULT true NOT NULL,
	"allow_backorder" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "inventory_available_non_negative" CHECK ("inventory"."quantity_available" >= 0),
	CONSTRAINT "inventory_reserved_non_negative" CHECK ("inventory"."quantity_reserved" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_transactions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"variant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"txn_type" "inventory_txn_type" NOT NULL,
	"quantity_delta" integer NOT NULL,
	"quantity_after" integer NOT NULL,
	"reference_type" "inventory_reference_type" NOT NULL,
	"reference_id" uuid,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "addresses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text,
	"address_type" "address_type" DEFAULT 'HOME' NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_phone" text NOT NULL,
	"line1" text NOT NULL,
	"line2" text,
	"landmark" text,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"pincode" text NOT NULL,
	"country" text DEFAULT 'IN' NOT NULL,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"delivery_zone_id" uuid,
	"is_default" boolean DEFAULT false NOT NULL,
	"delivery_instructions" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "customer_notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"category" "notification_category" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_profiles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"date_of_birth" date,
	"gender" text,
	"default_address_id" uuid,
	"referral_code" text,
	"acquisition_source" text,
	"total_orders" integer DEFAULT 0 NOT NULL,
	"lifetime_value_paise" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wishlist_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"wishlist_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wishlist_items_unique_key" UNIQUE NULLS NOT DISTINCT("wishlist_id","product_id","variant_id")
);
--> statement-breakpoint
CREATE TABLE "wishlists" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text DEFAULT 'Favorites' NOT NULL,
	"is_default" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "banners" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"placement" "banner_placement" NOT NULL,
	"link_url" text,
	"target_audience" "target_audience" DEFAULT 'ALL' NOT NULL,
	"segment_id" uuid,
	"delivery_zone_id" uuid,
	"priority" smallint DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"click_count" integer DEFAULT 0 NOT NULL,
	"impression_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cancellation_policies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"actor_role" "cancellation_actor_role" NOT NULL,
	"from_status" "order_status" NOT NULL,
	"is_allowed" boolean DEFAULT false NOT NULL,
	"window_minutes" integer,
	"refund_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"refund_delivery_fee" boolean DEFAULT false NOT NULL,
	"requires_reason" boolean DEFAULT true NOT NULL,
	"restock" boolean DEFAULT true NOT NULL,
	"compensate_driver" boolean DEFAULT false NOT NULL,
	"payment_method_scope" "payment_method_scope" DEFAULT 'ALL' NOT NULL,
	"priority" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupon_restrictions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"coupon_id" uuid NOT NULL,
	"restriction_type" "coupon_restriction_type" NOT NULL,
	"restriction_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"coupon_type" "coupon_type" NOT NULL,
	"discount_value" bigint DEFAULT 0 NOT NULL,
	"max_discount_paise" bigint,
	"min_cart_paise" bigint DEFAULT 0 NOT NULL,
	"scope" "discount_scope" DEFAULT 'CART' NOT NULL,
	"first_order_only" boolean DEFAULT false NOT NULL,
	"is_user_specific" boolean DEFAULT false NOT NULL,
	"usage_limit_total" integer,
	"usage_limit_per_user" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_stackable" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "promotion_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"promotion_id" uuid NOT NULL,
	"rule_key" text NOT NULL,
	"rule_value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"promotion_type" "promotion_type" NOT NULL,
	"description" text,
	"banner_id" uuid,
	"priority" smallint DEFAULT 0 NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"zone_scope" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cart_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"cart_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_paise_snapshot" bigint DEFAULT 0 NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_items_quantity_positive" CHECK ("cart_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "carts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid,
	"guest_token" text,
	"store_id" uuid,
	"delivery_zone_id" uuid,
	"address_id" uuid,
	"applied_coupon_id" uuid,
	"currency" text DEFAULT 'INR' NOT NULL,
	"last_priced_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carts_owner_present" CHECK ("carts"."user_id" is not null or "carts"."guest_token" is not null)
);
--> statement-breakpoint
CREATE TABLE "coupon_usages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"coupon_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"discount_applied_paise" bigint DEFAULT 0 NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"variant_id" uuid,
	"product_name_snapshot" text NOT NULL,
	"variant_label_snapshot" text,
	"image_key_snapshot" text,
	"unit_label_snapshot" text,
	"hsn_snapshot" text,
	"sku_snapshot" text,
	"quantity" integer NOT NULL,
	"mrp_paise" bigint DEFAULT 0 NOT NULL,
	"unit_price_paise" bigint DEFAULT 0 NOT NULL,
	"item_discount_paise" bigint DEFAULT 0 NOT NULL,
	"tax_rate" numeric(5, 2),
	"tax_amount_paise" bigint DEFAULT 0 NOT NULL,
	"line_total_paise" bigint DEFAULT 0 NOT NULL,
	"vendor_payout_paise" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_quantity_positive" CHECK ("order_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "order_status_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" "order_status",
	"to_status" "order_status" NOT NULL,
	"changed_by_user_id" uuid,
	"changed_by_role" text,
	"reason" text,
	"note" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_number" text NOT NULL,
	"user_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"status" "order_status" NOT NULL,
	"delivery_address_snapshot" jsonb NOT NULL,
	"contact_phone" text NOT NULL,
	"contact_name" text NOT NULL,
	"delivery_zone_id" uuid,
	"gross_amount_paise" bigint DEFAULT 0 NOT NULL,
	"item_discount_paise" bigint DEFAULT 0 NOT NULL,
	"coupon_id" uuid,
	"coupon_code_snapshot" text,
	"coupon_discount_paise" bigint DEFAULT 0 NOT NULL,
	"taxable_amount_paise" bigint DEFAULT 0 NOT NULL,
	"tax_amount_paise" bigint DEFAULT 0 NOT NULL,
	"delivery_fee_paise" bigint DEFAULT 0 NOT NULL,
	"packaging_fee_paise" bigint DEFAULT 0 NOT NULL,
	"service_fee_paise" bigint DEFAULT 0 NOT NULL,
	"total_amount_paise" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"payment_status" "payment_status" NOT NULL,
	"is_cod" boolean DEFAULT false NOT NULL,
	"cod_amount_paise" bigint,
	"placed_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"cancelled_by_role" text,
	"estimated_delivery_at" timestamp with time zone,
	"actual_delivery_minutes" integer,
	"customer_note" text,
	"internal_note" text,
	"idempotency_key" text NOT NULL,
	"source" "order_source" DEFAULT 'WEB' NOT NULL,
	"vendor_payout_paise" bigint,
	"platform_commission_paise" bigint,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_total_non_negative" CHECK ("orders"."total_amount_paise" >= 0),
	CONSTRAINT "orders_cod_amount_consistent" CHECK (("orders"."is_cod" = false and "orders"."cod_amount_paise" is null)
          or ("orders"."is_cod" = true and "orders"."cod_amount_paise" is not null))
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"invoice_date" date NOT NULL,
	"seller_type" "seller_type" NOT NULL,
	"seller_name" text,
	"seller_gstin" text,
	"buyer_name" text,
	"buyer_state" text,
	"taxable_amount_paise" bigint DEFAULT 0 NOT NULL,
	"tax_breakup" jsonb,
	"total_amount_paise" bigint DEFAULT 0 NOT NULL,
	"pdf_storage_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"payment_id" uuid,
	"provider" text NOT NULL,
	"event_type" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"signature" text,
	"signature_valid" boolean NOT NULL,
	"processed_at" timestamp with time zone,
	"processing_error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_payment_id" text,
	"provider_order_id" text,
	"method" "payment_method" NOT NULL,
	"amount_paise" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" "payment_status" NOT NULL,
	"idempotency_key" text NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"authorized_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"reconciled_at" timestamp with time zone,
	"reconciliation_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_batches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"payee_type" "payee_type" NOT NULL,
	"payee_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"gross_amount_paise" bigint DEFAULT 0 NOT NULL,
	"deductions_paise" bigint DEFAULT 0 NOT NULL,
	"net_amount_paise" bigint DEFAULT 0 NOT NULL,
	"status" "payout_status" DEFAULT 'DRAFT' NOT NULL,
	"reference_number" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_id" uuid,
	"provider_refund_id" text,
	"amount_paise" bigint DEFAULT 0 NOT NULL,
	"reason" text,
	"refund_type" "refund_type" NOT NULL,
	"status" "refund_status" DEFAULT 'INITIATED' NOT NULL,
	"initiated_by" uuid,
	"approved_by" uuid,
	"initiated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"failure_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_rates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"hsn_code" text,
	"rate" numeric(5, 2) NOT NULL,
	"cess_rate" numeric(5, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_deposits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"driver_id" uuid NOT NULL,
	"deposit_reference" text NOT NULL,
	"declared_amount_paise" bigint DEFAULT 0 NOT NULL,
	"verified_amount_paise" bigint,
	"variance_paise" bigint,
	"method" "cash_deposit_method" NOT NULL,
	"proof_storage_key" text,
	"status" "cash_deposit_status" DEFAULT 'DECLARED' NOT NULL,
	"declared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"rejection_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_deposits_declared_positive" CHECK ("cash_deposits"."declared_amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"driver_id" uuid,
	"status" "delivery_status" DEFAULT 'PENDING_ASSIGNMENT' NOT NULL,
	"delivery_zone_id" uuid,
	"pickup_address_snapshot" jsonb NOT NULL,
	"drop_address_snapshot" jsonb NOT NULL,
	"distance_km" numeric(6, 2),
	"delivery_fee_paise" bigint DEFAULT 0 NOT NULL,
	"driver_payout_paise" bigint,
	"delivery_otp_hash" text NOT NULL,
	"otp_verified_at" timestamp with time zone,
	"otp_attempts" integer DEFAULT 0 NOT NULL,
	"otp_regenerated_count" integer DEFAULT 0 NOT NULL,
	"assigned_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"reached_store_at" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	"reached_customer_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_reason" text,
	"cod_expected_paise" bigint,
	"cod_collected_paise" bigint,
	"cod_collection_method" "cod_collection_method",
	"cod_collected_at" timestamp with time zone,
	"cod_variance_paise" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_assignments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"offered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"response" "assignment_response",
	"decline_reason" text,
	"offer_expires_at" timestamp with time zone,
	"assigned_by" uuid,
	"attempt_number" smallint DEFAULT 1 NOT NULL,
	"dispatch_mode" "dispatch_mode" DEFAULT 'AUTO_NEAREST' NOT NULL,
	"distance_at_offer_km" numeric(6, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_proofs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"proof_type" "proof_type" NOT NULL,
	"storage_key" text,
	"otp_verified" boolean DEFAULT false NOT NULL,
	"recipient_name" text,
	"notes" text,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"captured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_status_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"from_status" "delivery_status",
	"to_status" "delivery_status" NOT NULL,
	"changed_by_user_id" uuid,
	"changed_by_role" text,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_cash_ledger" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"driver_id" uuid NOT NULL,
	"entry_type" "cash_entry_type" NOT NULL,
	"amount_paise" bigint DEFAULT 0 NOT NULL,
	"delivery_id" uuid,
	"order_id" uuid,
	"cash_deposit_id" uuid,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_documents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"driver_id" uuid NOT NULL,
	"doc_type" "driver_doc_type" NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text,
	"mime_type" text,
	"size_bytes" integer,
	"document_number_encrypted" text,
	"kyc_status" "kyc_status" DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_earnings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"driver_id" uuid NOT NULL,
	"delivery_id" uuid,
	"earning_type" "earning_type" NOT NULL,
	"amount_paise" bigint DEFAULT 0 NOT NULL,
	"description" text,
	"earned_on" date NOT NULL,
	"payout_batch_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"driver_id" uuid NOT NULL,
	"vehicle_type" "vehicle_type" NOT NULL,
	"registration_number" text,
	"make_model" text,
	"insurance_expiry" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_zones" (
	"driver_id" uuid NOT NULL,
	"delivery_zone_id" uuid NOT NULL,
	CONSTRAINT "driver_zones_driver_id_delivery_zone_id_pk" PRIMARY KEY("driver_id","delivery_zone_id")
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"driver_code" text NOT NULL,
	"status" "driver_status" DEFAULT 'APPLIED' NOT NULL,
	"availability" "driver_availability" DEFAULT 'OFFLINE' NOT NULL,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"date_of_birth" date,
	"emergency_contact" text,
	"rating_avg" numeric(5, 2),
	"rating_count" integer DEFAULT 0 NOT NULL,
	"total_deliveries" integer DEFAULT 0 NOT NULL,
	"successful_deliveries" integer DEFAULT 0 NOT NULL,
	"current_latitude" numeric(9, 6),
	"current_longitude" numeric(9, 6),
	"location_updated_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"rejection_reason" text,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"campaign_type" "campaign_type" NOT NULL,
	"audience_filter" jsonb,
	"coupon_id" uuid,
	"template_id" uuid,
	"channel" "notification_channel" NOT NULL,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"status" "campaign_status" DEFAULT 'DRAFT' NOT NULL,
	"target_count" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"event_key" text NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"locale" "locale_code" NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"variables" jsonb,
	"provider_template_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"template_id" uuid,
	"title" text,
	"body" text NOT NULL,
	"data" jsonb,
	"status" "notification_status" DEFAULT 'QUEUED' NOT NULL,
	"provider_message_id" text,
	"provider_response" text,
	"failure_reason" text,
	"order_id" uuid,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"store_id" uuid,
	"driver_id" uuid,
	"rating" smallint NOT NULL,
	"title" text,
	"comment" text,
	"status" "review_status" DEFAULT 'PENDING' NOT NULL,
	"moderated_by" uuid,
	"moderated_at" timestamp with time zone,
	"rejection_reason" text,
	"is_verified_purchase" boolean DEFAULT true NOT NULL,
	"helpful_count" integer DEFAULT 0 NOT NULL,
	"vendor_reply" text,
	"vendor_replied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "reviews_user_order_product_key" UNIQUE NULLS NOT DISTINCT("user_id","order_id","product_id"),
	CONSTRAINT "reviews_rating_range" CHECK ("reviews"."rating" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"ticket_number" text NOT NULL,
	"user_id" uuid NOT NULL,
	"order_id" uuid,
	"category" "ticket_category" NOT NULL,
	"subject" text NOT NULL,
	"status" "ticket_status" DEFAULT 'OPEN' NOT NULL,
	"priority" "ticket_priority" DEFAULT 'MEDIUM' NOT NULL,
	"assigned_to_user_id" uuid,
	"sla_due_at" timestamp with time zone,
	"first_response_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_user_id" uuid,
	"author_role" text,
	"message" text NOT NULL,
	"is_internal_note" boolean DEFAULT false NOT NULL,
	"attachment_keys" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "banner_translations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"banner_id" uuid NOT NULL,
	"locale" "locale_code" NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"cta_label" text,
	"image_key" text,
	"mobile_image_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "blog_post_translations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"blog_post_id" uuid NOT NULL,
	"locale" "locale_code" NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"content" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "brand_translations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"brand_id" uuid NOT NULL,
	"locale" "locale_code" NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "cancellation_reason_translations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"reason_id" uuid NOT NULL,
	"locale" "locale_code" NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "category_translations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"category_id" uuid NOT NULL,
	"locale" "locale_code" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "cms_page_translations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"cms_page_id" uuid NOT NULL,
	"locale" "locale_code" NOT NULL,
	"title" text NOT NULL,
	"content" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "coupon_translations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"coupon_id" uuid NOT NULL,
	"locale" "locale_code" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "faq_translations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"faq_id" uuid NOT NULL,
	"locale" "locale_code" NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "product_translations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"product_id" uuid NOT NULL,
	"locale" "locale_code" NOT NULL,
	"name" text NOT NULL,
	"short_description" text,
	"description" text,
	"specifications" jsonb,
	"unit_label" text,
	"search_vector_english" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(name, '') || ' ' || coalesce(short_description, ''))) STORED,
	"search_vector_simple" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(short_description, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "product_variant_translations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"variant_id" uuid NOT NULL,
	"locale" "locale_code" NOT NULL,
	"name" text NOT NULL,
	"variant_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "seo_meta_translations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"seo_meta_id" uuid NOT NULL,
	"locale" "locale_code" NOT NULL,
	"meta_title" text,
	"meta_description" text,
	"og_title" text,
	"og_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "admin_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"value_type" text NOT NULL,
	"group_name" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"is_sensitive" boolean DEFAULT false NOT NULL,
	"required_permission" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"actor_user_id" uuid,
	"actor_role" text,
	"actor_ip_hash" text,
	"actor_user_agent" text,
	"action" "audit_action" NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"changed_fields" jsonb,
	"reason" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"description" text,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"rollout_percentage" smallint DEFAULT 0 NOT NULL,
	"enabled_for_roles" jsonb,
	"enabled_for_zones" jsonb,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"scope" text NOT NULL,
	"user_id" uuid,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"locked_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"event_type" text NOT NULL,
	"severity" "system_event_severity" DEFAULT 'INFO' NOT NULL,
	"source" text,
	"message" text NOT NULL,
	"context" jsonb,
	"request_id" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_logs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"direction" "webhook_direction" NOT NULL,
	"provider" text NOT NULL,
	"endpoint" text,
	"event_type" text,
	"http_status" integer,
	"raw_headers" jsonb,
	"raw_body" text,
	"signature_valid" boolean,
	"attempt" smallint DEFAULT 1 NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_verifications" ADD CONSTRAINT "otp_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_role_id_roles_id_fk" FOREIGN KEY ("active_role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_pincodes" ADD CONSTRAINT "zone_pincodes_delivery_zone_id_delivery_zones_id_fk" FOREIGN KEY ("delivery_zone_id") REFERENCES "public"."delivery_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_seo_meta_id_seo_meta_id_fk" FOREIGN KEY ("seo_meta_id") REFERENCES "public"."seo_meta"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_pages" ADD CONSTRAINT "cms_pages_seo_meta_id_seo_meta_id_fk" FOREIGN KEY ("seo_meta_id") REFERENCES "public"."seo_meta"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_pages" ADD CONSTRAINT "cms_pages_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home_layouts" ADD CONSTRAINT "home_layouts_delivery_zone_id_delivery_zones_id_fk" FOREIGN KEY ("delivery_zone_id") REFERENCES "public"."delivery_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home_layouts" ADD CONSTRAINT "home_layouts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redirects" ADD CONSTRAINT "redirects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_delivery_zones" ADD CONSTRAINT "store_delivery_zones_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_delivery_zones" ADD CONSTRAINT "store_delivery_zones_delivery_zone_id_delivery_zones_id_fk" FOREIGN KEY ("delivery_zone_id") REFERENCES "public"."delivery_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_hours" ADD CONSTRAINT "store_hours_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_bank_accounts" ADD CONSTRAINT "vendor_bank_accounts_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_documents" ADD CONSTRAINT "vendor_documents_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_documents" ADD CONSTRAINT "vendor_documents_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_users" ADD CONSTRAINT "vendor_users_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_users" ADD CONSTRAINT "vendor_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_users" ADD CONSTRAINT "vendor_users_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_seo_meta_id_seo_meta_id_fk" FOREIGN KEY ("seo_meta_id") REFERENCES "public"."seo_meta"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_seo_meta_id_seo_meta_id_fk" FOREIGN KEY ("seo_meta_id") REFERENCES "public"."seo_meta"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_delivery_zone_id_delivery_zones_id_fk" FOREIGN KEY ("delivery_zone_id") REFERENCES "public"."delivery_zones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notification_preferences" ADD CONSTRAINT "customer_notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_wishlist_id_wishlists_id_fk" FOREIGN KEY ("wishlist_id") REFERENCES "public"."wishlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banners" ADD CONSTRAINT "banners_delivery_zone_id_delivery_zones_id_fk" FOREIGN KEY ("delivery_zone_id") REFERENCES "public"."delivery_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banners" ADD CONSTRAINT "banners_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_policies" ADD CONSTRAINT "cancellation_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_restrictions" ADD CONSTRAINT "coupon_restrictions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_rules" ADD CONSTRAINT "promotion_rules_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_banner_id_banners_id_fk" FOREIGN KEY ("banner_id") REFERENCES "public"."banners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_zone_scope_delivery_zones_id_fk" FOREIGN KEY ("zone_scope") REFERENCES "public"."delivery_zones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_delivery_zone_id_delivery_zones_id_fk" FOREIGN KEY ("delivery_zone_id") REFERENCES "public"."delivery_zones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_address_id_addresses_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."addresses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_applied_coupon_id_coupons_id_fk" FOREIGN KEY ("applied_coupon_id") REFERENCES "public"."coupons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_usages" ADD CONSTRAINT "coupon_usages_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_usages" ADD CONSTRAINT "coupon_usages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_usages" ADD CONSTRAINT "coupon_usages_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_zone_id_delivery_zones_id_fk" FOREIGN KEY ("delivery_zone_id") REFERENCES "public"."delivery_zones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_batches" ADD CONSTRAINT "payout_batches_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_initiated_by_users_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_deposits" ADD CONSTRAINT "cash_deposits_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_deposits" ADD CONSTRAINT "cash_deposits_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_delivery_zone_id_delivery_zones_id_fk" FOREIGN KEY ("delivery_zone_id") REFERENCES "public"."delivery_zones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_assignments" ADD CONSTRAINT "delivery_assignments_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_assignments" ADD CONSTRAINT "delivery_assignments_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_assignments" ADD CONSTRAINT "delivery_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_proofs" ADD CONSTRAINT "delivery_proofs_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_status_history" ADD CONSTRAINT "delivery_status_history_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_status_history" ADD CONSTRAINT "delivery_status_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_cash_ledger" ADD CONSTRAINT "driver_cash_ledger_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_cash_ledger" ADD CONSTRAINT "driver_cash_ledger_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_cash_ledger" ADD CONSTRAINT "driver_cash_ledger_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_cash_ledger" ADD CONSTRAINT "driver_cash_ledger_cash_deposit_id_cash_deposits_id_fk" FOREIGN KEY ("cash_deposit_id") REFERENCES "public"."cash_deposits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_cash_ledger" ADD CONSTRAINT "driver_cash_ledger_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_earnings" ADD CONSTRAINT "driver_earnings_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_earnings" ADD CONSTRAINT "driver_earnings_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_earnings" ADD CONSTRAINT "driver_earnings_payout_batch_id_payout_batches_id_fk" FOREIGN KEY ("payout_batch_id") REFERENCES "public"."payout_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_earnings" ADD CONSTRAINT "driver_earnings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_vehicles" ADD CONSTRAINT "driver_vehicles_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_zones" ADD CONSTRAINT "driver_zones_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_zones" ADD CONSTRAINT "driver_zones_delivery_zone_id_delivery_zones_id_fk" FOREIGN KEY ("delivery_zone_id") REFERENCES "public"."delivery_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_template_id_notification_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."notification_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_moderated_by_users_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banner_translations" ADD CONSTRAINT "banner_translations_banner_id_banners_id_fk" FOREIGN KEY ("banner_id") REFERENCES "public"."banners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banner_translations" ADD CONSTRAINT "banner_translations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_post_translations" ADD CONSTRAINT "blog_post_translations_blog_post_id_blog_posts_id_fk" FOREIGN KEY ("blog_post_id") REFERENCES "public"."blog_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_post_translations" ADD CONSTRAINT "blog_post_translations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_translations" ADD CONSTRAINT "brand_translations_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_translations" ADD CONSTRAINT "brand_translations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_reason_translations" ADD CONSTRAINT "cancellation_reason_translations_reason_id_cancellation_reasons_id_fk" FOREIGN KEY ("reason_id") REFERENCES "public"."cancellation_reasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_reason_translations" ADD CONSTRAINT "cancellation_reason_translations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_translations" ADD CONSTRAINT "category_translations_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_translations" ADD CONSTRAINT "category_translations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_page_translations" ADD CONSTRAINT "cms_page_translations_cms_page_id_cms_pages_id_fk" FOREIGN KEY ("cms_page_id") REFERENCES "public"."cms_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_page_translations" ADD CONSTRAINT "cms_page_translations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_translations" ADD CONSTRAINT "coupon_translations_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_translations" ADD CONSTRAINT "coupon_translations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faq_translations" ADD CONSTRAINT "faq_translations_faq_id_faqs_id_fk" FOREIGN KEY ("faq_id") REFERENCES "public"."faqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faq_translations" ADD CONSTRAINT "faq_translations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_translations" ADD CONSTRAINT "product_translations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_translations" ADD CONSTRAINT "product_translations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_translations" ADD CONSTRAINT "product_variant_translations_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_translations" ADD CONSTRAINT "product_variant_translations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_meta_translations" ADD CONSTRAINT "seo_meta_translations_seo_meta_id_seo_meta_id_fk" FOREIGN KEY ("seo_meta_id") REFERENCES "public"."seo_meta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_meta_translations" ADD CONSTRAINT "seo_meta_translations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_settings" ADD CONSTRAINT "admin_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devices_user_idx" ON "devices" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_fcm_token_key" ON "devices" USING btree ("fcm_token") WHERE fcm_token is not null;--> statement-breakpoint
CREATE INDEX "login_attempts_identifier_idx" ON "login_attempts" USING btree ("identifier","created_at");--> statement-breakpoint
CREATE INDEX "login_attempts_ip_idx" ON "login_attempts" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "otp_verifications_lookup_idx" ON "otp_verifications" USING btree ("destination","purpose","created_at");--> statement-breakpoint
CREATE INDEX "otp_verifications_user_idx" ON "otp_verifications" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions" USING btree ("key");--> statement-breakpoint
CREATE INDEX "permissions_resource_idx" ON "permissions" USING btree ("resource");--> statement-breakpoint
CREATE INDEX "role_permissions_permission_idx" ON "role_permissions" USING btree ("permission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_key_key" ON "roles" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_roles_active_key" ON "user_roles" USING btree ("user_id","role_id","scope_id") WHERE revoked_at is null;--> statement-breakpoint
CREATE INDEX "user_roles_user_idx" ON "user_roles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_roles_role_idx" ON "user_roles" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "user_roles_scope_idx" ON "user_roles" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_firebase_uid_key" ON "users" USING btree ("firebase_uid");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_key" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_zones_code_key" ON "delivery_zones" USING btree ("code");--> statement-breakpoint
CREATE INDEX "delivery_zones_active_idx" ON "delivery_zones" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "delivery_zones_city_idx" ON "delivery_zones" USING btree ("city");--> statement-breakpoint
CREATE UNIQUE INDEX "zone_pincodes_pincode_active_key" ON "zone_pincodes" USING btree ("pincode") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "zone_pincodes_zone_idx" ON "zone_pincodes" USING btree ("delivery_zone_id");--> statement-breakpoint
CREATE INDEX "zone_pincodes_lookup_idx" ON "zone_pincodes" USING btree ("pincode") WHERE is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "blog_posts_slug_key" ON "blog_posts" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "blog_posts_status_idx" ON "blog_posts" USING btree ("status","published_at") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "cancellation_reasons_code_key" ON "cancellation_reasons" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_pages_slug_key" ON "cms_pages" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "cms_pages_status_idx" ON "cms_pages" USING btree ("status") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "faqs_category_idx" ON "faqs" USING btree ("category","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "home_layouts_active_zone_key" ON "home_layouts" USING btree ("delivery_zone_id") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "home_layouts_active_idx" ON "home_layouts" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "redirects_source_key" ON "redirects" USING btree ("source_path");--> statement-breakpoint
CREATE INDEX "redirects_active_idx" ON "redirects" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_meta_entity_key" ON "seo_meta" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supported_locales_code_key" ON "supported_locales" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "supported_locales_single_default_key" ON "supported_locales" USING btree ("is_default") WHERE is_default = true;--> statement-breakpoint
CREATE INDEX "store_delivery_zones_zone_idx" ON "store_delivery_zones" USING btree ("delivery_zone_id");--> statement-breakpoint
CREATE INDEX "store_hours_store_idx" ON "store_hours" USING btree ("store_id","day_of_week");--> statement-breakpoint
CREATE UNIQUE INDEX "stores_slug_key" ON "stores" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "stores_vendor_idx" ON "stores" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "stores_status_idx" ON "stores" USING btree ("status") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "stores_pincode_idx" ON "stores" USING btree ("pincode");--> statement-breakpoint
CREATE INDEX "vendor_bank_accounts_vendor_idx" ON "vendor_bank_accounts" USING btree ("vendor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_bank_accounts_primary_key" ON "vendor_bank_accounts" USING btree ("vendor_id") WHERE is_primary = true and deleted_at is null;--> statement-breakpoint
CREATE INDEX "vendor_documents_vendor_idx" ON "vendor_documents" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "vendor_documents_status_idx" ON "vendor_documents" USING btree ("kyc_status");--> statement-breakpoint
CREATE INDEX "vendor_documents_expiry_idx" ON "vendor_documents" USING btree ("expires_at") WHERE expires_at is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_users_active_key" ON "vendor_users" USING btree ("vendor_id","user_id") WHERE removed_at is null;--> statement-breakpoint
CREATE INDEX "vendor_users_user_idx" ON "vendor_users" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendors_slug_key" ON "vendors" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "vendors_owner_idx" ON "vendors" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "vendors_status_idx" ON "vendors" USING btree ("status") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "brands_slug_key" ON "brands" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_key" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "categories_parent_order_idx" ON "categories" USING btree ("parent_id","display_order");--> statement-breakpoint
CREATE INDEX "categories_active_idx" ON "categories" USING btree ("is_active") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "product_images_product_idx" ON "product_images" USING btree ("product_id","display_order");--> statement-breakpoint
CREATE INDEX "product_images_variant_idx" ON "product_images" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_images_primary_key" ON "product_images" USING btree ("product_id") WHERE is_primary = true;--> statement-breakpoint
CREATE INDEX "product_variants_product_idx" ON "product_variants" USING btree ("product_id","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_default_key" ON "product_variants" USING btree ("product_id") WHERE is_default = true and deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "products_slug_key" ON "products" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "products_store_status_idx" ON "products" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "products_category_status_idx" ON "products" USING btree ("category_id","status","created_at");--> statement-breakpoint
CREATE INDEX "products_vendor_idx" ON "products" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "products_brand_idx" ON "products" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "products_active_idx" ON "products" USING btree ("status","category_id") WHERE deleted_at is null and status = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_variant_key" ON "inventory" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "inventory_store_idx" ON "inventory" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "inventory_low_stock_idx" ON "inventory" USING btree ("store_id") WHERE track_inventory = true and quantity_available <= low_stock_threshold;--> statement-breakpoint
CREATE INDEX "inventory_transactions_variant_idx" ON "inventory_transactions" USING btree ("variant_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_transactions_reference_idx" ON "inventory_transactions" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "inventory_transactions_store_idx" ON "inventory_transactions" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_transactions_order_movement_key" ON "inventory_transactions" USING btree ("reference_id","variant_id","txn_type") WHERE reference_type = 'ORDER' and txn_type in ('RESERVE', 'RELEASE', 'SALE');--> statement-breakpoint
CREATE INDEX "addresses_user_idx" ON "addresses" USING btree ("user_id") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "addresses_pincode_idx" ON "addresses" USING btree ("pincode");--> statement-breakpoint
CREATE INDEX "addresses_zone_idx" ON "addresses" USING btree ("delivery_zone_id");--> statement-breakpoint
CREATE UNIQUE INDEX "addresses_default_key" ON "addresses" USING btree ("user_id") WHERE is_default = true and deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_notification_preferences_key" ON "customer_notification_preferences" USING btree ("user_id","channel","category");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_profiles_user_key" ON "customer_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_profiles_referral_key" ON "customer_profiles" USING btree ("referral_code") WHERE referral_code is not null;--> statement-breakpoint
CREATE INDEX "wishlist_items_product_idx" ON "wishlist_items" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wishlists_user_default_key" ON "wishlists" USING btree ("user_id") WHERE is_default = true;--> statement-breakpoint
CREATE INDEX "wishlists_user_idx" ON "wishlists" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "banners_placement_idx" ON "banners" USING btree ("placement","priority") WHERE is_active = true and deleted_at is null;--> statement-breakpoint
CREATE INDEX "banners_zone_idx" ON "banners" USING btree ("delivery_zone_id");--> statement-breakpoint
CREATE INDEX "banners_schedule_idx" ON "banners" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cancellation_policies_key" ON "cancellation_policies" USING btree ("actor_role","from_status","payment_method_scope") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "cancellation_policies_lookup_idx" ON "cancellation_policies" USING btree ("actor_role","from_status");--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_restrictions_key" ON "coupon_restrictions" USING btree ("coupon_id","restriction_type","restriction_id");--> statement-breakpoint
CREATE INDEX "coupon_restrictions_coupon_idx" ON "coupon_restrictions" USING btree ("coupon_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons" USING btree ("code");--> statement-breakpoint
CREATE INDEX "coupons_active_idx" ON "coupons" USING btree ("is_active","valid_until") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_rules_key" ON "promotion_rules" USING btree ("promotion_id","rule_key");--> statement-breakpoint
CREATE INDEX "promotion_rules_promotion_idx" ON "promotion_rules" USING btree ("promotion_id");--> statement-breakpoint
CREATE INDEX "promotions_active_idx" ON "promotions" USING btree ("is_active","priority") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "promotions_banner_idx" ON "promotions" USING btree ("banner_id");--> statement-breakpoint
CREATE INDEX "promotions_zone_idx" ON "promotions" USING btree ("zone_scope");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_variant_key" ON "cart_items" USING btree ("cart_id","variant_id");--> statement-breakpoint
CREATE INDEX "cart_items_cart_idx" ON "cart_items" USING btree ("cart_id");--> statement-breakpoint
CREATE INDEX "cart_items_product_idx" ON "cart_items" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "carts_user_key" ON "carts" USING btree ("user_id") WHERE user_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "carts_guest_key" ON "carts" USING btree ("guest_token") WHERE guest_token is not null;--> statement-breakpoint
CREATE INDEX "carts_store_idx" ON "carts" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "carts_zone_idx" ON "carts" USING btree ("delivery_zone_id");--> statement-breakpoint
CREATE INDEX "carts_address_idx" ON "carts" USING btree ("address_id");--> statement-breakpoint
CREATE INDEX "carts_coupon_idx" ON "carts" USING btree ("applied_coupon_id");--> statement-breakpoint
CREATE INDEX "carts_expiry_idx" ON "carts" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_usages_order_key" ON "coupon_usages" USING btree ("coupon_id","order_id");--> statement-breakpoint
CREATE INDEX "coupon_usages_user_idx" ON "coupon_usages" USING btree ("coupon_id","user_id");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_product_idx" ON "order_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "order_items_variant_idx" ON "order_items" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "order_status_history_order_idx" ON "order_status_history" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "order_status_history_status_idx" ON "order_status_history" USING btree ("to_status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_number_key" ON "orders" USING btree ("order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_idempotency_key" ON "orders" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "orders_user_idx" ON "orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_store_status_idx" ON "orders" USING btree ("store_id","status","created_at");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "orders_zone_idx" ON "orders" USING btree ("delivery_zone_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_vendor_idx" ON "orders" USING btree ("vendor_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_coupon_idx" ON "orders" USING btree ("coupon_id");--> statement-breakpoint
CREATE INDEX "orders_pending_payment_idx" ON "orders" USING btree ("created_at") WHERE status = 'PENDING_PAYMENT';--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_order_key" ON "invoices" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices" USING btree ("invoice_number");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_provider_event_key" ON "payment_events" USING btree ("provider_event_id");--> statement-breakpoint
CREATE INDEX "payment_events_payment_idx" ON "payment_events" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_events_received_idx" ON "payment_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "payment_events_invalid_signature_idx" ON "payment_events" USING btree ("received_at") WHERE signature_valid = false;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idempotency_key" ON "payments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_provider_payment_idx" ON "payments" USING btree ("provider_payment_id");--> statement-breakpoint
CREATE INDEX "payments_reconciliation_idx" ON "payments" USING btree ("status","created_at") WHERE status in ('CREATED', 'PENDING');--> statement-breakpoint
CREATE INDEX "payout_batches_payee_idx" ON "payout_batches" USING btree ("payee_type","payee_id","period_start");--> statement-breakpoint
CREATE INDEX "payout_batches_status_idx" ON "payout_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "refunds_order_idx" ON "refunds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "refunds_status_idx" ON "refunds" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "tax_rates_hsn_idx" ON "tax_rates" USING btree ("hsn_code");--> statement-breakpoint
CREATE INDEX "tax_rates_active_idx" ON "tax_rates" USING btree ("is_active","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_deposits_reference_key" ON "cash_deposits" USING btree ("deposit_reference");--> statement-breakpoint
CREATE INDEX "cash_deposits_driver_idx" ON "cash_deposits" USING btree ("driver_id","declared_at");--> statement-breakpoint
CREATE INDEX "cash_deposits_pending_idx" ON "cash_deposits" USING btree ("declared_at") WHERE status = 'DECLARED';--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_order_key" ON "deliveries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "deliveries_driver_idx" ON "deliveries" USING btree ("driver_id","status");--> statement-breakpoint
CREATE INDEX "deliveries_store_idx" ON "deliveries" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "deliveries_pending_idx" ON "deliveries" USING btree ("delivery_zone_id","created_at") WHERE status = 'PENDING_ASSIGNMENT';--> statement-breakpoint
CREATE INDEX "deliveries_status_idx" ON "deliveries" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "deliveries_cod_variance_idx" ON "deliveries" USING btree ("cod_collected_at") WHERE cod_variance_paise is not null and cod_variance_paise <> 0;--> statement-breakpoint
CREATE INDEX "delivery_assignments_driver_idx" ON "delivery_assignments" USING btree ("driver_id","response","offered_at");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_assignments_attempt_key" ON "delivery_assignments" USING btree ("delivery_id","attempt_number");--> statement-breakpoint
CREATE INDEX "delivery_assignments_open_idx" ON "delivery_assignments" USING btree ("driver_id","offer_expires_at") WHERE response is null;--> statement-breakpoint
CREATE INDEX "delivery_proofs_delivery_idx" ON "delivery_proofs" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "delivery_proofs_exception_idx" ON "delivery_proofs" USING btree ("proof_type","created_at") WHERE proof_type <> 'OTP';--> statement-breakpoint
CREATE INDEX "delivery_status_history_delivery_idx" ON "delivery_status_history" USING btree ("delivery_id","created_at");--> statement-breakpoint
CREATE INDEX "delivery_status_history_purge_idx" ON "delivery_status_history" USING btree ("created_at") WHERE latitude is not null;--> statement-breakpoint
CREATE INDEX "driver_cash_ledger_driver_idx" ON "driver_cash_ledger" USING btree ("driver_id","created_at");--> statement-breakpoint
CREATE INDEX "driver_cash_ledger_deposit_idx" ON "driver_cash_ledger" USING btree ("cash_deposit_id");--> statement-breakpoint
CREATE INDEX "driver_cash_ledger_delivery_idx" ON "driver_cash_ledger" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "driver_cash_ledger_order_idx" ON "driver_cash_ledger" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "driver_cash_ledger_collection_key" ON "driver_cash_ledger" USING btree ("delivery_id","entry_type") WHERE entry_type = 'COLLECTION';--> statement-breakpoint
CREATE INDEX "driver_documents_driver_idx" ON "driver_documents" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "driver_documents_expiry_idx" ON "driver_documents" USING btree ("expires_at") WHERE expires_at is not null;--> statement-breakpoint
CREATE INDEX "driver_documents_status_idx" ON "driver_documents" USING btree ("kyc_status");--> statement-breakpoint
CREATE INDEX "driver_earnings_driver_idx" ON "driver_earnings" USING btree ("driver_id","earned_on");--> statement-breakpoint
CREATE INDEX "driver_earnings_batch_idx" ON "driver_earnings" USING btree ("payout_batch_id");--> statement-breakpoint
CREATE INDEX "driver_earnings_delivery_idx" ON "driver_earnings" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "driver_vehicles_driver_idx" ON "driver_vehicles" USING btree ("driver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "driver_vehicles_active_key" ON "driver_vehicles" USING btree ("driver_id") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "driver_zones_zone_idx" ON "driver_zones" USING btree ("delivery_zone_id");--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_user_key" ON "drivers" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_code_key" ON "drivers" USING btree ("driver_code");--> statement-breakpoint
CREATE INDEX "drivers_status_idx" ON "drivers" USING btree ("status") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "drivers_dispatch_idx" ON "drivers" USING btree ("availability","status") WHERE availability = 'ONLINE' and status = 'APPROVED' and current_latitude is not null;--> statement-breakpoint
CREATE INDEX "campaigns_status_idx" ON "campaigns" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "campaigns_coupon_idx" ON "campaigns" USING btree ("coupon_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_templates_key" ON "notification_templates" USING btree ("event_key","channel","locale","version");--> statement-breakpoint
CREATE INDEX "notification_templates_lookup_idx" ON "notification_templates" USING btree ("event_key","channel","locale") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_retry_idx" ON "notifications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "notifications_order_idx" ON "notifications" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "notifications_template_idx" ON "notifications" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("user_id") WHERE read_at is null;--> statement-breakpoint
CREATE INDEX "reviews_product_idx" ON "reviews" USING btree ("product_id","status") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "reviews_store_idx" ON "reviews" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "reviews_driver_idx" ON "reviews" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "reviews_moderation_idx" ON "reviews" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "support_tickets_number_key" ON "support_tickets" USING btree ("ticket_number");--> statement-breakpoint
CREATE INDEX "support_tickets_user_idx" ON "support_tickets" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "support_tickets_queue_idx" ON "support_tickets" USING btree ("status","priority","sla_due_at");--> statement-breakpoint
CREATE INDEX "support_tickets_assignee_idx" ON "support_tickets" USING btree ("assigned_to_user_id","status");--> statement-breakpoint
CREATE INDEX "support_tickets_order_idx" ON "support_tickets" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "ticket_messages_ticket_idx" ON "ticket_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "ticket_messages_public_idx" ON "ticket_messages" USING btree ("ticket_id","created_at") WHERE is_internal_note = false;--> statement-breakpoint
CREATE UNIQUE INDEX "banner_translations_key" ON "banner_translations" USING btree ("banner_id","locale");--> statement-breakpoint
CREATE INDEX "banner_translations_locale_idx" ON "banner_translations" USING btree ("locale");--> statement-breakpoint
CREATE UNIQUE INDEX "blog_post_translations_key" ON "blog_post_translations" USING btree ("blog_post_id","locale");--> statement-breakpoint
CREATE INDEX "blog_post_translations_locale_idx" ON "blog_post_translations" USING btree ("locale");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_translations_key" ON "brand_translations" USING btree ("brand_id","locale");--> statement-breakpoint
CREATE INDEX "brand_translations_locale_idx" ON "brand_translations" USING btree ("locale");--> statement-breakpoint
CREATE UNIQUE INDEX "cancellation_reason_translations_key" ON "cancellation_reason_translations" USING btree ("reason_id","locale");--> statement-breakpoint
CREATE INDEX "cancellation_reason_translations_locale_idx" ON "cancellation_reason_translations" USING btree ("locale");--> statement-breakpoint
CREATE UNIQUE INDEX "category_translations_key" ON "category_translations" USING btree ("category_id","locale");--> statement-breakpoint
CREATE INDEX "category_translations_locale_idx" ON "category_translations" USING btree ("locale");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_page_translations_key" ON "cms_page_translations" USING btree ("cms_page_id","locale");--> statement-breakpoint
CREATE INDEX "cms_page_translations_locale_idx" ON "cms_page_translations" USING btree ("locale");--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_translations_key" ON "coupon_translations" USING btree ("coupon_id","locale");--> statement-breakpoint
CREATE INDEX "coupon_translations_locale_idx" ON "coupon_translations" USING btree ("locale");--> statement-breakpoint
CREATE UNIQUE INDEX "faq_translations_key" ON "faq_translations" USING btree ("faq_id","locale");--> statement-breakpoint
CREATE INDEX "faq_translations_locale_idx" ON "faq_translations" USING btree ("locale");--> statement-breakpoint
CREATE UNIQUE INDEX "product_translations_key" ON "product_translations" USING btree ("product_id","locale");--> statement-breakpoint
CREATE INDEX "product_translations_locale_idx" ON "product_translations" USING btree ("locale");--> statement-breakpoint
CREATE INDEX "product_translations_name_trgm_idx" ON "product_translations" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "product_translations_search_en_idx" ON "product_translations" USING gin ("search_vector_english");--> statement-breakpoint
CREATE INDEX "product_translations_search_simple_idx" ON "product_translations" USING gin ("search_vector_simple");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variant_translations_key" ON "product_variant_translations" USING btree ("variant_id","locale");--> statement-breakpoint
CREATE INDEX "product_variant_translations_locale_idx" ON "product_variant_translations" USING btree ("locale");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_meta_translations_key" ON "seo_meta_translations" USING btree ("seo_meta_id","locale");--> statement-breakpoint
CREATE INDEX "seo_meta_translations_locale_idx" ON "seo_meta_translations" USING btree ("locale");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_settings_key_key" ON "admin_settings" USING btree ("key");--> statement-breakpoint
CREATE INDEX "admin_settings_group_idx" ON "admin_settings" USING btree ("group_name");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_request_idx" ON "audit_logs" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flags_key_key" ON "feature_flags" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_key_key" ON "idempotency_keys" USING btree ("key");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expiry_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idempotency_keys_user_idx" ON "idempotency_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "system_events_severity_idx" ON "system_events" USING btree ("severity","created_at");--> statement-breakpoint
CREATE INDEX "system_events_type_idx" ON "system_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "system_events_unresolved_idx" ON "system_events" USING btree ("created_at") WHERE resolved_at is null;--> statement-breakpoint
CREATE INDEX "webhook_logs_provider_idx" ON "webhook_logs" USING btree ("provider","created_at");--> statement-breakpoint
CREATE INDEX "webhook_logs_unprocessed_idx" ON "webhook_logs" USING btree ("created_at") WHERE processed = false;--> statement-breakpoint
CREATE INDEX "webhook_logs_invalid_signature_idx" ON "webhook_logs" USING btree ("created_at") WHERE signature_valid = false;