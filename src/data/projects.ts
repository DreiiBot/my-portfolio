// One list of every system shown in the Work gallery.
// POSIBLI's copy comes from the former featured section; the rest comes from systems.ts unchanged.
import { inventonet, invoicing, posibli, procurementPipeline } from './flagship'
import { systemFamilies, systems } from './systems'
import type { SystemFamily } from './systems'

export type Family = SystemFamily

export interface Section {
  title: string
  body?: string
  kicker?: string
  items?: string[]
}

export interface Tier {
  label: string
  nodes: string[]
}

export type Diagram =
  | { kind: 'tiers'; title: string; tiers: Tier[] }
  | { kind: 'flow'; title: string; steps: string[] }

export interface Project {
  id: string
  name: string
  family: Family
  category: string
  summary: string
  lead?: string
  meta?: string
  sections: Section[]
  more?: { label: string; sections: Section[] }
  tech: string[]
  note?: string
  diagrams?: Diagram[]
  flagship?: boolean
}

const sys = (id: string) => {
  const s = systems.find((x) => x.id === id)
  if (!s) throw new Error(`Unknown system ${id}`)
  return s
}

const fromSystem = (id: string, diagrams?: Diagram[]): Project => {
  const s = sys(id)
  return { ...s, sections: s.sections, diagrams }
}

export const projects: Project[] = [
  {
    id: 'posibli',
    name: 'POSIBLI',
    family: 'POSIBLI',
    category: 'Multi-tenant platform',
    flagship: true,
    summary: 'A multi-tenant retail and business platform for small and medium businesses in the Philippines.',
    lead: 'Most of my work lives here: point of sale, inventory, loyalty, procurement, invoicing and the integrations that connect them.',
    meta: 'MongoDB and PostgreSQL, split across several backend services',
    sections: posibli.modules.map((m) => ({ kicker: m.label, title: m.title, body: m.body })),
    tech: ['Multi-tenant', 'MongoDB', 'PostgreSQL', 'Loyverse', 'Webhooks'],
    diagrams: [
      {
        kind: 'tiers',
        title: 'How the platform is put together',
        tiers: [
          { label: 'Modules', nodes: posibli.modules.map((m) => m.label) },
          { label: 'Services', nodes: ['Several backend services', 'InventoNet (own service)', 'Invoicing / AR API'] },
          { label: 'Data', nodes: ['MongoDB', 'PostgreSQL (mirrored balances and transactions)'] },
          { label: 'Integrations', nodes: ['Loyverse (two-way sync)', 'Integration clients', 'Webhooks'] },
        ],
      },
    ],
  },
  {
    id: 'inventonet',
    name: 'InventoNet',
    family: 'POSIBLI',
    category: 'Procurement',
    summary: 'Procurement, end to end',
    lead: 'My most extensive build. InventoNet is the procurement side of POSIBLI and runs as its own backend service. A purchase moves through twelve steps, each with its own approvals, records and checks.',
    sections: inventonet.highlights,
    more: {
      label: 'the rest of InventoNet',
      sections: inventonet.more.map((g) => ({ title: g.title, items: g.items })),
    },
    tech: ['Own backend service', 'Cross-tenant linking', 'Capability keys'],
    diagrams: [{ kind: 'flow', title: 'The twelve steps of a purchase', steps: procurementPipeline }],
  },
  {
    id: 'invoicing',
    name: 'Invoicing and receivables',
    family: 'POSIBLI',
    category: 'Invoicing / AR',
    summary: 'Invoices, proformas, credit notes, customer credits and refunds, with totals calculated on the server.',
    lead: 'I also designed an external API so other systems can issue and track invoices — VISTAY’s hotel folios run on it.',
    sections: [
      {
        title: 'How other systems connect',
        items: [
          'Client ID and secret, exchanged for short-lived access tokens',
          'Scopes, limited to specific stores and locations',
          'Idempotent requests and stable error codes',
          'Webhooks signed with HMAC-SHA256, retried, then dead-lettered',
        ],
      },
      { title: 'Events it sends', items: invoicing.eventLabels },
    ],
    tech: ['REST APIs', 'Idempotency', 'Webhook signatures', 'HMAC-SHA256'],
    diagrams: [
      {
        kind: 'flow',
        title: 'How other systems connect',
        steps: ['Client ID and secret', 'Short-lived access token', 'Scoped to stores and locations', 'Idempotent request', 'Signed webhook', 'Retry', 'Dead-letter'],
      },
    ],
  },
  fromSystem('posibli-kiosk-admin', [
    {
      kind: 'tiers',
      title: 'Where it sits',
      tiers: [
        { label: 'Frontend', nodes: ['Kiosk', 'Admin'] },
        { label: 'Services', nodes: ['POSIBLI APIs', 'Authentication', 'Webhooks', 'Service-to-service communication'] },
        { label: 'Integrations', nodes: ['External integrations', 'AI integration layer (shared with YuAskMe)'] },
      ],
    },
  ]),
  fromSystem('picklebook', [
    {
      kind: 'tiers',
      title: 'What it connects to',
      tiers: [
        { label: 'Frontend', nodes: ['React'] },
        { label: 'Security', nodes: ['JWT', 'RBAC', 'Tenant isolation'] },
        { label: 'Payments', nodes: ['PayMongo', 'Webhooks'] },
        { label: 'Physical access', nodes: ['Dahua', 'DoLynk', 'i-Timex'] },
        { label: 'Testing', nodes: ['Vitest', 'Supertest'] },
      ],
    },
  ]),
  fromSystem('yuaskme', [
    {
      kind: 'flow',
      title: 'How an answer is grounded',
      steps: ['Knowledge ingestion per business', 'Retrieval', 'Context passed to the model', 'Grounded answer'],
    },
    {
      kind: 'tiers',
      title: 'Built with',
      tiers: [
        { label: 'Customer app', nodes: ['Expo', 'React Native'] },
        { label: 'Backend', nodes: ['Node.js', 'Socket.IO', 'Django REST'] },
        { label: 'AI services', nodes: ['Pinecone', 'Gemini'] },
      ],
    },
  ]),
  fromSystem('synapsego', [
    {
      kind: 'tiers',
      title: 'One app, many services',
      tiers: [
        { label: 'Mobile app', nodes: ['React Native', 'Expo', 'EAS', 'Native modules'] },
        { label: 'Sign-in', nodes: ['Firebase', 'Google Sign-In', '6-digit PIN', 'Face ID', 'Fingerprint'] },
        { label: 'Services', nodes: ['Orange Portal', 'Picklebook', 'Captive-portal WiFi', 'Prepaid Fibr', 'Helpdesk'] },
      ],
    },
  ]),
  fromSystem('orange-portal', [
    {
      kind: 'tiers',
      title: 'From access point to payment',
      tiers: [
        { label: 'Network', nodes: ['Ruijie / Reyee gateways', 'Access points'] },
        { label: 'Portal', nodes: ['WiFiDog captive portal', 'Auth endpoints', 'Redirection'] },
        { label: 'Payments', nodes: ['PayMongo', 'GCash', 'QRPh'] },
        { label: 'Servers', nodes: ['Nginx', 'Apache virtual hosts'] },
      ],
    },
  ]),
  fromSystem('vistay', [
    {
      kind: 'tiers',
      title: 'What it reuses',
      tiers: [
        { label: 'VISTAY', nodes: ['Reservations', 'Resort-specific logic'] },
        { label: 'POSIBLI', nodes: ['Folios', 'Proformas', 'Final invoices', 'Accounts receivable'] },
        { label: 'YuAskMe', nodes: ['AI guest chatbot sessions'] },
      ],
    },
  ]),
  fromSystem('neuronest', [
    {
      kind: 'flow',
      title: 'From camera to plate',
      steps: ['Network cameras', 'Nx Witness + Nx SDK', 'YOLOv8 detection (ONNX)', 'Plate OCR (ONNX)', 'Vehicle / plate association'],
    },
  ]),
  fromSystem('tally-room'),
]

