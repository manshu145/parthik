# PARTHIK — Full-Stack Rebuild Master Blueprint
## Product, UX, Architecture, Navigation, Dashboards, SOPs & Kiro AI Development Specification

> **Document purpose:** This is the master product/engineering blueprint for rebuilding **Parthik** from the current custom implementation into a scalable, modern Next.js application developed through GitHub + Kiro AI and deployed through Cloudflare.
>
> **Target:** Customer Web/PWA + Vendor Dashboard + Driver Dashboard + Main Admin Dashboard + marketing/content pages + operations + payments + delivery + notifications + analytics.
>
> **Important:** This is a greenfield rebuild specification. The existing application should be backed up before replacement. Existing business rules/data should be migrated only after they are mapped and validated.

---

# 1. PRODUCT VISION

Parthik is a hyperlocal commerce and food/grocery delivery platform. The system must support customers ordering products from the available catalog, vendors managing products/orders, drivers handling deliveries, and administrators controlling the entire marketplace.

The new product should feel like a serious production SaaS/marketplace platform rather than a simple custom website.

### Primary goals

1. Fast mobile-first customer experience.
2. PWA-ready architecture.
3. SEO-friendly public pages.
4. Role-based dashboards.
5. Strong order/delivery state management.
6. Vendor and driver operations.
7. Central admin control.
8. Coupon, offer and marketing engine.
9. Payment-ready architecture.
10. Notification architecture.
11. Audit logs and operational visibility.
12. Secure APIs and permissions.
13. Scalable database design.
14. Cloudflare-compatible deployment.
15. GitHub-based development with Kiro AI.
16. Clean component system and reusable UI.
17. Easy future expansion into more cities/categories.

---

# 2. EXISTING PRODUCT REFERENCE

The current public Parthik site already exposes customer-facing concepts including location selection/detection, email login, phone OTP login, signup, product search, categories, featured products, coupons/offers, favorites, cart, account, saved addresses, order history and checkout. It also exposes Vendor Registration and Driver Registration pages. Current customer messaging includes free delivery above ₹199 and a default delivery charge shown in cart. These existing flows must be treated as requirements to preserve or improve, not blindly copied.

Current public navigation includes:

- Home
- Categories
- Offers
- Favorites
- Cart
- Account

Footer includes:

- About Us
- Privacy Policy
- Terms & Conditions
- Vendor Registration
- Driver Registration

---

# 3. USER ROLES

## 3.1 Customer

Can:

- Register/login
- OTP authentication
- Email authentication
- Manage profile
- Manage addresses
- Detect/select location
- Browse categories
- Search products
- Filter/sort
- View product details
- Add/remove cart items
- Manage quantity
- Wishlist/favorites
- Apply coupons
- Checkout
- Select payment method
- Place order
- Track order
- View order history
- Reorder
- Cancel where policy permits
- Request support
- Review products/order
- Manage notifications
- Logout

## 3.2 Vendor

Can:

- Apply for vendor account
- Complete business/KYC profile
- Manage store profile
- Add/edit products
- Manage categories assigned to store
- Manage pricing
- Manage inventory
- Accept/reject orders
- Update order preparation status
- View sales
- View payouts
- Manage store availability
- View customer/order information permitted by policy
- Raise support tickets

## 3.3 Driver

Can:

- Apply/register
- Complete profile/KYC
- Set availability
- Go online/offline
- Receive delivery assignments
- Accept/reject assignment where policy allows
- Navigate to pickup
- Confirm pickup
- Navigate to customer
- Confirm delivery
- Upload proof if required
- View earnings
- View delivery history
- Raise support ticket

## 3.4 Admin

Full control:

- Customers
- Vendors
- Drivers
- Products
- Categories
- Orders
- Deliveries
- Coupons
- Promotions
- Banners
- CMS
- Reviews
- Payments
- Refunds
- Payouts
- Delivery zones
- Settings
- Notifications
- Analytics
- Roles/permissions
- Audit logs
- Support
- Feature flags

