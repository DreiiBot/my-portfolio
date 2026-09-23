// Personal details. Links marked "placeholder" still need your real URLs.
export const profile = {
  name: 'Eleandre Sales',
  firstName: 'Eleandre',
  lastName: 'Sales',
  initials: 'ES',
  role: 'Software developer and IT professional',
  tagline: 'I turn real-world business problems into software that is reliable, intuitive and genuinely useful.',
  email: 'you@example.com', // placeholder
  links: [
    { label: 'GitHub', href: 'https://github.com/your-username' }, // placeholder
    { label: 'LinkedIn', href: 'https://www.linkedin.com/in/your-profile' }, // placeholder
    { label: 'Résumé (PDF)', href: '/resume.pdf' }, // placeholder: add public/resume.pdf
  ],
}

export const bio = [
  'I’m a software developer and IT professional focused on building practical, scalable and user-centered software. I develop full-stack web and mobile applications, business management systems, integrations, automation and AI-powered solutions.',
  'Rather than simply building features, I focus on understanding how a system should work as a whole — from its user experience and business workflows to its backend architecture and integrations. That’s how a POS turned into an ecosystem: inventory, procurement, invoicing, loyalty, booking, connectivity and AI, all designed to work together.',
  'I’m constantly exploring new technologies and improving my skills, with a particular interest in software architecture, AI, automation, and solutions tailored to the businesses and people who use them.',
]

export const specialties = [
  'Full-stack web & mobile',
  'Business management systems',
  'Integrations & automation',
  'AI-powered solutions',
  'Software architecture',
]

export const achievements = [
  {
    title: 'Built POSIBLI, a multi-tenant business platform',
    body: 'The central platform of my work: POS, inventory, loyalty, procurement, ordering, invoicing and integrations for Philippine SMBs, with around 180 permission capability keys and role- and employee-level overrides.',
  },
  {
    title: 'Shipped seven phases of procure-to-pay',
    body: 'InventoNet covers requisition to three-way match and returns, runs as its own backend service, and lets suppliers who are themselves POSIBLI stores quote, accept and ship from their own accounts — a B2B network between businesses.',
  },
  {
    title: 'Designed a public Accounts Receivable API',
    body: 'Client-credential auth with short-lived tokens, scopes, store/location limits, idempotency, stable error codes and HMAC-SHA256-signed webhooks with retry and dead-letter handling.',
  },
  {
    title: 'Connected software to physical hardware',
    body: 'Court bookings linked to Dahua, DoLynk and i-Timex access control; a captive-portal WiFi platform on Ruijie/Reyee gateways; license-plate recognition on Nx Witness camera infrastructure.',
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

export const navItems = [
  { id: 'work', label: 'Work' },
  { id: 'about', label: 'About' },
  { id: 'stack', label: 'Tools' },
  { id: 'contact', label: 'Contact' },
]
