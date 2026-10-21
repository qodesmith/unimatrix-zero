import {defineConfig} from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/modules/database/schema.ts',
  out: './drizzle',
})