---

# 4. TECH STACK

## Frontend

- Next.js latest stable
- App Router
- TypeScript
- Tailwind CSS
- shadcn/ui
- React Hook Form
- Zod validation
- TanStack Query where client-side server state is required
- PWA support
- Responsive/mobile-first UI

## Backend

Prefer a modular Next.js architecture initially:

- Route Handlers
- Server Actions where appropriate
- Service layer
- Repository/data-access layer
- Zod validation
- RBAC middleware
- Domain-based modules

Do not put business logic directly into UI components.

## Database

Preferred:

- PostgreSQL
- Prisma ORM or Drizzle ORM
- Database migrations
- Proper indexes
- Soft deletion where appropriate

## Cache / background work

- Redis-compatible cache
- Queue abstraction for notifications, order events and heavy jobs
- Scheduled jobs for campaigns, expiry, inventory checks etc.

## Cloudflare

- DNS
- SSL/TLS
- CDN
- WAF/security
- Workers/OpenNext for Next.js deployment
- R2 for object/file storage where appropriate
- Turnstile for abuse protection where useful

## Repository

GitHub monorepo or clean single-repo architecture.

Suggested:

```text
parthik/
├── app/
├── components/
├── modules/
├── lib/
├── db/
├── hooks/
├── types/
├── public/
├── prisma/ or drizzle/
├── docs/
├── tests/
├── scripts/
├── .env.example
└── README.md
```

---

# 5. HIGH-LEVEL ARCHITECTURE

```text
                         parthik.com
                              |
                         Cloudflare
                    DNS / CDN / WAF / SSL
                              |
                      Next.js + Workers
                              |
        +---------------------+----------------------+
        |                     |                      |
   Customer App         Vendor Dashboard       Driver Dashboard
        |                     |                      |
        +---------------------+----------------------+
                              |
                       Application Services
                              |
       +----------------------+----------------------+
       |                      |                      |
   PostgreSQL               Redis                R2 Storage
       |                      |                      |
 Users/Orders/etc.      Cache/Sessions         Product images/docs
                              |
                    Notification Providers
                    SMS / Email / Push / WhatsApp
```

Architecture must remain modular so that a future dedicated NestJS/API service can be introduced without rewriting the frontend.

---

# 6. DATABASE CORE ENTITIES

Minimum entities:

### Identity

- User
- UserRole
- Session
- OTPVerification
- Permission
- RolePermission
- LoginAttempt
- Device

### Customer

- CustomerProfile
- Address
- Wishlist
- WishlistItem
- CustomerNotificationPreference

### Marketplace

- Vendor
- VendorUser
- VendorDocument
- VendorBankAccount
- Store
- StoreHours
- DeliveryZone
- Product
- ProductVariant
- ProductImage
- Category
- Subcategory
- Brand
- Inventory
- InventoryTransaction

### Commerce

- Cart
- CartItem
- Coupon
- CouponUsage
- Promotion
- Order
- OrderItem
- OrderStatusHistory
- Payment
- Refund
- Invoice
- Tax

### Delivery

- Driver
- DriverDocument
- DriverVehicle
- Delivery
- DeliveryAssignment
- DeliveryStatusHistory
- DeliveryProof
- DriverEarning

### Engagement

- Review
- Rating
- Banner
- Campaign
- Notification
- NotificationTemplate
- SupportTicket
- FAQ

### Administration

- AdminSetting
- AuditLog
- FeatureFlag
- SystemEvent

Every important state-changing entity should have timestamps and, where useful, createdBy/updatedBy fields.

---

# 7. CUSTOMER NAVIGATION

## Mobile bottom navigation

```text
Home | Categories | Offers | Cart | Account
```

Favorites can remain accessible from Account/Product pages or become a sixth contextual action if UX testing supports it.

## Desktop header

