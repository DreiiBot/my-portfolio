// Which part of the ecosystem a system belongs to — drives the grouping in the explorer.
export type SystemFamily = 'SynapseGo' | 'YuAskMe & AI' | 'POSIBLI' | 'Independent platforms'

export interface SystemEntry {
  id: string
  name: string
  category: string
  family: SystemFamily
  summary: string
  sections: { title: string; body: string }[]
  tech: string[]
  note?: string
}

export const systemFamilies: { name: SystemFamily; blurb: string }[] = [
  { name: 'SynapseGo', blurb: 'One app for connected services' },
  { name: 'YuAskMe & AI', blurb: 'Conversational AI and computer vision' },
  { name: 'POSIBLI', blurb: 'Platform tools around the core' },
  { name: 'Independent platforms', blurb: 'Built for specific industries' },
]

export const systems: SystemEntry[] = [
  {
    id: 'picklebook',
    name: 'Picklebook',
    category: 'Sports / FMS',
    family: 'SynapseGo',
    summary: 'Pickleball court booking, Open Play, tournaments and facility management',
    sections: [
      {
        title: 'Court booking',
        body: 'Availability, reservations and scheduling with booking quotations, day/night and facility-specific pricing, My Bookings and booking history.',
      },
      {
        title: 'Open Play engine',
        body: 'Registration, capacity, check-in and queueing, plus a rotation engine — Challenge Court, Mixer and random rotation with court assignment and player balancing. Tested with 16 checked-in players across multiple courts.',
      },
      {
        title: 'Tournaments & leaderboards',
        body: 'Tournament creation, registration and rating-based participant requirements. Facility, tenant-level and global leaderboards with game/result tracking. Exploring DUPR API integration for automatic rating checks.',
      },
      {
        title: 'Check-in & physical access',
        body: 'Player, booking and Open Play check-in with QR-related access workflows. Integration work with Dahua, DoLynk and i-Timex to tie bookings to the door — in both directions.',
      },
      {
        title: 'Payments',
        body: 'PayMongo booking payments with payment records, status tracking, webhooks and public booking payment flows.',
      },
      {
        title: 'Security audit',
        body: 'Full-stack audit of authentication, JWT, RBAC, tenant isolation, payments and public APIs. Added Vitest + Supertest regression suites and ran live API exploitation against isolated test tenants.',
      },
    ],
    tech: ['React', 'JWT', 'RBAC', 'PayMongo', 'Dahua', 'DoLynk', 'i-Timex', 'Vitest', 'Supertest'],
  },
  {
    id: 'yuaskme',
    name: 'YuAskMe',
    category: 'AI',
    family: 'YuAskMe & AI',
    summary: 'RAG chatbot over business knowledge bases, with AI-assisted ordering',
    sections: [
      {
        title: 'Conversational AI',
        body: 'Answers customer questions with business-specific, context-aware responses — not a generic chatbot.',
      },
      {
        title: 'RAG knowledge base',
        body: 'Knowledge ingestion per business, retrieval, and retrieved context passed to the model to generate grounded answers.',
      },
      {
        title: 'Ordering',
        body: 'Connects the conversation to product and service information, ordering workflows and business-specific actions.',
      },
      {
        title: 'Customer app',
        body: 'A customer-facing app so people can deal with businesses through AI instead of only menus and forms.',
      },
    ],
    tech: ['Node.js', 'Socket.IO', 'Django REST', 'Pinecone', 'Gemini', 'Expo', 'React Native'],
  },
  {
    id: 'synapsego',
    name: 'SynapseGo',
    category: 'Super app',
    family: 'SynapseGo',
    summary: 'One mobile app for connected services — with PIN and biometric sign-in',
    sections: [
      {
        title: 'One ecosystem',
        body: 'Brings Orange Portal, Picklebook, captive-portal WiFi, Prepaid Fibr, Helpdesk and other connected services into a single app experience.',
      },
      {
        title: 'Mobile app',
        body: 'React Native and Expo with Firebase, Google Sign-In, native modules, Android builds, EAS/iOS testing and WebView-based payment flows.',
      },
      {
        title: 'Authentication',
        body: 'Backend-stored credentials supporting a 6-digit PIN, Face ID and fingerprint biometrics.',
      },
    ],
    tech: ['React Native', 'Expo', 'EAS', 'Firebase', 'Google Sign-In', 'Biometrics', 'WebViews'],
  },
  {
    id: 'orange-portal',
    name: 'Orange Portal',
    category: 'Connectivity',
    family: 'SynapseGo',
    summary: 'Captive-portal WiFi and prepaid internet — “pay once, get connected everywhere”',
    sections: [
      {
        title: 'Connectivity',
        body: 'A replacement for traditional Piso WiFi, built on Ruijie/Reyee gateways and access points with a WiFiDog captive portal, auth endpoints and redirection.',
      },
      {
        title: 'Payments',
        body: 'PayMongo, GCash and QRPh.',
      },
      {
        title: 'Prepaid Fibr',
        body: 'Bite-based consumption (₱1 = 1 bite) alongside subscription, unlimited and time-based packages.',
      },
      {
        title: 'Infrastructure',
        body: 'Domain migration, Nginx, Apache virtual hosts, server configuration, portal deployment and captive-portal routing.',
      },
    ],
    tech: ['Ruijie / Reyee', 'WiFiDog', 'PayMongo', 'GCash', 'QRPh', 'Nginx', 'Apache'],
  },
  {
    id: 'vistay',
    name: 'VISTAY',
    category: 'Hospitality',
    family: 'Independent platforms',
    summary: 'Resort and hotel reservations, venues and folios on POSIBLI invoicing',
    sections: [
      {
        title: 'Reservations',
        body: 'Room bookings and availability, booking extensions, inclusive/exclusive booking modes, pricing, add-ons, proforma information and booking audit trails.',
      },
      {
        title: 'Resort-specific logic',
        body: 'Amenities, event places, pool occupancy and venue scheduling.',
      },
      {
        title: 'Folio & invoicing',
        body: 'Reuses POSIBLI’s invoicing infrastructure for folios, proformas, final invoices and accounts receivable.',
      },
      {
        title: 'AI guest chat',
        body: 'Connected with YuAskMe for AI guest chatbot sessions, with natural-language reservations as a next step.',
      },
    ],
    tech: ['POSIBLI Invoicing / AR', 'YuAskMe'],
    note: 'Next: housekeeping boards, maintenance workflows, guest portal, automated communications, OTA / channel-manager integration.',
  },
  {
    id: 'neuronest',
    name: 'NeuroNest',
    category: 'Computer vision',
    family: 'YuAskMe & AI',
    summary: 'License-plate recognition and vehicle analytics on Nx Witness',
    sections: [
      {
        title: 'Video surveillance',
        body: 'Nx Witness and the Nx SDK over network cameras and live video streams.',
      },
      {
        title: 'Detection',
        body: 'YOLOv8 models run with ONNX for custom vehicle detection and classification.',
      },
      {
        title: 'OCR',
        body: 'ONNX-based OCR models for license-plate recognition and vehicle/plate association.',
      },
      {
        title: 'In the field',
        body: 'Explored for RPRPrime vehicle analytics in Tacurong, Sultan Kudarat, and an Nx Witness / DICT Region 12 demonstration.',
      },
    ],
    tech: ['YOLOv8', 'ONNX', 'OCR', 'Nx Witness', 'Nx SDK'],
  },
  {
    id: 'tally-room',
    name: 'Tally Room',
    category: 'Education / Survey',
    family: 'Independent platforms',
    summary: 'Surveys and mobile student ballots with pooled cross-section analytics',
    sections: [
      {
        title: 'Groups & pooling',
        body: 'One study can span several class sections: responses pool by question text and type, with pooled and per-section results and lagging sections flagged. Pooling never crosses accounts.',
      },
      {
        title: 'Student ballot',
        body: 'Mobile-first and sign-in free — one question per screen, identity collected last, student-ID and email validation, large answer targets, deadline and closed-survey handling.',
      },
      {
        title: 'Analytics & AI',
        body: 'Response summaries, search and pagination, with optional OpenAI summaries. Everything else works without an API key.',
      },
      {
        title: 'Design system',
        body: '“Tally Room”: Archivo for data, Literata for user-written content, ruled rows instead of card grids, colorblind-aware comparisons, reduced-motion support, automatic dark mode and a ⌘K command menu.',
      },
      {
        title: 'Data maintenance',
        body: 'A question-ID repair utility that detects disconnected responses, re-matches answers by position, validates mappings and backs up data — with dry-run and explicit apply modes.',
      },
    ],
    tech: ['REST API', 'OpenAI (optional)', 'Design system'],
  },
  {
    id: 'posibli-kiosk-admin',
    name: 'POSIBLI Kiosk & Admin',
    category: 'Retail / Platform',
    family: 'POSIBLI',
    summary: 'Customer-facing kiosk checkout and platform-level tenant administration',
    sections: [
      {
        title: 'Kiosk',
        body: 'Customer-facing checkout, POS workflows, invoice interactions and store operations.',
      },
      {
        title: 'Admin',
        body: 'Platform-level management of tenants, stores and accounts.',
      },
      {
        title: 'API & integration services',
        body: 'Backend services for POSIBLI APIs, external integrations, authentication, webhooks and service-to-service communication — plus a dedicated AI integration layer shared with YuAskMe.',
      },
    ],
    tech: ['Multi-tenant', 'REST APIs', 'Webhooks'],
  },
]
