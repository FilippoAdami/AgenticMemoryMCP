import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { vaultIndexer } from './services/indexer.js'
import { queryRouter } from './routers/query.js'
import { mediaRouter } from './routers/media.js'

const app = new Hono()

app.route('/api/query', queryRouter)
app.route('/api/media', mediaRouter)

app.get('/', (c) => c.text('MondayVault Service Running!'))

app.get('/health', (c) => c.json({ status: 'ok' }))

const port = 8081
console.log(`Vault Service is starting on port ${port}...`)

vaultIndexer.init().then(() => {
  console.log('LanceDB and Embedding model initialized successfully.')
  serve({
    fetch: app.fetch,
    port
  })
}).catch(err => {
  console.error('Failed to initialize Vault Indexer:', err)
  process.exit(1)
})
