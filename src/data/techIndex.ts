// Links each tool in stack.ts to the projects whose copy mentions it.
// Nothing is assigned by hand: a tool with no mention links to nothing.
import { projects } from './projects'
import type { Project } from './projects'
import { stack } from './stack'

// Other spellings the project copy uses for the same tool.
const aliases: Record<string, string[]> = {
  React: ['React(?! Native)'],
  'REST APIs': ['REST API'],
  'Service splitting': ['own backend service', 'several backend services'],
  'Android / iOS builds': ['Android builds', 'iOS testing'],
  WebViews: ['WebView'],
  Biometrics: ['biometric', 'Face ID', 'fingerprint'],
  'ONNX inference': ['ONNX'],
  'Apache virtual hosts': ['Apache'],
  'Captive-portal routing': ['captive-portal routing'],
  'GCash / QRPh': ['GCash', 'QRPh'],
  'Webhook signatures': ['HMAC', 'Webhook signatures'],
  Idempotency: ['idempot'],
  'Tenant isolation': ['tenant isolation'],
  'Native modules': ['native modules'],
  'Domain migration': ['domain migration'],
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const corpus = (p: Project) =>
  [
    p.name,
    p.summary,
    p.lead,
    p.meta,
    p.note,
    ...p.tech,
    ...p.sections.flatMap((s) => [s.title, s.body, s.kicker, ...(s.items ?? [])]),
    ...(p.more?.sections.flatMap((s) => [s.title, ...(s.items ?? [])]) ?? []),
    ...(p.diagrams?.flatMap((d) => (d.kind === 'flow' ? d.steps : d.tiers.flatMap((t) => t.nodes))) ?? []),
  ]
    .filter(Boolean)
    .join(' \n ')

const texts = new Map(projects.map((p) => [p.id, corpus(p)]))

function projectsFor(tool: string) {
  const patterns = aliases[tool] ?? [escape(tool)]
  const re = new RegExp(`(^|[^\\w])(${patterns.join('|')})`, 'i')
  return projects.filter((p) => re.test(texts.get(p.id) ?? '')).map((p) => p.id)
}

export const techGroups = stack.map((g) => ({
  group: g.group,
  items: g.items.map((name) => ({ name, projects: projectsFor(name) })),
}))

export const techByName = new Map(techGroups.flatMap((g) => g.items.map((i) => [i.name, i.projects] as const)))
