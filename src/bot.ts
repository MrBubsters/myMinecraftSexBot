
import mineflayer from 'mineflayer'
import {
  pathfinder,
  Movements,
  goals
} from 'mineflayer-pathfinder'
import path from 'path'
import { decideAction, AgentAction, ToolCall, decideActions } from './ai.js'
import { call } from 'assert'

const host = process.env.MC_HOST
const account = process.env.MC_ACCOUNT
const owner = process.env.MC_OWNER
const port = Number(process.env.MC_PORT ?? 25565)

if (!host || !account || !owner) {
  throw new Error('Missing MC_HOST, MC_ACCOUNT, or MC_OWNER')
}

const bot = mineflayer.createBot({
  host,
  port,
  username: account,
  auth: 'microsoft',
  version: '26.2',
  profilesFolder: path.resolve(
    process.cwd(),
    '.auth-cache'
  )
})
bot.loadPlugin(pathfinder)

bot.once('spawn', () => {
  const movements = new Movements(bot)

  movements.canDig = false
  movements.allow1by1towers = false
  movements.allowParkour = true
  movements.allowSprinting = true

  bot.pathfinder.setMovements(movements)

  console.log(`Connected as ${bot.username}`)
})

bot.on('chat', async (username: string, message: string) => {
  if (username === bot.username) return
  if (username !== owner) return

  console.log(`${username}: ${message}`)

  try {
    const state = getWorldState()

    const calls = await decideActions(
      username,
      message,
      state
    )

    console.log('AI tool calls:', calls)

    if (calls.length === 0) {
      bot.chat("I'm not sure what action to take.")
      return
    }

    for (const call of calls) {
      const result = await executeTool(call)
      console.log('Tool result:', result)
    }

    switch (message.toLowerCase()) {
      case '!ping':
        bot.chat('Pong! I am online.')
        break

      case '!where': {
        const position = bot.entity.position
        const { x, y, z } = position

        bot.chat(
          `I'm at ${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)}`
        )
        break
      }
      case '!jump':
        bot.setControlState('jump', true)

        setTimeout(() => {
          bot.setControlState('jump', false)
        }, 500)
        break

      case '!forward':
        bot.setControlState('forward', true)

        setTimeout(() => {
          bot.setControlState('forward', false)
        }, 2000)
        break

      case '!stop':
        bot.clearControlStates()
        bot.chat('Stopped!')
        break

      case '!look':
        bot.chat('Looking around...')
        console.log('Nearby entities:', Object.values(bot.entities)
          .filter(entity => entity.position.distanceTo(bot.entity.position) < 16)
          .map(entity => ({
            name: entity.name,
            position: entity.position.toString()
          }))
        )
        break

      case 'go_to': {
        const x = Number(call.arguments.x)
        const y = Number(call.arguments.y)
        const z = Number(call.arguments.z)

        console.log(`Pathfinding to ${x}, ${y}, ${z}`)

        await bot.pathfinder.goto(
          new goals.GoalNear(x, y, z, 1)
        )

        return `Reached ${x}, ${y}, ${z}`
      }

      case 'go_to_player': {
        const username = String(call.arguments.username)

        const player = bot.players[username]?.entity

        if (!player) {
          return `Player ${username} is not currently visible`
        }

        const { x, y, z } = player.position

        await bot.pathfinder.goto(
          new goals.GoalNear(x, y, z, 2)
        )

        return `Reached ${username}`
      }

    }
  } catch (error) {
    console.error('Agent error:', error)
    bot.chat("I had trouble figuring out what to do.")
  }
})

const discordOwner = 'Chris' // Your Discord display name

bot.on('messagestr', (rawMessage: string) => {
  // Expected format: [Discord] Chris: !ping
  console.log(rawMessage)
  const match = rawMessage.match(/^Discord\s+([^:]+):\s*(.*)$/)


  if (!match) return

  const [, username, message] = match

  console.log(`[Discord] ${username}: ${message}`)

  if (username !== discordOwner) return

  if (message === '!ping') {
    bot.chat('Pong! Discord connection works.')
  }

  if (message === '!where') {
    const { x, y, z } = bot.entity.position

    bot.chat(
      `I'm at ${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)}`
    )
  }
})