```text
Logo
Location
Search
Categories
Offers
Favorites
Account
Cart
```

### Global components

- Location selector
- Search
- Cart mini-drawer
- Login modal/page
- Notification center
- Toast system
- Loading skeletons
- Empty states
- Error states
- Confirmation dialogs

---

# 8. CUSTOMER PAGES

## Public pages

- `/`
- `/about`
- `/contact`
- `/faq`
- `/privacy`
- `/terms`
- `/refund-policy`
- `/shipping-policy`
- `/cancellation-policy`
- `/vendor-registration`
- `/driver-registration`
- `/careers`
- `/blog`
- `/offers`

## Commerce pages

- `/categories`
- `/category/[slug]`
- `/products/[slug]`
- `/search`
- `/favorites`
- `/cart`
- `/checkout`
- `/order/[id]`
- `/orders`
- `/orders/[id]/track`

## Account

- `/account`
- `/account/profile`
- `/account/addresses`
- `/account/orders`
- `/account/favorites`
- `/account/notifications`
- `/account/security`
- `/account/support`

---

# 9. CUSTOMER HOME PAGE

Recommended order:

1. Location/delivery area
2. Search bar
3. Hero/banner
4. Quick categories
5. Featured products
6. Popular products
7. Hot deals
8. Coupon strip
9. Recommended products
10. Recently viewed/reorder
11. Trust/service highlights
12. Footer

Homepage must be CMS-driven. Admin should be able to change banners, sections, ordering and visibility without code changes.

---

# 10. PRODUCT EXPERIENCE

Product card:

- Image
- Product name
- Short metadata
- Price
- MRP/discount
- Unit/weight
- Rating
- Availability
- Add button
- Quantity controls
- Wishlist icon

Product detail:

- Image gallery
- Name
- Rating
- Price/MRP
- Discount
- Variant selector
- Quantity
- Availability
- Delivery estimate
- Description
- Specifications
- Seller/store information
- Reviews
- Related products
- Frequently bought together

Do not allow unavailable products to silently enter cart.

---

# 11. LOCATION SYSTEM

Location is a core feature.

Support:

- Detect location
- Manual location selection
- Search address
- Saved addresses
- Pincode/serviceability
- Delivery zone check
- Address validation
- Store availability by zone

Every checkout must verify serviceability again because availability may change.

---

# 12. CART & CHECKOUT

Cart must show:

- Items
- Quantity
- Item subtotal
- Discounts
- Coupon
- Delivery fee
- Taxes if applicable
- Packaging/service fee if applicable
- Grand total
- Minimum order requirement
- Free delivery threshold
- Estimated delivery time

Checkout:

1. Address
2. Delivery slot/ETA
3. Coupon
4. Payment method
5. Order summary
6. Terms/confirmation
7. Place order

Use idempotency protection so repeated clicks cannot create duplicate orders.

---

# 13. ORDER STATE MACHINE

Suggested:

```text
PENDING_PAYMENT
      ↓
CONFIRMED
      ↓
ACCEPTED
      ↓
PREPARING
      ↓
READY_FOR_PICKUP
      ↓
ASSIGNED
      ↓
PICKED_UP
      ↓
OUT_FOR_DELIVERY
      ↓
DELIVERED
```

Alternative terminal states:

```text
CANCELLED
PAYMENT_FAILED
REFUNDED
RETURNED
FAILED_DELIVERY
```

Every status transition must be logged.

---

# 14. VENDOR DASHBOARD

Navigation:

```text
Overview
Orders
Products
Categories
Inventory
Store
Customers/Orders
Coupons
Analytics
Payouts
Documents
Notifications
Support
Settings
```

### Vendor overview

Show:

- Today's orders
- Today's sales
- Pending orders
- Preparing orders
- Completed orders
- Low-stock products
- Store status
- Earnings
- Recent orders
- Sales graph

### Vendor product manager

