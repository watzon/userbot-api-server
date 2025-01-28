import { serve } from '@hono/node-server'
import { swaggerUI } from '@hono/swagger-ui'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { prettyJSON } from 'hono/pretty-json'

const app = new Hono()

// Store updates in memory
interface Update {
  timestamp: number
  data: any
}
const updates: Update[] = []

// Add middleware
app.use('*', logger())
app.use('*', prettyJSON())

// Simple home page to show received updates
app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Webhook Test Server</title>
        <script>
          // Auto-refresh every 5 seconds
          setTimeout(() => location.reload(), 5000)
        </script>
        <style>
          body { font-family: system-ui; max-width: 800px; margin: 0 auto; padding: 2rem; }
          pre { background: #f5f5f5; padding: 1rem; border-radius: 4px; overflow-x: auto; }
          .update { margin-bottom: 2rem; border-bottom: 1px solid #eee; }
          .timestamp { color: #666; font-size: 0.9rem; }
        </style>
      </head>
      <body>
        <h1>Webhook Test Server</h1>
        <p>Listening for webhook updates...</p>
        <div id="updates">
          ${updates.map((update) => `
            <div class="update">
              <div class="timestamp">${new Date(update.timestamp).toLocaleString()}</div>
              <pre>${JSON.stringify(update.data, null, 2)}</pre>
            </div>
          `).join('')}
        </div>
      </body>
    </html>
  `)
})

app.get('/docs', swaggerUI({ url: '/docs/swagger.json' }))

// Webhook endpoint
app.post('/webhook', async (c) => {
  const body = await c.req.json()
  
  // Add new update to the list
  updates.unshift({
    timestamp: Date.now(),
    data: body
  })
  
  // Keep only last 50 updates
  if (updates.length > 50) {
    updates.pop()
  }
  
  return c.json({ ok: true })
})

// Start server
const port = 3001
console.log(`Webhook test server running at http://localhost:${port}`)
serve({
  fetch: app.fetch,
  port
})