bot.on('kicked', reason => {
  console.error('Kicked:', reason)
})

bot.on('error', error => {
  console.error('Error:', error)
})

bot.on('end', reason => {
  console.log('Disconnected:', reason)
})

process.on('SIGINT', () => {
  bot.quit()
})

function getWorldState(): string {
  const { x, y, z } = bot.entity.position

  const nearbyEntities = Object.values(bot.entities)
  .filter(entity =>
    entity !== bot.entity &&
    entity.position.distanceTo(bot.entity.position) <= 32
  )
  .slice(0, 20)
  .map(entity => {
    const distance =
      entity.position.distanceTo(bot.entity.position).toFixed(1)

    const name =
      entity.username ??
      entity.name ??
      entity.type

    return `${name} (${distance} blocks away)`
  })
  
  const inventory = bot.inventory
    .items()
    .map(item => `${item.name} x${item.count}`)
    .join(', ')

  return `
    Position: ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}
    Health: ${bot.health}
    Food: ${bot.food}
    
    Inventory:
    ${inventory || 'empty'}
    
    Nearby entities:
    ${nearbyEntities.length > 0 ? nearbyEntities.join('\n') : 'none'}
    `

}

async function executeTool(call: ToolCall): Promise<string> {
  console.log('Executing tool:', call)

  switch (call.name) {
    case 'say': {
      const message = String(call.arguments.message ?? '')
      bot.chat(message)
      return `Sent chat message: ${message}`
    }

    case 'jump': {
      bot.setControlState('jump', true)

      await new Promise(resolve => setTimeout(resolve, 500))

      bot.setControlState('jump', false)
      return 'Jump executed'
    }

    case 'move_forward': {
      const requested = Number(call.arguments.seconds ?? 1)
      const seconds = Math.max(0.1, Math.min(requested, 5))

      bot.setControlState('forward', true)

      await new Promise(resolve =>
        setTimeout(resolve, seconds * 1000)
      )

      bot.setControlState('forward', false)

      return `Moved forward for ${seconds} seconds`
    }

    case 'where': {
      const { x, y, z } = bot.entity.position

      const result =
        `${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)}`

      bot.chat(`I'm at ${result}`)

      return `Current position: ${result}`
    }

    case 'look': {
      const nearby = Object.values(bot.entities)
        .filter(entity =>
          entity !== bot.entity &&
          entity.position.distanceTo(bot.entity.position) <= 16
        )
        .map(entity => {
          const distance =
            entity.position.distanceTo(bot.entity.position).toFixed(1)

          return `${entity.username ??
            entity.name ??
            entity.type
            }: ${distance} blocks`
        })
        .slice(0, 10)

      const result =
        nearby.length > 0
          ? nearby.join(', ')
          : 'Nothing interesting nearby'

      bot.chat(`I see: ${result}`)

      return result
    }

    case 'go_to': {
      const x = Number(call.arguments.x)
      const y = Number(call.arguments.y)
      const z = Number(call.arguments.z)

      if (![x, y, z].every(Number.isFinite)) {
        return 'Invalid coordinates'
      }

      console.log(`Pathfinding to ${x}, ${y}, ${z}`)

      await bot.pathfinder.goto(
        new goals.GoalNear(x, y, z, 1)
      )

      return `Reached ${x}, ${y}, ${z}`
    }

    case 'go_to_player': {
      const username = String(call.arguments.username ?? '')

      const player = bot.players[username]?.entity

      if (!player) {
        return `Player ${username} is not currently visible`
      }

      const { x, y, z } = player.position

      console.log(
        `Pathfinding to ${username} at ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`
      )

      await bot.pathfinder.goto(
        new goals.GoalNear(x, y, z, 2)
      )

      return `Reached ${username}`
    }

    default:
      return `Unknown tool: ${call.name}`
  }
}