- Product list
- Add product
- Edit product
- Images
- Variants
- Price
- MRP
- Stock
- SKU
- Tax
- Status
- Bulk import/export
- Bulk price update

### Vendor order workflow

- New
- Accept
- Reject with reason
- Preparing
- Ready
- Pickup
- Completed

Vendor must not see sensitive customer information beyond operational necessity.

---

# 15. DRIVER DASHBOARD

Navigation:

```text
Home
Available Deliveries
Active Delivery
History
Earnings
Profile
Documents
Support
Settings
```

Driver home:

- Online/offline toggle
- Current status
- Today's deliveries
- Today's earnings
- Active delivery
- Notifications

Delivery flow:

```text
Assignment
 ↓
Accept
 ↓
Navigate to Store
 ↓
Arrived
 ↓
Pickup Confirmed
 ↓
Navigate to Customer
 ↓
Arrived
 ↓
Delivery Confirmation
 ↓
Completed
```

Proof options:

- OTP
- Customer confirmation
- Photo/signature where required

Driver location should be handled with privacy, retention and operational limits.

---

# 16. MAIN ADMIN DASHBOARD

Admin navigation:

```text
Dashboard
Orders
Customers
Vendors
Drivers
Products
Categories
Inventory
Delivery
Payments
Coupons
Promotions
Banners
CMS
Reviews
Support
Notifications
Analytics
Reports
Payouts
Settings
Roles & Permissions
Audit Logs
System Health
```

### Admin dashboard KPIs

- GMV
- Net sales
- Orders
- AOV
- Active customers
- New customers
- Active vendors
- Active drivers
- Cancellation rate
- Delivery success rate
- Refund value
- Coupon usage
- Conversion rate

Charts:

- Orders/day
- Revenue/day
- Category performance
- Vendor performance
- Customer acquisition
- Delivery performance

---

# 17. ADMIN ORDER CONTROL

Admin can:

- Search order
- Filter status
- View full timeline
- View payment
- Change operational status where authorized
- Assign/reassign driver
- Cancel
- Refund
- Add internal note
- Contact customer/vendor/driver
- View audit history

Dangerous actions require confirmation.

---

# 18. MARKETING SYSTEM

Marketing must be first-class, not hardcoded.

## Banners

Fields:

- Title
- Subtitle
- Image
- Mobile image
- CTA
- Link
- Start date
- End date
- Target audience
- Delivery zone
- Priority
- Active/inactive

## Coupons

Support:

- Flat discount
- Percentage discount
- Maximum discount
- Minimum cart value
- First-order only
- User-specific
- Category-specific
- Product-specific
- Vendor-specific
- Usage limit
- Per-user limit
- Expiry
- Zone restriction

## Promotions

Examples:

- Buy X Get Y
- Free delivery
- Category discount
- Vendor campaign
- Weekend sale
- Flash sale
- New customer offer

---

# 19. CMS / MARKETING PAGES

Admin-managed pages:

- About
- Contact
- FAQ
- Terms
- Privacy
- Refund policy
- Cancellation policy
- Delivery policy
- Vendor information
- Driver information
- Blog

SEO fields:

- Meta title
- Meta description
- Canonical
- OG title
- OG description
- OG image
- Schema type
- Index/noindex
- Sitemap inclusion

---

# 20. SEO ARCHITECTURE

Use server-rendered/indexable pages for public commerce content.

Required:

- Dynamic metadata
- Canonicals
- XML sitemap
- Robots.txt
- Open Graph
- Twitter/X cards
- Product schema
- Breadcrumb schema
- Organization/local business schema where appropriate
- Clean slugs
- 404 page
- 301 redirect manager in admin if required
- Image optimization
- Internal linking

Never expose private dashboard pages to search engines.

---

# 21. NOTIFICATIONS

Central notification service supporting:

- SMS
- Email
- Push
- In-app
- WhatsApp later

Events:

