// A drawn preview for each project, built only from that project's own copy.
// Hovering the card (or opening the project) plays the plate's one piece of motion.
import type { CSSProperties, ReactNode } from 'react'
import { invoicing, posibli, procurementPipeline } from '../data/flagship'
import type { Project } from '../data/projects'
import { familySlug } from '../data/projects'

const i = (n: number) => ({ '--i': n }) as CSSProperties

function PosibliPlate() {
  return (
    <div className="pl-modules">
      {posibli.modules.map((m, n) => (
        <div key={m.key} className="pl-modules__tile" style={i(n)}>
          <span className="pl-modules__key">{m.key}</span>
          <span className="pl-modules__label">{m.label}</span>
          <span className="pl-modules__title">{m.title}</span>
        </div>
      ))}
    </div>
  )
}

function InventoNetPlate() {
  return (
    <ol className="pl-track">
      {procurementPipeline.map((s, n) => (
        <li key={s} style={i(n)}>
          <span className="pl-track__node" />
          <span className="pl-track__label">{s}</span>
        </li>
      ))}
    </ol>
  )
}

function InvoicingPlate() {
  const rows = [...invoicing.eventLabels, ...invoicing.eventLabels]
  return (
    <div className="pl-log">
      <p className="pl-log__head">Webhooks signed with HMAC-SHA256</p>
      <div className="pl-log__window">
        <ul className="pl-log__rows">
          {rows.map((e, n) => (
            <li key={n} aria-hidden={n >= invoicing.eventLabels.length || undefined}>
              <span className="pl-log__dot" />
              {e}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function KioskPlate() {
  return (
    <div className="pl-split">
      <div className="pl-split__pane">
        <strong>Kiosk</strong>
        <span>Customer-facing checkout</span>
      </div>
      <div className="pl-split__pane">
        <strong>Admin</strong>
        <span>Tenants, stores and accounts</span>
      </div>
      <div className="pl-split__bus">API &amp; integration services</div>
    </div>
  )
}

function PicklebookPlate() {
  return (
    <div className="pl-rotation">
      <div className="pl-rotation__players" aria-hidden>
        {Array.from({ length: 16 }, (_, n) => (
          <span key={n} style={i(n)} />
        ))}
      </div>
      <ul className="pl-rotation__modes">
        <li>Challenge Court</li>
        <li>Mixer</li>
        <li>Random rotation</li>
      </ul>
      <p className="pl-caption">Open Play engine, tested with 16 checked-in players</p>
    </div>
  )
}

function FlowPlate({ steps }: { steps: string[] }) {
  return (
    <ol className="pl-flow">
      {steps.map((s, n) => (
        <li key={s} style={i(n)}>
          {s}
        </li>
      ))}
    </ol>
  )
}

function SynapsePlate() {
  const services = ['Orange Portal', 'Picklebook', 'Captive-portal WiFi', 'Prepaid Fibr', 'Helpdesk']
  return (
    <div className="pl-phone">
      <div className="pl-phone__device">
        {services.map((s, n) => (
          <span key={s} style={i(n)}>
            {s}
          </span>
        ))}
      </div>
      <div className="pl-phone__auth">
        <div className="pl-pin" aria-hidden>
          {Array.from({ length: 6 }, (_, n) => (
            <span key={n} style={i(n)} />
          ))}
        </div>
        <p>6-digit PIN</p>
        <p>Face ID</p>
        <p>Fingerprint</p>
      </div>
    </div>
  )
}

function OrangePlate() {
  return (
    <div className="pl-bite">
      <svg className="pl-bite__signal" viewBox="0 0 48 36" aria-hidden>
        <path d="M24 32a3 3 0 1 0 0-.01" />
        <path d="M16 24a11 11 0 0 1 16 0" style={i(1)} />
        <path d="M9 17a21 21 0 0 1 30 0" style={i(2)} />
        <path d="M2 10a31 31 0 0 1 44 0" style={i(3)} />
      </svg>
      <p className="pl-bite__figure">₱1 = 1 bite</p>
      <ul className="pl-chips">
        <li>Subscription</li>
        <li>Unlimited</li>
        <li>Time-based</li>
      </ul>
      <p className="pl-caption">PayMongo, GCash and QRPh</p>
    </div>
  )
}

function VistayPlate() {
  const docs = ['Folio', 'Proforma', 'Final invoice', 'Accounts receivable']
  return (
    <div className="pl-docs">
      {docs.map((d, n) => (
        <div key={d} className="pl-docs__sheet" style={i(n)}>
          <strong>{d}</strong>
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  )
}

function NeuroPlate() {
  return (
    <div className="pl-vision">
      <div className="pl-vision__frame">
        <span className="pl-vision__box pl-vision__box--vehicle">Vehicle</span>
        <span className="pl-vision__box pl-vision__box--plate">Plate</span>
        <span className="pl-vision__scan" />
      </div>
      <p className="pl-caption">YOLOv8 + ONNX detection, ONNX OCR, on Nx Witness</p>
    </div>
  )
}

function TallyPlate() {
  return (
    <div className="pl-ballot">
      <div className="pl-ballot__screen">
        <span className="pl-ballot__q" />
        <span className="pl-ballot__q pl-ballot__q--short" />
        {[0, 1, 2].map((n) => (
          <span key={n} className="pl-ballot__answer" style={i(n)} />
        ))}
      </div>
      <div className="pl-ballot__notes">
        <p>One question per screen</p>
        <p>Identity collected last</p>
        <p>Pooled across sections</p>
      </div>
    </div>
  )
}

const plates: Record<string, (p: Project) => ReactNode> = {
  posibli: () => <PosibliPlate />,
  inventonet: () => <InventoNetPlate />,
  invoicing: () => <InvoicingPlate />,
  'posibli-kiosk-admin': () => <KioskPlate />,
  picklebook: () => <PicklebookPlate />,
  yuaskme: (p) => <FlowPlate steps={p.diagrams?.[0].kind === 'flow' ? p.diagrams[0].steps : []} />,
  synapsego: () => <SynapsePlate />,
  'orange-portal': () => <OrangePlate />,
  vistay: () => <VistayPlate />,
  neuronest: () => <NeuroPlate />,
  'tally-room': () => <TallyPlate />,
}

export function Plate({ project, live = false }: { project: Project; live?: boolean }) {
  return (
    <div className="plate" data-family={familySlug[project.family]} data-id={project.id} data-live={live} aria-hidden>
      <div className="plate__bar">
        <span className="swatch" />
        <span>{project.name}</span>
        <span className="plate__cat">{project.category}</span>
      </div>
      <div className="plate__body">{plates[project.id]?.(project)}</div>
    </div>
  )
}
