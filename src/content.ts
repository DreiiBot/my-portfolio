// Everything the site says, in one place.

export const person = {
  name: 'Eleandre Sales',
  first: 'Eleandre',
  last: 'Sales',
  role: 'Software developer and IT professional',
  tagline: 'I turn real-world business problems into software that is reliable, intuitive and genuinely useful.',
  email: 'anonymousgenius1999@gmail.com',
  location: 'Based in the Philippines',
  intro: 'Hey, I’m Eleandre. I build business systems and software that connect, automate, and scale.',
  statement: 'Point of sale, procurement, invoicing and AI, built for small businesses and wired together.',
  scope: 'For retail, hospitality, sports facilities, connectivity and education.',
  about: 'I’m Eleandre, a software developer in the Philippines who turns business processes into systems.',
  focusLine: 'Today my focus is clear: systems that work as hard for a business as the people who run it.',
  signOff: ['One point of sale', 'Eleven systems'],
  links: [
    { label: 'GitHub', href: 'https://github.com/DreiiBot' },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/in/eleandre-sales-902194334' },
  ],
}

// The profile spread reads as an interview: each answer is one paragraph of the bio.
export const interview = [
  {
    q: 'What do you build?',
    a: 'Practical, scalable and user-centered software. I develop full-stack web and mobile applications, business management systems, integrations, automation and AI-powered solutions.',
  },
  {
    q: 'How do you approach a new system?',
    a: 'Rather than simply building features, I focus on understanding how a system should work as a whole — from its user experience and business workflows to its backend architecture and integrations. That’s how a POS turned into an ecosystem: inventory, procurement, invoicing, loyalty, booking, connectivity and AI, all designed to work together.',
  },
  {
    q: 'What keeps you curious?',
    a: 'I’m constantly exploring new technologies and improving my skills, with a particular interest in software architecture, AI, automation, and solutions tailored to the businesses and people who use them.',
  },
]

export const focus = [
  'Full-stack web and mobile',
  'Business management systems',
  'Integrations and automation',
  'AI-powered solutions',
  'Software architecture',
]

export const achievements = [
  {
    title: 'Built POSIBLI, a multi-tenant business platform',
    body: 'The center of my work: POS, inventory, loyalty, procurement, ordering, invoicing and integrations for Philippine SMBs, with around 180 permission capability keys and role- and employee-level overrides.',
  },
  {
    title: 'Shipped seven phases of procure-to-pay',
    body: 'InventoNet covers requisition to three-way match and returns, runs as its own backend service, and lets suppliers who are themselves POSIBLI stores quote, accept and ship from their own accounts.',
  },
  {
    title: 'Designed a public Accounts Receivable API',
    body: 'Client-credential auth with short-lived tokens, scopes, store and location limits, idempotency, stable error codes and HMAC-SHA256-signed webhooks with retry and dead-letter handling.',
  },
  {
    title: 'Connected software to physical hardware',
    body: 'Court bookings linked to Dahua, DoLynk and i-Timex door access; a captive-portal WiFi platform on Ruijie/Reyee gateways; license-plate recognition on Nx Witness cameras.',
  },
  {
    title: 'Applied computer vision to vehicle analytics',
    body: 'NeuroNest’s YOLOv8 + ONNX vehicle detection and plate OCR was explored for RPRPrime vehicle analytics in Tacurong, Sultan Kudarat, and an Nx Witness / DICT Region 12 demonstration.',
  },
  {
    title: 'Audited my own platform like an attacker',
    body: 'A full-stack security audit of Picklebook — auth, JWT, RBAC, tenant isolation, payments and public APIs — with Vitest + Supertest regression suites and live exploitation against isolated test tenants.',
  },
]

export interface Part {
  title: string
  body?: string
  items?: string[]
}

export interface System {
  id: string
  name: string
  kind: string
  summary: string
  lead?: string
  parts: Part[]
  steps?: { title: string; list: string[] } // only for content that really is a sequence
  tech: string[]
  next?: string
}

export interface Family {
  name: string
  blurb: string
  systems: System[]
}