- OTP
- Signup
- Order placed
- Payment success/failure
- Order accepted
- Preparing
- Ready
- Driver assigned
- Out for delivery
- Delivered
- Cancellation
- Refund
- Coupon campaign
- Vendor alerts
- Driver alerts

Templates must be admin-editable with variables.

---

# 22. PAYMENTS

Payment abstraction should support multiple providers without rewriting checkout.

Payment lifecycle:

```text
CREATE ORDER
 ↓
CREATE PAYMENT
 ↓
PAYMENT GATEWAY
 ↓
WEBHOOK
 ↓
VERIFY SIGNATURE
 ↓
MARK PAYMENT
 ↓
CONFIRM ORDER
```

Never trust only the frontend payment result.

Implement:

- Webhook verification
- Idempotency
- Payment logs
- Refunds
- Failed payment recovery
- Reconciliation

---

# 23. SECURITY

Mandatory:

- Server-side authorization
- RBAC
- Input validation
- Rate limiting
- OTP abuse protection
- CSRF protection where applicable
- Secure cookies/session
- Password hashing if passwords are retained
- Webhook signature validation
- File upload validation
- MIME/type/size limits
- Audit logs
- Admin action logging
- Secrets only in environment variables
- No secrets in GitHub
- Security headers
- Cloudflare WAF
- Bot protection where appropriate

Roles must never be trusted from client-side state.

---

# 24. DESIGN SYSTEM

Visual direction:

**Modern Indian hyperlocal commerce — clean, trustworthy, fast, premium but accessible.**

Rules:

- Mobile-first
- Large tap targets
- Consistent spacing
- Minimal visual clutter
- Clear price hierarchy
- Strong CTA
- Accessible contrast
- Skeleton loading
- Consistent cards
- Consistent buttons
- Consistent form fields
- Responsive desktop dashboards

Create design tokens for:

- Colors
- Typography
- Radius
- Shadows
- Spacing
- Breakpoints
- Z-index
- Motion

Do not create random styling page-by-page.

---

# 25. UX STATES

Every important component must have:

- Loading
- Empty
- Success
- Error
- Disabled
- Unauthorized
- Not found
- Offline/network failure

Examples:

Cart empty ≠ error.

Product unavailable ≠ blank page.

No orders ≠ broken dashboard.

Every empty state must explain what the user can do next.

---

# 26. ACCESSIBILITY

Target WCAG-conscious implementation:

- Keyboard navigation
- Visible focus
- Semantic HTML
- Labels for inputs
- Alt text
- Accessible dialogs
- Screen-reader-friendly status messages
- Color must not be the only state indicator
- Sufficient touch target sizes

---

# 27. SOP — DEVELOPMENT WORKFLOW

## Step 1 — Freeze requirements

Do not code until:

- User roles documented
- Navigation documented
- Core flows documented
- Database entities documented
- Design system documented

## Step 2 — GitHub

Create:

```text
main
develop
feature/*
fix/*
```

Protect main branch.

Every feature:

```text
branch
→ code
→ test
→ commit
→ PR
→ review
→ merge
```

## Step 3 — Kiro

Kiro must receive:

1. Product vision
2. Architecture
3. User roles
4. Database model
5. Design rules
6. Coding rules
7. Definition of done

Kiro must NOT invent business rules when documentation is silent.

## Step 4 — Build foundation

First:

- Next.js
- TypeScript
- Tailwind
- UI system
- DB
- Auth
- env system
- logging
- error handling
- testing
- linting
- formatting

Then build modules.

---

# 28. KIRO DEVELOPMENT RULES

Kiro must follow:

1. TypeScript strict mode.
2. No `any` unless explicitly justified.
3. No secrets in source.
4. No business logic inside presentation components.
5. Reuse components.
6. Validate all external input.
7. Server-side authorization.
8. Database migrations only through migration tooling.
9. Every feature gets loading/error/empty states.
10. Every mutation gets proper error handling.
11. Avoid duplicated business logic.
12. Write tests for critical workflows.
13. Update documentation when architecture changes.
14. Do not introduce a new dependency without justification.
15. Do not refactor unrelated modules during feature work.
16. Do not delete existing functionality without explicit approval.
17. Do not assume production credentials.
18. Never bypass permission checks for convenience.

