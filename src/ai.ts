import ollama from 'ollama'

export type ToolCall = {
  name: string
  arguments: Record<string, unknown>
}

const tools = [
  {
    type: 'function',
    function: {
      name: 'say',
      description: 'Send a short message in Minecraft chat.',
      parameters: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'jump',
      description: 'Make the Minecraft character jump once.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'move_forward',
      description: 'Walk forward for a short duration.',
      parameters: {
        type: 'object',
        required: ['seconds'],
        properties: {
          seconds: {
            type: 'number',
            minimum: 0.1,
            maximum: 5
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'look',
      description: 'Inspect nearby entities.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'where',
      description: 'Get the current Minecraft coordinates.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'go_to',
      description:
        'Navigate autonomously to Minecraft coordinates. Use this instead of manually walking when the destination is known.',
      parameters: {
        type: 'object',
        required: ['x', 'y', 'z'],
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          z: { type: 'number' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'go_to_player',
      description:
        'Navigate to a visible Minecraft player.',
      parameters: {
        type: 'object',
        required: ['username'],
        properties: {
          username: { type: 'string' }
        }
      }
    }
  }
]

export async function decideActions(
  username: string,
  message: string,
  worldState: string
): Promise<ToolCall[]> {
  const response = await ollama.chat({
    model: 'gpt-oss:20b',

    messages: [
      {
        role: 'system',
        content: `
You control a Minecraft player.

Use tools to perform requested Minecraft actions.

Important:
- You may call multiple tools when the request requires multiple actions.
- Do not claim you performed an action unless you actually call its tool.
- If the player asks about something you cannot observe, say so.
- Keep Minecraft chat responses short.
`
      },
      {
        role: 'user',
        content: `
Current world state:
${worldState}

${username} says:
${message}
`
      }
    ],

    tools,
    think: false
  })

  return (response.message.tool_calls ?? []).map(call => ({
    name: call.function.name,
    arguments: call.function.arguments
  }))
}