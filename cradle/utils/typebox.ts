import { Type } from '@earendil-works/pi-ai'

export function optionalString(description: string) {
  return Type.Optional(Type.String({ description }))
}

export function optionalNumber(description: string) {
  return Type.Optional(Type.Number({ description }))
}

export function optionalBoolean(description: string) {
  return Type.Optional(Type.Boolean({ description }))
}
