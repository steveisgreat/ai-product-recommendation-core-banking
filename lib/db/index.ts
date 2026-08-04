import postgres from 'postgres'
import { config } from 'dotenv'
import { join } from 'path'

// Load .env.local for non-Next.js contexts (scripts, tests)
config({ path: join(process.cwd(), '.env.local') })

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set')
}

// Export a single shared postgres client instance
export const sql = postgres(DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
})
