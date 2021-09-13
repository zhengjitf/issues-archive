import {Comment} from './types'

export const parseBody = (body: string, index: number): Comment => {
  const lines = body.split('\r\n')
  let title = String(index)
  for (const line of lines) {
    const matched = line.match(/^#{1,5}\s(\S+)$/)
    if (matched) {
      title = matched[1]
      break
    }
  }

  return {
    content: body,
    /** 从 body 中提取的 title */
    title
  }
}

export const tryCatch = async <T>(
  promise: Promise<T>
): Promise<[null, T] | [any, null]> => {
  try {
    return [null, await promise]
  } catch (e) {
    return [e, null]
  }
}
