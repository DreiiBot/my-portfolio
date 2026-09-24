// Renders scripts/og-card.html to public/og-image.png (1200 × 630) with a local headless Chrome or Edge.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const browsers = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)
const browser = browsers.find((b) => existsSync(b))
if (!browser) throw new Error('No Chrome or Edge found; set CHROME_PATH')

const out = resolve('public/og-image.png')
const started = Date.now()
const child = spawn(browser, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--window-size=1200,630',
  '--virtual-time-budget=8000',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'og-'))}`,
  `--screenshot=${out}`,
  pathToFileURL(resolve('scripts/og-card.html')).href,
])

// Headless Chrome sometimes lingers after writing the file, so stop it once the image lands.
const poll = setInterval(() => {
  if (existsSync(out) && statSync(out).mtimeMs > started) {
    clearInterval(poll)
    setTimeout(() => {
      child.kill()
      console.log(`wrote ${out}`)
    }, 500)
  }
}, 250)
setTimeout(() => {
  clearInterval(poll)
  child.kill()
  console.error('timed out rendering the OG image')
  process.exitCode = 1
}, 45000).unref()