export const families: Family[] = [
  {
    name: 'POSIBLI',
    blurb: 'The platform most of my work lives in',
    systems: [
      {
        id: 'posibli',
        name: 'POSIBLI',
        kind: 'Multi-tenant platform',
        summary: 'A multi-tenant retail and business platform for small and medium businesses in the Philippines.',
        lead: 'Point of sale, inventory, loyalty, procurement, invoicing and the integrations that connect them — on MongoDB and PostgreSQL, split across several backend services.',
        parts: [
          { title: 'POS and retail', body: 'Catalog and variants, multi-store checkout, refunds, receipts and cashier operations, plus sales, profitability, executive and inventory-valuation reporting.' },
          { title: 'Inventory', body: 'Inventory ledger, physical counts and adjustments, warehouses and locations, weighted-average costing, bills of materials and bundles. Balances and transactions are mirrored from MongoDB into PostgreSQL.' },
          { title: 'Loyverse sync', body: 'Products, inventory, sales and customer data kept in sync with Loyverse in both directions, including checkout/refund integration and webhook processing.' },
          { title: 'Loyalty', body: 'Points and rewards, loyalty transactions and customer identification, exposed through loyalty APIs that other modules use.' },
          { title: 'Proximity marketing', body: 'Lets businesses use customer and store interaction data to reach customers with targeted engagement.' },
          { title: 'Ordering and integrations', body: 'Ordering workflows, and integration clients with their own API authentication, integration-specific permissions and webhooks for cross-system communication.' },
        ],
        tech: ['Multi-tenant', 'MongoDB', 'PostgreSQL', 'Loyverse', 'Webhooks'],
      },
      {
        id: 'inventonet',
        name: 'InventoNet',
        kind: 'Procurement',
        summary: 'Procurement end to end — my most extensive build, running as its own backend service.',
        lead: 'A purchase moves through twelve steps, each with its own approvals, records and checks.',
        steps: {
          title: 'The twelve steps of a purchase',
          list: ['Requisition', 'Approval', 'RFQ', 'Supplier quotes', 'Evaluate and award', 'Purchase order', 'PO authorization', 'Receiving', 'Supplier invoice', 'Verification', 'Three-way match', 'Returns and credits'],
        },
        parts: [
          { title: 'Approvals and budgets', body: 'Amount-, role- and department-based approval rules. Department and category budgets with commitment tracking, checked at requisition submission and again at PO authorization.' },
          { title: 'Receiving that reflects reality', body: 'Partial receipts; rejected, damaged and missing quantities; batch, serial and expiry tracking; over-receipt tolerance; posting straight into inventory valuation.' },
          { title: 'Suppliers who are also customers', body: 'A supplier that is itself a POSIBLI store quotes, accepts POs, marks them dispatched and submits invoices from its own account, with cross-tenant store linking.' },
          { title: 'Supplier performance', items: ['On-time delivery, quality, responsiveness', 'Composite supplier score', 'Missing metrics handled independently — never counted as zero'] },
          { title: 'Analytics', items: ['Dashboard with KPI tiles', 'Budget summary and exceptions', 'Spend trends', '17 reports with shared filters'] },
        ],
        tech: ['Own backend service', 'Cross-tenant linking', 'Capability keys'],
      },
      {
        id: 'invoicing',
        name: 'Invoicing and receivables',
        kind: 'Invoicing / AR',
        summary: 'Invoices, proformas, credit notes, customer credits and refunds, with totals calculated on the server.',
        lead: 'I also designed an external API so other systems can issue and track invoices — VISTAY’s hotel folios run on it.',
        steps: {
          title: 'How another system connects',
          list: ['Client ID and secret', 'Short-lived access token', 'Scoped to stores and locations', 'Idempotent request', 'Signed webhook', 'Retry', 'Dead-letter'],
        },
        parts: [
          { title: 'Events it sends', items: ['Invoice issued, partially paid, paid', 'Cancelled, voided, credited, refunded', 'Credit note issued', 'Payment completed or reversed', 'Refund completed'] },
        ],
        tech: ['REST APIs', 'Idempotency', 'HMAC-SHA256', 'Webhooks'],
      },
      {
        id: 'kiosk',
        name: 'POSIBLI Kiosk and Admin',
        kind: 'Retail / platform',
        summary: 'Customer-facing kiosk checkout and platform-level tenant administration.',
        parts: [
          { title: 'Kiosk', body: 'Customer-facing checkout, POS workflows, invoice interactions and store operations.' },
          { title: 'Admin', body: 'Platform-level management of tenants, stores and accounts.' },
          { title: 'API and integration services', body: 'Backend services for POSIBLI APIs, external integrations, authentication, webhooks and service-to-service communication — plus an AI integration layer shared with YuAskMe.' },
        ],
        tech: ['Multi-tenant', 'REST APIs', 'Webhooks'],
      },
    ],
  },
  {
    name: 'SynapseGo',
    blurb: 'One app for connected services',
    systems: [
      {
        id: 'synapsego',
        name: 'SynapseGo',
        kind: 'Super app',
        summary: 'One mobile app for connected services, with PIN and biometric sign-in.',
        parts: [
          { title: 'One ecosystem', body: 'Brings Orange Portal, Picklebook, captive-portal WiFi, Prepaid Fibr, Helpdesk and other connected services into a single app.' },
          { title: 'Mobile app', body: 'React Native and Expo with Firebase, Google Sign-In, native modules, Android builds, EAS/iOS testing and WebView-based payment flows.' },
          { title: 'Authentication', body: 'Backend-stored credentials supporting a 6-digit PIN, Face ID and fingerprint biometrics.' },
        ],
        tech: ['React Native', 'Expo', 'EAS', 'Firebase', 'Google Sign-In', 'Biometrics'],
      },
      {
        id: 'picklebook',
        name: 'Picklebook',
        kind: 'Sports facilities',
        summary: 'Pickleball court booking, Open Play, tournaments and facility management.',
        parts: [
          { title: 'Court booking', body: 'Availability, reservations and scheduling with booking quotations, day/night and facility-specific pricing, and booking history.' },
          { title: 'Open Play engine', body: 'Registration, capacity, check-in and queueing, plus a rotation engine — Challenge Court, Mixer and random rotation with court assignment and player balancing. Tested with 16 checked-in players across multiple courts.' },
          { title: 'Tournaments and leaderboards', body: 'Tournament creation, registration and rating-based requirements. Facility, tenant-level and global leaderboards. Exploring DUPR API integration for automatic rating checks.' },
          { title: 'Check-in and door access', body: 'Player, booking and Open Play check-in with QR access workflows, tied to Dahua, DoLynk and i-Timex hardware in both directions.' },
          { title: 'Payments', body: 'PayMongo booking payments with status tracking, webhooks and public booking payment flows.' },
          { title: 'Security audit', body: 'Full-stack audit of authentication, JWT, RBAC, tenant isolation, payments and public APIs, with Vitest + Supertest regression suites.' },
        ],
        tech: ['React', 'JWT', 'RBAC', 'PayMongo', 'Dahua', 'DoLynk', 'i-Timex', 'Vitest', 'Supertest'],
      },
      {
        id: 'orange-portal',
        name: 'Orange Portal',
        kind: 'Connectivity',
        summary: 'Captive-portal WiFi and prepaid internet: pay once, get connected everywhere.',
        parts: [
          { title: 'Connectivity', body: 'A replacement for traditional Piso WiFi, built on Ruijie/Reyee gateways and access points with a WiFiDog captive portal, auth endpoints and redirection.' },
          { title: 'Prepaid Fibr', body: 'Bite-based consumption (₱1 = 1 bite) alongside subscription, unlimited and time-based packages. Paid with PayMongo, GCash and QRPh.' },
          { title: 'Infrastructure', body: 'Domain migration, Nginx, Apache virtual hosts, server configuration, portal deployment and captive-portal routing.' },
        ],
        tech: ['Ruijie / Reyee', 'WiFiDog', 'PayMongo', 'GCash', 'QRPh', 'Nginx', 'Apache'],
      },
    ],
  },
  {
    name: 'YuAskMe and AI',
    blurb: 'Conversational AI and computer vision',
    systems: [
      {
        id: 'yuaskme',
        name: 'YuAskMe',
        kind: 'AI',
        summary: 'A RAG chatbot over each business’s own knowledge, with AI-assisted ordering.',
        steps: {
          title: 'How an answer is grounded',
          list: ['Knowledge ingested per business', 'Retrieval', 'Context passed to the model', 'Grounded answer'],
        },
        parts: [
          { title: 'Conversational AI', body: 'Answers customer questions with business-specific, context-aware responses — not a generic chatbot.' },
          { title: 'Ordering', body: 'Connects the conversation to product and service information, ordering workflows and business-specific actions.' },
          { title: 'Customer app', body: 'A customer-facing app so people can deal with businesses through AI instead of only menus and forms.' },
        ],
        tech: ['Node.js', 'Socket.IO', 'Django REST', 'Pinecone', 'Gemini', 'Expo', 'React Native'],
      },
      {
        id: 'neuronest',
        name: 'NeuroNest',
        kind: 'Computer vision',
        summary: 'License-plate recognition and vehicle analytics on Nx Witness.',
        steps: {
          title: 'From camera to plate',
          list: ['Network cameras', 'Nx Witness and Nx SDK', 'YOLOv8 detection (ONNX)', 'Plate OCR (ONNX)', 'Vehicle and plate association'],
        },
        parts: [
          { title: 'In the field', body: 'Explored for RPRPrime vehicle analytics in Tacurong, Sultan Kudarat, and an Nx Witness / DICT Region 12 demonstration.' },
        ],
        tech: ['YOLOv8', 'ONNX', 'OCR', 'Nx Witness', 'Nx SDK'],
      },
    ],
  },
  {
    name: 'Independent platforms',
    blurb: 'Built for specific industries',
    systems: [
      {
        id: 'vistay',
        name: 'VISTAY',
        kind: 'Hospitality',
        summary: 'Resort and hotel reservations, venues and folios, running on POSIBLI invoicing.',
        parts: [
          { title: 'Reservations', body: 'Room bookings and availability, extensions, inclusive and exclusive booking modes, pricing, add-ons and booking audit trails.' },
          { title: 'Resort-specific logic', body: 'Amenities, event places, pool occupancy and venue scheduling.' },
          { title: 'Folios and invoicing', body: 'Reuses POSIBLI’s invoicing for folios, proformas, final invoices and accounts receivable.' },
          { title: 'AI guest chat', body: 'Connected with YuAskMe for guest chat sessions, with natural-language reservations as a next step.' },
        ],
        tech: ['POSIBLI Invoicing / AR', 'YuAskMe'],
        next: 'Housekeeping boards, maintenance workflows, a guest portal, automated communications and OTA / channel-manager integration.',
      },
      {
        id: 'tally-room',
        name: 'Tally Room',
        kind: 'Education / surveys',
        summary: 'Surveys and mobile student ballots with pooled cross-section analytics.',
        parts: [
          { title: 'Groups and pooling', body: 'One study can span several class sections: responses pool by question text and type, with pooled and per-section results and lagging sections flagged.' },
          { title: 'Student ballot', body: 'Mobile-first and sign-in free — one question per screen, identity collected last, student-ID and email validation, deadline and closed-survey handling.' },
          { title: 'Analytics and AI', body: 'Response summaries, search and pagination, with optional OpenAI summaries. Everything else works without an API key.' },
          { title: 'Data maintenance', body: 'A question-ID repair utility that re-matches disconnected answers, validates mappings and backs up data, with dry-run and explicit apply modes.' },
        ],
        tech: ['REST API', 'OpenAI (optional)'],
      },
    ],
  },
]

export const systemCount = families.reduce((n, f) => n + f.systems.length, 0)

export const tools = [
  { group: 'Backend and data', items: ['Node.js', 'Django REST', 'Socket.IO', 'PostgreSQL', 'MongoDB', 'Prisma', 'REST APIs', 'WebSockets'] },
  { group: 'Frontend and mobile', items: ['React', 'React Native', 'Expo', 'EAS', 'Native modules', 'Biometrics', 'WebViews'] },
  { group: 'AI and vision', items: ['RAG', 'Pinecone', 'Gemini', 'OpenAI', 'YOLOv8', 'ONNX', 'OCR'] },
  { group: 'Infrastructure', items: ['Linux', 'Nginx', 'Apache', 'PM2', 'Captive-portal routing'] },
  { group: 'Integrations', items: ['Loyverse', 'PayMongo', 'GCash', 'QRPh', 'Firebase', 'Dahua', 'DoLynk', 'i-Timex', 'Nx Witness', 'Ruijie / Reyee'] },
  { group: 'Security and testing', items: ['JWT', 'RBAC', 'Tenant isolation', 'Webhook signatures', 'Idempotency', 'Vitest', 'Supertest'] },
]