---

# 29. TESTING STRATEGY

## Unit tests

- Pricing
- Coupon rules
- Delivery fee
- Permissions
- Order transitions
- Inventory calculations

## Integration tests

- Signup/login
- Cart
- Checkout
- Payment webhook
- Vendor order
- Driver delivery
- Refund

## E2E tests

Critical customer flow:

```text
Location
→ Browse
→ Product
→ Cart
→ Coupon
→ Checkout
→ Payment
→ Order
```

Vendor:

```text
Login
→ Order
→ Accept
→ Prepare
→ Ready
```

Driver:

```text
Login
→ Online
→ Assignment
→ Pickup
→ Delivery
```

Admin:

```text
Login
→ Order
→ Assign
→ Monitor
```

---

# 30. OBSERVABILITY

Implement:

- Structured application logs
- Error tracking
- Request IDs
- Order IDs in logs
- Payment IDs
- Webhook logs
- Audit logs
- Performance monitoring
- Health endpoint
- Database health check

Admin should have a basic System Health screen.

---

# 31. BACKUP & DATA MIGRATION SOP

Before old site replacement:

1. Full source backup.
2. Database dump.
3. Product image/media backup.
4. Environment/config backup.
5. Domain/DNS record export.
6. Existing URL inventory.
7. Existing user/order data assessment.
8. Existing coupon/vendor/driver data export.
9. Verify backups by restoration test.

Never delete the old production database before the new system is validated.

---

# 32. DEPLOYMENT ARCHITECTURE

Development:

```text
Local
 ↓
GitHub
 ↓
Preview deployment
```

Production:

```text
GitHub main
 ↓
Cloudflare build/deploy
 ↓
Workers/OpenNext
 ↓
parthik.com
```

Cloudflare should handle DNS, SSL and edge protection.

Storage:

```text
Product images
Vendor documents
Delivery proofs
CMS media
        ↓
Cloudflare R2 / suitable object storage
```

Database should remain a proper PostgreSQL service rather than attempting to use object storage as a database.

---

# 33. ENVIRONMENT MANAGEMENT

Environments:

```text
development
staging/preview
production
```

Example variables:

```text
DATABASE_URL
REDIS_URL
AUTH_SECRET
OTP_PROVIDER_KEY
EMAIL_PROVIDER_KEY
PAYMENT_SECRET
PAYMENT_WEBHOOK_SECRET
R2_ACCESS_KEY
R2_SECRET_KEY
R2_BUCKET
PUBLIC_APP_URL
```

Use `.env.example`, never commit real `.env`.

---

# 34. ADMIN SETTINGS

Admin settings should cover:

- Business name
- Logo
- Contact details
- Currency
- Tax settings
- Delivery fee
- Free delivery threshold
- Minimum order
- Service areas
- Order cancellation rules
- Refund rules
- Notification settings
- Payment settings
- Maintenance mode
- Feature flags

Sensitive settings should require elevated admin permission.

---

# 35. SUPPORT SYSTEM

Customer:

- Create ticket
- Select category
- Order-linked ticket
- Attach image
- View responses
- Close ticket

Admin:

- Ticket queue
- Priority
- Assignment
- SLA
- Internal notes
- Status
- Resolution

Possible categories:

- Payment
- Delivery
- Product
- Refund
- Coupon
- Account
- Vendor
- Other

---

# 36. ANALYTICS EVENTS

Track product/business events:

- page_view
- location_selected
- search
- product_view
- add_to_cart
- remove_from_cart
- checkout_started
- coupon_applied
- payment_started
- payment_success
- order_created
- order_cancelled
- order_delivered
- wishlist_add
- signup
- login