export const families = systemFamilies.map((f) => ({
  ...f,
  count: projects.filter((p) => p.family === f.name).length,
}))

export const familySlug: Record<Family, string> = {
  POSIBLI: 'posibli',
  SynapseGo: 'synapse',
  'YuAskMe & AI': 'ai',
  'Independent platforms': 'independent',
}

export const getProject = (id: string) => projects.find((p) => p.id === id)

// Relationships stated in the project copy. Used by the ecosystem map.
export const links: { from: string; to: string; label: string }[] = [
  { from: 'inventonet', to: 'posibli', label: 'The procurement side of POSIBLI' },
  { from: 'invoicing', to: 'posibli', label: 'POSIBLI’s invoicing infrastructure' },
  { from: 'posibli-kiosk-admin', to: 'posibli', label: 'Kiosk checkout and tenant admin' },
  { from: 'posibli-kiosk-admin', to: 'yuaskme', label: 'Shares an AI integration layer' },
  { from: 'vistay', to: 'invoicing', label: 'Folios run on the AR API' },
  { from: 'vistay', to: 'yuaskme', label: 'AI guest chat' },
  { from: 'synapsego', to: 'picklebook', label: 'Brought into one app' },
  { from: 'synapsego', to: 'orange-portal', label: 'Brought into one app' },
]

export const externals: { id: string; label: string; to: string[] }[] = [
  { id: 'loyverse', label: 'Loyverse', to: ['posibli'] },
  { id: 'access', label: 'Dahua, DoLynk, i-Timex', to: ['picklebook'] },
  { id: 'paymongo', label: 'PayMongo', to: ['picklebook', 'orange-portal'] },
  { id: 'ruijie', label: 'Ruijie / Reyee', to: ['orange-portal'] },
  { id: 'nx', label: 'Nx Witness', to: ['neuronest'] },
]

// The surface each system runs on, as described in its copy. Drives the preview frame and the card width.
export type Device = 'browser' | 'phone' | 'kiosk' | 'receipt' | 'monitor' | 'papers'

export const deviceFor: Record<string, Device> = {
  posibli: 'browser', // multi-tenant web platform
  inventonet: 'browser',
  invoicing: 'receipt', // invoices, credit notes and signed events
  'posibli-kiosk-admin': 'kiosk', // customer-facing kiosk checkout
  picklebook: 'browser', // React
  yuaskme: 'phone', // Expo / React Native customer app
  synapsego: 'phone', // React Native super app
  'orange-portal': 'phone', // captive portal on the guest's device
  vistay: 'papers', // folios, proformas, final invoices
  neuronest: 'monitor', // Nx Witness live video
  'tally-room': 'phone', // mobile-first student ballot
}
