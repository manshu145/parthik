import { Link } from '@/i18n/navigation';
type Locale = 'en' | 'hi';

type MarketingSlug =
  | 'about'
  | 'contact'
  | 'faq'
  | 'careers'
  | 'blog'
  | 'privacy'
  | 'terms'
  | 'refund-policy'
  | 'shipping-policy'
  | 'cancellation-policy'
  | 'vendor-registration'
  | 'driver-registration';

type Section = {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
};

type PageCopy = {
  intro: string;
  sections: Section[];
  cta?: { label: string; href: string; note?: string };
};

const COPY: Record<MarketingSlug, Record<Locale, PageCopy>> = {
  about: {
    en: {
      intro:
        'Parthik is a hyperlocal commerce and delivery platform built to connect customers with nearby stores and delivery partners.',
      sections: [
        {
          heading: 'What we do',
          bullets: [
            'Local product discovery and ordering',
            'Store and inventory operations for vendors',
            'Delivery assignment and tracking for delivery partners',
            'English and Hindi customer experience',
          ],
        },
        {
          heading: 'How Parthik works',
          paragraphs: [
            'Customers choose a serviceable location, browse available products, place an order and follow its fulfilment. Vendors manage catalog, stock and orders, while delivery partners handle assigned deliveries.',
          ],
        },
      ],
    },
    hi: {
      intro:
        'Parthik एक hyperlocal commerce और delivery platform है जो ग्राहकों को नज़दीकी stores और delivery partners से जोड़ता है।',
      sections: [
        {
          heading: 'हम क्या करते हैं',
          bullets: [
            'स्थानीय products की खोज और ordering',
            'Vendors के लिए store और inventory operations',
            'Delivery partners के लिए assignment और tracking',
            'English और Hindi customer experience',
          ],
        },
        {
          heading: 'Parthik कैसे काम करता है',
          paragraphs: [
            'ग्राहक serviceable location चुनते हैं, उपलब्ध products देखते हैं, order place करते हैं और fulfilment track करते हैं। Vendors catalog, stock और orders manage करते हैं और delivery partners assigned deliveries संभालते हैं।',
          ],
        },
      ],
    },
  },
  contact: {
    en: {
      intro:
        'Need help with an order, account, vendor application or delivery-partner account? Use the support area after signing in so we can connect your request to the correct account.',
      sections: [
        {
          heading: 'Customer support',
          paragraphs: [
            'For order, payment, refund or account issues, sign in and open Support from your account.',
          ],
        },
        {
          heading: 'Business and partner enquiries',
          paragraphs: [
            'Vendor and delivery-partner onboarding can be started from the partner pages below.',
          ],
        },
      ],
      cta: {
        label: 'Open account support',
        href: '/account/support',
        note: 'Sign-in may be required.',
      },
    },
    hi: {
      intro:
        'Order, account, vendor application या delivery-partner account में मदद चाहिए? Sign in करने के बाद Support खोलें ताकि request सही account से जुड़ सके।',
      sections: [
        {
          heading: 'Customer support',
          paragraphs: [
            'Order, payment, refund या account issue के लिए sign in करके Account में Support खोलें।',
          ],
        },
        {
          heading: 'Business और partner enquiries',
          paragraphs: [
            'Vendor और delivery-partner onboarding partner pages से शुरू किया जा सकता है।',
          ],
        },
      ],
      cta: {
        label: 'Account support खोलें',
        href: '/account/support',
        note: 'Sign-in आवश्यक हो सकता है।',
      },
    },
  },
  faq: {
    en: {
      intro: 'Quick answers to common questions about ordering and delivery on Parthik.',
      sections: [
        {
          heading: 'How do I know if Parthik delivers to me?',
          paragraphs: [
            'Select your delivery location. The catalogue and delivery options are shown according to serviceability.',
          ],
        },
        {
          heading: 'Which payment methods are supported?',
          paragraphs: [
            'Available payment methods are shown at checkout. Cash on delivery can be offered by eligible stores; online payments depend on the configured payment provider.',
          ],
        },
        {
          heading: 'How can I cancel an order?',
          paragraphs: [
            'Cancellation availability depends on the current order stage and the applicable cancellation rules. Open the order details to see available actions.',
          ],
        },
        {
          heading: 'How do refunds work?',
          paragraphs: [
            'Eligible refunds are processed according to the refund policy and the original payment method where applicable.',
          ],
        },
      ],
    },
    hi: {
      intro: 'Parthik पर ordering और delivery से जुड़े सामान्य सवालों के जवाब।',
      sections: [
        {
          heading: 'क्या Parthik मेरे location पर deliver करता है?',
          paragraphs: [
            'अपना delivery location चुनें। Catalogue और delivery options serviceability के अनुसार दिखेंगे।',
          ],
        },
        {
          heading: 'कौन से payment methods उपलब्ध हैं?',
          paragraphs: [
            'Available payment methods checkout पर दिखते हैं। Eligible stores COD दे सकते हैं; online payment configured payment provider पर निर्भर है।',
          ],
        },
        {
          heading: 'Order cancel कैसे करें?',
          paragraphs: [
            'Cancellation current order stage और लागू cancellation rules पर निर्भर करती है। Available actions order details में दिखेंगे।',
          ],
        },
        {
          heading: 'Refund कैसे मिलता है?',
          paragraphs: [
            'Eligible refund refund policy के अनुसार और जहाँ लागू हो original payment method पर process किया जाता है।',
          ],
        },
      ],
    },
  },
  careers: {
    en: {
      intro: 'We are building Parthik across commerce, logistics and local operations.',
      sections: [
        {
          heading: 'Open roles',
          paragraphs: [
            'There are no public openings listed right now. When roles are published, this page will include the role, location, responsibilities and application instructions.',
          ],
        },
        {
          heading: 'Delivery opportunities',
          paragraphs: [
            'If you want to work as an independent delivery partner, use the delivery-partner registration page instead of the careers route.',
          ],
        },
      ],
      cta: { label: 'Become a delivery partner', href: '/driver-registration' },
    },
    hi: {
      intro: 'हम Parthik को commerce, logistics और local operations के लिए बना रहे हैं।',
      sections: [
        {
          heading: 'Open roles',
          paragraphs: [
            'अभी कोई public opening listed नहीं है। Roles publish होने पर role, location, responsibilities और application instructions यहाँ दिखेंगे।',
          ],
        },
        {
          heading: 'Delivery opportunities',
          paragraphs: [
            'Independent delivery partner के रूप में जुड़ने के लिए Careers की बजाय delivery-partner registration page इस्तेमाल करें।',
          ],
        },
      ],
      cta: { label: 'Delivery partner बनें', href: '/driver-registration' },
    },
  },
  blog: {
    en: {
      intro: 'Parthik product, service and partner updates.',
      sections: [
        {
          heading: 'Updates',
          paragraphs: [
            'Operational announcements, product changes and customer guidance will be published here when available.',
          ],
        },
      ],
    },
    hi: {
      intro: 'Parthik के product, service और partner updates।',
      sections: [
        {
          heading: 'Updates',
          paragraphs: [
            'Operational announcements, product changes और customer guidance उपलब्ध होने पर यहाँ publish किए जाएंगे।',
          ],
        },
      ],
    },
  },
  privacy: {
    en: {
      intro:
        'This privacy policy explains the categories of information Parthik may process when you use the service.',
      sections: [
        {
          heading: 'Information we process',
          bullets: [
            'Account details such as name and phone number',
            'Delivery addresses and location information you provide',
            'Orders, payments, refunds and support interactions',
            'Device, security and service-usage information needed to operate and protect the platform',
          ],
        },
        {
          heading: 'How information is used',
          bullets: [
            'Provide and fulfil orders',
            'Authenticate accounts and prevent misuse',
            'Process payments and refunds',
            'Provide support and improve service reliability',
            'Meet legal and regulatory obligations',
          ],
        },
        {
          heading: 'Sharing',
          paragraphs: [
            'Information may be shared with relevant vendors, delivery partners and service providers only as needed to provide the service, process payments, prevent fraud or comply with law.',
          ],
        },
        {
          heading: 'Your choices',
          paragraphs: [
            'You can update profile and saved-address information from your account. For privacy-related requests, use Account Support.',
          ],
        },
      ],
    },
    hi: {
      intro:
        'यह privacy policy बताती है कि Parthik service इस्तेमाल करते समय किन प्रकार की जानकारी process कर सकता है।',
      sections: [
        {
          heading: 'हम कौन सी जानकारी process करते हैं',
          bullets: [
            'नाम और phone जैसी account details',
            'आपके द्वारा दिए गए delivery addresses और location information',
            'Orders, payments, refunds और support interactions',
            'Platform चलाने और सुरक्षित रखने के लिए device, security और usage information',
          ],
        },
        {
          heading: 'जानकारी का उपयोग',
          bullets: [
            'Orders provide और fulfil करना',
            'Accounts authenticate करना और misuse रोकना',
            'Payments और refunds process करना',
            'Support देना और reliability सुधारना',
            'Legal और regulatory obligations पूरा करना',
          ],
        },
        {
          heading: 'Sharing',
          paragraphs: [
            'Service देने, payments process करने, fraud रोकने या कानून का पालन करने के लिए आवश्यक जानकारी relevant vendors, delivery partners और service providers के साथ साझा की जा सकती है।',
          ],
        },
        {
          heading: 'आपके विकल्प',
          paragraphs: [
            'Profile और saved addresses account से update किए जा सकते हैं। Privacy request के लिए Account Support इस्तेमाल करें।',
          ],
        },
      ],
    },
  },
  terms: {
    en: {
      intro:
        'These terms govern use of the Parthik platform and its customer, vendor and delivery-partner services.',
      sections: [
        {
          heading: 'Using the service',
          paragraphs: [
            'You must provide accurate information, keep your account secure and use the platform only for lawful purposes.',
          ],
        },
        {
          heading: 'Orders and availability',
          paragraphs: [
            'Product availability, pricing, delivery times and serviceability can change. An order is subject to confirmation and the applicable store, inventory and fulfilment conditions.',
          ],
        },
        {
          heading: 'Payments',
          paragraphs: [
            'Charges shown at checkout may include product price, delivery charges, taxes or other disclosed fees. Payment options depend on the order and configured providers.',
          ],
        },
        {
          heading: 'Cancellations and refunds',
          paragraphs: [
            'Cancellations and refunds are governed by the applicable cancellation and refund policies and the order state.',
          ],
        },
        {
          heading: 'Platform misuse',
          paragraphs: [
            'Fraud, abuse, attempts to bypass security, harmful content or interference with platform operation may result in restriction or suspension.',
          ],
        },
      ],
    },
    hi: {
      intro:
        'ये terms Parthik platform और उसके customer, vendor और delivery-partner services के उपयोग पर लागू होते हैं।',
      sections: [
        {
          heading: 'Service का उपयोग',
          paragraphs: [
            'सही जानकारी दें, account सुरक्षित रखें और platform का उपयोग केवल lawful purposes के लिए करें।',
          ],
        },
        {
          heading: 'Orders और availability',
          paragraphs: [
            'Product availability, pricing, delivery time और serviceability बदल सकते हैं। Order confirmation और applicable store, inventory व fulfilment conditions पर निर्भर है।',
          ],
        },
        {
          heading: 'Payments',
          paragraphs: [
            'Checkout पर product price, delivery charge, taxes या अन्य disclosed fees शामिल हो सकते हैं। Payment options order और configured providers पर निर्भर करते हैं।',
          ],
        },
        {
          heading: 'Cancellation और refund',
          paragraphs: [
            'Cancellation और refund applicable policies और order state के अनुसार होते हैं।',
          ],
        },
        {
          heading: 'Platform misuse',
          paragraphs: [
            'Fraud, abuse, security bypass attempts या platform operation में interference पर account restrict या suspend किया जा सकता है।',
          ],
        },
      ],
    },
  },
  'refund-policy': {
    en: {
      intro:
        'Refund eligibility depends on the order, payment status, cancellation outcome and issue reported.',
      sections: [
        {
          heading: 'When a refund may apply',
          bullets: [
            'Eligible cancelled prepaid orders',
            'Confirmed missing or unavailable items',
            'Approved payment or fulfilment corrections',
            'Other cases approved under the applicable order policy',
          ],
        },
        {
          heading: 'Refund method',
          paragraphs: [
            'Where an online payment is refunded, the refund is normally initiated to the applicable original payment route. Bank or payment-provider settlement time can vary.',
          ],
        },
        {
          heading: 'Non-refundable amounts',
          paragraphs: [
            'Some charges may be non-refundable once a service has been completed or where policy conditions are not met. The order detail and support outcome are the source of truth for a specific case.',
          ],
        },
      ],
    },
    hi: {
      intro:
        'Refund eligibility order, payment status, cancellation outcome और reported issue पर निर्भर करती है।',
      sections: [
        {
          heading: 'Refund कब लागू हो सकता है',
          bullets: [
            'Eligible cancelled prepaid orders',
            'Confirmed missing या unavailable items',
            'Approved payment या fulfilment corrections',
            'Applicable order policy के अंतर्गत approved cases',
          ],
        },
        {
          heading: 'Refund method',
          paragraphs: [
            'Online payment refund applicable original payment route पर initiate किया जाता है। Bank या payment-provider settlement time अलग हो सकता है।',
          ],
        },
        {
          heading: 'Non-refundable amounts',
          paragraphs: [
            'Service पूरा हो जाने या policy conditions पूरी न होने पर कुछ charges non-refundable हो सकते हैं। Specific order के लिए order detail और support outcome final reference हैं।',
          ],
        },
      ],
    },
  },
  'shipping-policy': {
    en: {
      intro: 'Parthik provides hyperlocal delivery from participating stores in serviceable areas.',
      sections: [
        {
          heading: 'Serviceability',
          paragraphs: [
            'Delivery availability is determined by the selected location, delivery zone, store status and operational capacity.',
          ],
        },
        {
          heading: 'Delivery estimates',
          paragraphs: [
            'Any delivery time shown is an estimate. Preparation time, traffic, weather, demand and operational conditions can affect arrival time.',
          ],
        },
        {
          heading: 'Receiving an order',
          paragraphs: [
            'Keep the delivery address and phone details accurate and be available to receive the order. Some deliveries may require verification before handover.',
          ],
        },
      ],
    },
    hi: {
      intro:
        'Parthik serviceable areas में participating stores से hyperlocal delivery प्रदान करता है।',
      sections: [
        {
          heading: 'Serviceability',
          paragraphs: [
            'Delivery availability selected location, delivery zone, store status और operational capacity पर निर्भर करती है।',
          ],
        },
        {
          heading: 'Delivery estimates',
          paragraphs: [
            'दिखाया गया delivery time estimate है। Preparation, traffic, weather, demand और operations arrival time बदल सकते हैं।',
          ],
        },
        {
          heading: 'Order receive करना',
          paragraphs: [
            'Delivery address और phone details सही रखें और order receive करने के लिए available रहें। कुछ deliveries में handover से पहले verification हो सकती है।',
          ],
        },
      ],
    },
  },
  'cancellation-policy': {
    en: {
      intro:
        'Cancellation depends on the current order state and the cancellation rules configured for that order.',
      sections: [
        {
          heading: 'Before fulfilment progresses',
          paragraphs: [
            'A cancellation option may be available while the order is still within an allowed stage.',
          ],
        },
        {
          heading: 'After preparation or dispatch',
          paragraphs: [
            'Cancellation may be restricted once preparation, pickup or delivery has progressed because inventory, partner time and delivery costs may already have been committed.',
          ],
        },
        {
          heading: 'Refund after cancellation',
          paragraphs: [
            'If a prepaid cancellation qualifies for a refund, the applicable refund process begins according to the refund policy.',
          ],
        },
      ],
    },
    hi: {
      intro:
        'Cancellation current order state और उस order पर configured cancellation rules पर निर्भर करती है।',
      sections: [
        {
          heading: 'Fulfilment आगे बढ़ने से पहले',
          paragraphs: ['Allowed stage में order होने पर cancellation option उपलब्ध हो सकता है।'],
        },
        {
          heading: 'Preparation या dispatch के बाद',
          paragraphs: [
            'Preparation, pickup या delivery आगे बढ़ने पर cancellation restricted हो सकती है क्योंकि inventory, partner time और delivery cost commit हो चुके हो सकते हैं।',
          ],
        },
        {
          heading: 'Cancellation के बाद refund',
          paragraphs: [
            'Prepaid cancellation refund के लिए eligible होने पर refund policy के अनुसार process शुरू होता है।',
          ],
        },
      ],
    },
  },
  'vendor-registration': {
    en: {
      intro:
        'Sell through Parthik and manage your store, catalogue, inventory and orders from the vendor dashboard.',
      sections: [
        {
          heading: 'What you will need',
          bullets: [
            'An active Parthik account',
            'Business and store information',
            'Required KYC and compliance documents',
            'Product, inventory and fulfilment information',
          ],
        },
        {
          heading: 'Review process',
          paragraphs: [
            'Vendor access is activated after the required business and KYC checks are completed. Approval status is visible from the vendor onboarding area.',
          ],
        },
      ],
      cta: { label: 'Sign in to start vendor onboarding', href: '/login?next=/vendor/onboarding' },
    },
    hi: {
      intro:
        'Parthik पर sell करें और vendor dashboard से store, catalogue, inventory और orders manage करें।',
      sections: [
        {
          heading: 'क्या चाहिए',
          bullets: [
            'Active Parthik account',
            'Business और store information',
            'Required KYC और compliance documents',
            'Product, inventory और fulfilment information',
          ],
        },
        {
          heading: 'Review process',
          paragraphs: [
            'Required business और KYC checks पूरे होने के बाद vendor access activate होता है। Approval status vendor onboarding area में दिखता है।',
          ],
        },
      ],
      cta: { label: 'Vendor onboarding शुरू करें', href: '/login?next=/vendor/onboarding' },
    },
  },
  'driver-registration': {
    en: {
      intro:
        'Join Parthik as a delivery partner and manage availability, assigned deliveries, delivery progress and earnings from the driver dashboard.',
      sections: [
        {
          heading: 'What you will need',
          bullets: [
            'An active Parthik account',
            'Identity and KYC details',
            'Eligible vehicle information where required',
            'A serviceable operating area',
          ],
        },
        {
          heading: 'Approval',
          paragraphs: [
            'Delivery access is enabled after the required profile and KYC checks. Your onboarding status is shown in the driver dashboard.',
          ],
        },
      ],
      cta: { label: 'Sign in to start driver onboarding', href: '/login?next=/driver/onboarding' },
    },
    hi: {
      intro:
        'Parthik delivery partner बनें और driver dashboard से availability, assigned deliveries, delivery progress और earnings manage करें।',
      sections: [
        {
          heading: 'क्या चाहिए',
          bullets: [
            'Active Parthik account',
            'Identity और KYC details',
            'जहाँ आवश्यक हो eligible vehicle information',
            'Serviceable operating area',
          ],
        },
        {
          heading: 'Approval',
          paragraphs: [
            'Required profile और KYC checks के बाद delivery access enable होता है। Onboarding status driver dashboard में दिखता है।',
          ],
        },
      ],
      cta: { label: 'Driver onboarding शुरू करें', href: '/login?next=/driver/onboarding' },
    },
  },
};

