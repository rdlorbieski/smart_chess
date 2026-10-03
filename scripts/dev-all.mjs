// Starts the API server and the Vite dev server together; Ctrl+C stops both.
import { spawn } from 'node:child_process'

const run = (args) => spawn(process.execPath, args, { stdio: 'inherit' })
const api = run(['server/index.mjs'])
const web = run(['node_modules/vite/bin/vite.js'])

const stop = () => { api.kill(); web.kill() }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
api.on('exit', (code) => { if (code) { console.error(`[dev-all] API exited with code ${code}`); stop() } })
web.on('exit', stop)
