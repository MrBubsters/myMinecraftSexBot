import { KnowledgeBase } from '../knowledge/knowledgeBase.js'
import { defineTool } from './types.js'

const category = 'Knowledge'
const maxDocLength = 900

let knowledge: KnowledgeBase | null = null
let status = 'still loading'

export function setKnowledgeBase(kb: KnowledgeBase) {
  knowledge = kb
}

export function getKnowledgeBase(): KnowledgeBase | null {
  return knowledge
}

export function setKnowledgeUnavailable(reason: string) {
  status = `unavailable (${reason})`
}

export const knowledgeTools = [
  defineTool({
    name: 'lookup',
    category,
    description:
      'Look up facts for THIS game version from the official game data: how to obtain or craft an item, what it is used for, ' +
      'what a block or mob drops, what an animal eats or breeds with, villager trades, item tags. Your own Minecraft knowledge ' +
      'may be outdated, so use this whenever you are not certain. Query with an item, block or mob name, or a short question.',
    params: {
      query: { type: 'string', description: 'e.g. "bee", "honeycomb", "what drops gunpowder", "farmer trades"', required: true },
      results: { type: 'integer', description: 'How many entries to return (default 2, max 5)' }
    },
    async handler(args) {
      if (!knowledge) return `The knowledge base is ${status}; rely on the guide for now.`
      const hits = knowledge.search(args.string('query'), args.int('results', 2, { min: 1, max: 5 }))
      if (hits.length === 0) return `No entries match "${args.string('query')}". Try an exact item, block or mob name.`
      return hits.map(doc => (doc.text.length > maxDocLength ? `${doc.text.slice(0, maxDocLength)}…` : doc.text)).join('\n---\n')
    }
  })
]
