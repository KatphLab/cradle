import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'

let greetCount = 0

/** @public */
export const helloTool = defineTool({
  name: 'hello',
  label: 'Hello',
  description: 'Greet someone by name',
  parameters: Type.Object({
    name: Type.String({ description: 'Name to greet' }),
  }),
  execute(_toolCallId, parameters, _signal, _onUpdate, _context) {
    greetCount++
    return Promise.resolve({
      content: [{ type: 'text', text: `Hello, ${parameters.name}!` }],
      details: { greeted: parameters.name, count: greetCount },
    })
  },
})

/** @public */
export function resetGreetCount(): void {
  greetCount = 0
}
