import type { ExtensionAPI, ThemeColor } from '@earendil-works/pi-coding-agent'

import { AskUserViewer } from '../components/ask-user-viewer.js'
import type { AskUserQuestion } from '../tools/ask-user.js'

interface AskUserResult {
  content: { type: string; text: string }[]
}

interface AskUserPayload {
  preamble?: string
  questions: AskUserQuestion[]
}

interface AskUserViewerTheme {
  fg: (color: ThemeColor, text: string) => string
  bold: (text: string) => string
}

interface CloseOverlayReference {
  current: (() => void) | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAskUserResult(value: unknown): value is AskUserResult {
  if (!isRecord(value)) {
    return false
  }

  const content = value['content']
  if (!Array.isArray(content)) {
    return false
  }

  return content.every(
    (item) =>
      isRecord(item) &&
      typeof item['type'] === 'string' &&
      typeof item['text'] === 'string',
  )
}

function isAskUserPayload(value: unknown): value is AskUserPayload {
  if (!isRecord(value)) {
    return false
  }

  const questions = value['questions']
  if (!Array.isArray(questions)) {
    return false
  }

  return questions.every(
    (question) =>
      isRecord(question) &&
      typeof question['id'] === 'string' &&
      typeof question['question'] === 'string',
  )
}

function createCloseOverlay(
  closeOverlayReference: CloseOverlayReference,
  done: (result: string) => void,
): () => void {
  return function closeOverlay(): void {
    if (closeOverlayReference.current === undefined) {
      return
    }

    done('dismissed')
    closeOverlayReference.current = undefined
  }
}

function createAskUserViewer(
  payload: AskUserPayload,
  closeOverlayReference: CloseOverlayReference,
  tui: { requestRender: () => void },
  theme: AskUserViewerTheme,
  done: (result: string) => void,
): AskUserViewer {
  closeOverlayReference.current = createCloseOverlay(
    closeOverlayReference,
    done,
  )

  return new AskUserViewer(
    payload.questions,
    payload.preamble,
    theme,
    () => {
      closeOverlayReference.current?.()
    },
    () => {
      tui.requestRender()
    },
  )
}

export function createAskUserRenderHook(): (
  pi: Pick<ExtensionAPI, 'on'>,
) => void {
  const closeOverlayReference: CloseOverlayReference = {
    current: undefined,
  }

  return function registerAskUserRenderHook(
    pi: Pick<ExtensionAPI, 'on'>,
  ): void {
    pi.on('tool_execution_end', (event, context) => {
      if (event.toolName !== 'ask_user') {
        return
      }
      if (event.isError) {
        return
      }
      if (!context.hasUI) {
        return
      }

      const result: unknown = event.result
      if (!isAskUserResult(result)) {
        return
      }

      const textContent = result.content[0]
      if (textContent?.type !== 'text') {
        return
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(textContent.text)
      } catch {
        return
      }
      if (!isAskUserPayload(parsed)) {
        return
      }

      closeOverlayReference.current?.()
      closeOverlayReference.current = undefined

      void context.ui
        .custom<string>(
          (tui, theme, _keybindings, done) =>
            createAskUserViewer(
              parsed,
              closeOverlayReference,
              tui,
              theme,
              done,
            ),
          { overlay: true },
        )
        .catch(() => {
          // Overlay dismissed or error — ignore
        })
    })

    pi.on('turn_start', () => {
      closeOverlayReference.current?.()
    })
  }
}