export function DefaultMarketingContent({ slug, locale }: { slug: MarketingSlug; locale: string }) {
  const selectedLocale: Locale = locale === 'hi' ? 'hi' : 'en';
  const page = COPY[slug][selectedLocale];

  return (
    <div className="mx-auto max-w-3xl space-y-8" data-testid="marketing-default-content">
      <p className="text-muted-foreground text-base leading-7">{page.intro}</p>

      {page.sections.map((section) => (
        <section key={section.heading} className="space-y-3">
          <h2 className="text-lg font-semibold">{section.heading}</h2>
          {section.paragraphs?.map((paragraph) => (
            <p key={paragraph} className="text-muted-foreground leading-7">
              {paragraph}
            </p>
          ))}
          {section.bullets ? (
            <ul className="text-muted-foreground list-disc space-y-2 pl-5 leading-7">
              {section.bullets.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}

      {page.cta ? (
        <div className="border-border rounded-xl border p-5">
          <Link
            href={page.cta.href}
            className="bg-primary text-primary-foreground inline-flex min-h-11 items-center rounded-lg px-4 py-2 text-sm font-medium"
          >
            {page.cta.label}
          </Link>
          {page.cta.note ? (
            <p className="text-muted-foreground mt-2 text-xs">{page.cta.note}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
