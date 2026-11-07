/**
 * Rebuild the game knowledge base from the official server jar.
 * It is built automatically on first start; run this to force a rebuild.
 *
 *   npm run build:knowledge                 # MC_VERSION or 26.2
 *   npm run build:knowledge -- "bee"        # rebuild, then show what a query returns
 */
import path from 'path'
import { loadKnowledgeBase } from '../src/knowledge/knowledgeBase.js'

const version = process.env.MC_VERSION ?? '26.2'
loadKnowledgeBase(version, path.resolve(process.cwd(), '.cache'), { rebuild: true }).then(kb => {
  const query = process.argv[2]
  if (query) for (const doc of kb.search(query)) console.log(`\n${doc.text}`)
}).catch(error => {
  console.error(error)
  process.exit(1)
})