Do not collect unnecessary sensitive personal information.

---

# 37. PERFORMANCE REQUIREMENTS

Target:

- Fast first load
- Optimized images
- Lazy loading
- Server rendering for SEO pages
- Minimal client JavaScript
- Code splitting
- Cached public content
- Efficient DB queries
- Pagination
- Debounced search
- Optimistic UI only where safe

Avoid huge client-side bundles.

---

# 38. PWA REQUIREMENTS

Customer app should support:

- Installable PWA
- App icon
- Splash/theme
- Offline shell
- Network-aware error state
- Push notifications later
- Add-to-home-screen UX

Do not pretend checkout/payment works offline.

---

# 39. ROUTE SECURITY

Public:

```text
/
 /products/*
 /categories/*
 /offers
 /about
```

Authenticated customer:

```text
/account/*
 /orders/*
 /checkout
 /favorites
```

Vendor:

```text
/vendor/*
```

Driver:

```text
/driver/*
```

Admin:

```text
/admin/*
```

Use middleware + server-side permission checks.

---

# 40. DEFINITION OF DONE

A feature is NOT complete merely because the UI works.

It is complete only when:

- UI implemented
- Mobile responsive
- Validation implemented
- Server authorization implemented
- Database logic implemented
- Loading state implemented
- Empty state implemented
- Error state implemented
- Audit/event handling added where required
- Tests added for critical logic
- SEO handled where relevant
- Accessibility checked
- Documentation updated
- No console errors
- No TypeScript errors
- No lint errors
- Production build succeeds

---

# 41. BUILD ORDER

Do NOT build randomly.

Recommended sequence:

### Phase 0 — Discovery

- Existing app audit
- Requirements
- Feature inventory
- URL inventory
- Data inventory

### Phase 1 — Foundation

- GitHub
- Next.js
- TypeScript
- UI system
- Database
- Environment
- Logging
- Error handling

### Phase 2 — Identity

- Auth
- OTP
- Sessions
- Roles
- Permissions
- Profiles

### Phase 3 — Customer core

- Location
- Categories
- Products
- Search
- Wishlist
- Cart

### Phase 4 — Commerce

- Checkout
- Coupons
- Orders
- Payments
- Refunds

### Phase 5 — Vendor

- Onboarding
- Store
- Products
- Inventory
- Orders
- Analytics
- Payouts

### Phase 6 — Driver

- Onboarding
- Availability
- Assignments
- Pickup
- Delivery
- Earnings

### Phase 7 — Admin

- Dashboard
- Users
- Vendors
- Drivers
- Orders
- Catalog
- Marketing
- CMS
- Payments
- Reports
- Settings

### Phase 8 — Growth

- SEO
- Blog
- Push notifications
- Campaign engine
- Referral system
- Reviews
- Loyalty

### Phase 9 — Production

- Security
- Load/performance testing
- Backup
- Monitoring
- Cloudflare
- Domain cutover

---

# 42. FUTURE-READY MODULES

Architecture should leave room for:

- Multi-city expansion
- Multiple stores per vendor
- Delivery slots
- Subscription
- Loyalty points
- Referral program
- Wallet
- Gift cards
- Membership
- Advanced recommendation engine
- AI customer support
- WhatsApp ordering
- Dedicated mobile apps
- Advanced driver routing
- Vendor settlements
- Franchise management

These should NOT be built in V1 unless required. The architecture only needs to avoid blocking them.

---

# 43. KIRO MASTER INSTRUCTION

Kiro should treat this document as the authoritative product specification.

Before implementing a feature:

1. Identify the module.
2. Read relevant architecture rules.
3. Inspect existing implementation.
4. Propose the smallest correct change.
5. Explain database/API/UI impact.
6. Implement.
7. Test.
8. Run typecheck/lint/build.
9. Update docs if required.
10. Report changed files and remaining risks.

If requirements conflict, stop and ask for clarification instead of inventing a rule.

