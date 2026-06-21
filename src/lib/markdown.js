import { marked } from 'marked'
import DOMPurify from 'dompurify'

// GitHub-flavored markdown; single newlines become <br> like GitHub comments.
marked.setOptions({ gfm: true, breaks: true })

// Comment bodies come from GitHub (other users) — untrusted. Render markdown to
// HTML, then sanitize. Links open in a new tab safely.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

export function renderMarkdown(text) {
  if (!text) return ''
  try {
    return DOMPurify.sanitize(marked.parse(text, { async: false }))
  } catch {
    return ''
  }
}
