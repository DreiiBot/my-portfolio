// Pours the server-rendered app into dist/index.html, then removes the temporary server build.
import { readFile, rm, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const dist = resolve('dist')
const server = resolve('dist-ssr')

const { render } = await import(pathToFileURL(resolve(server, 'entry-server.js')).href)
const file = resolve(dist, 'index.html')
const html = await readFile(file, 'utf8')
if (!html.includes('<!--app-->')) throw new Error('dist/index.html has no <!--app--> placeholder')

await writeFile(file, html.replace('<!--app-->', render()))
await rm(server, { recursive: true, force: true })
console.log('prerendered dist/index.html')
