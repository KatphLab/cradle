import { beforeEach, describe, expect, it } from 'vitest'
import { helloTool, resetGreetCount } from './hello.js'

describe('helloTool', () => {
  beforeEach(() => {
    resetGreetCount()
  })

  it('greets by name and tracks count', async () => {
    const result1 = await helloTool.execute(
      'call-1',
      { name: 'World' },
      undefined,
      undefined,
      // @ts-expect-error minimal context mock
      {},
    )
    expect(result1).toEqual({
      content: [{ type: 'text', text: 'Hello, World!' }],
      details: { greeted: 'World', count: 1 },
    })

    const result2 = await helloTool.execute(
      'call-2',
      { name: 'Pi' },
      undefined,
      undefined,
      // @ts-expect-error minimal context mock
      {},
    )
    expect(result2).toEqual({
      content: [{ type: 'text', text: 'Hello, Pi!' }],
      details: { greeted: 'Pi', count: 2 },
    })
  })
})