Do not rewrite the whole project for a small feature.

Do not use mock data in production paths.

Do not leave TODO placeholders for core business functionality.

---

# 44. FIRST KIRO EXECUTION PLAN

The first Kiro task should NOT be "build Parthik".

It should be:

```text
TASK 001 — Repository & Architecture Initialization

1. Inspect this master specification.
2. Create the project structure.
3. Initialize Next.js + TypeScript.
4. Configure Tailwind and component system.
5. Configure linting/formatting.
6. Create environment template.
7. Create documentation structure.
8. Create database layer.
9. Create module boundaries.
10. Create authentication architecture placeholders.
11. Create RBAC architecture.
12. Create error/logging conventions.
13. Create test setup.
14. Create README.
15. Do not build customer commerce features yet.
16. Run typecheck, lint and production build.
17. Report all created files.
```

Then:

```text
TASK 002 — Database Schema
TASK 003 — Authentication + RBAC
TASK 004 — Customer Shell + Navigation
TASK 005 — Location & Serviceability
TASK 006 — Catalog
TASK 007 — Search
TASK 008 — Cart
TASK 009 — Checkout
TASK 010 — Orders
TASK 011 — Payments
TASK 012 — Vendor Dashboard
TASK 013 — Driver Dashboard
TASK 014 — Admin Dashboard
TASK 015 — Marketing/CMS
TASK 016 — Notifications
TASK 017 — SEO
TASK 018 — Testing
TASK 019 — Security
TASK 020 — Cloudflare Production
```

---

# 45. FINAL PRODUCT STRUCTURE

The finished Parthik system should conceptually be:

```text
PARTHIK
│
├── Public Website
│   ├── Home
│   ├── Categories
│   ├── Products
│   ├── Offers
│   ├── About
│   ├── Blog
│   ├── FAQ
│   └── Legal
│
├── Customer App/PWA
│   ├── Account
│   ├── Addresses
│   ├── Favorites
│   ├── Cart
│   ├── Checkout
│   ├── Orders
│   └── Tracking
│
├── Vendor Dashboard
│   ├── Store
│   ├── Products
│   ├── Inventory
│   ├── Orders
│   ├── Analytics
│   └── Payouts
│
├── Driver Dashboard
│   ├── Availability
│   ├── Deliveries
│   ├── Navigation
│   ├── Earnings
│   └── History
│
└── Admin Dashboard
    ├── Business
    ├── Customers
    ├── Vendors
    ├── Drivers
    ├── Orders
    ├── Catalog
    ├── Delivery
    ├── Payments
    ├── Marketing
    ├── CMS
    ├── Analytics
    ├── Support
    ├── Settings
    ├── Permissions
    └── Audit Logs
```

## Golden rule

**Build Parthik as a platform, not as a collection of pages.**

Every important feature must have:

**UI → validation → service logic → database → permissions → state transitions → notifications → analytics → auditability → tests.**

The new Parthik should be easier to maintain, easier to extend, faster for customers, safer for operations, and structured so Kiro can work module-by-module without losing the product context.

---

# 46. IMMEDIATE NEXT ACTIONS

1. Backup old Parthik source/database/media.
2. Create GitHub repository.
3. Do NOT point production domain to new app yet.
4. Create Cloudflare account/zone for Parthik.
5. Create development/preview deployment.
6. Start fresh Next.js project.
7. Put this document in `/docs/PARTHIK_MASTER_SPEC.md`.
8. Create `/docs/architecture/`.
9. Create `/docs/database/`.
10. Create `/docs/sops/`.
11. Create Kiro project rules from this specification.
12. Build foundation first.
13. Validate architecture before implementing commerce.
14. Migrate data only after schema mapping.
15. Perform final DNS cutover only after staging/production verification.

**Production cutover rule:** Old Parthik remains available until the new application has passed customer, vendor, driver, admin, payment, order and rollback checks.
