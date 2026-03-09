import axios from 'axios'

const OPENAI_URL = `https://api.openai.com/v1/chat/completions`
const DEFAULT_OPENAI_MODEL = `gpt-4o-mini`
const SOURCES_APPENDIX_HEADER = `---\n\n**Sources (files read):**`

function stripCodeFence(text = ``) {
  const trimmed = text.trim()
  const match = trimmed.match(/^```(?:markdown|md|json)?\s*([\s\S]*?)```\s*$/i)
  return match ? match[1].trim() : trimmed
}

export async function requestChatCompletion({
  messages,
  timeoutMs = 60_000,
  label = `standup`,
  model = DEFAULT_OPENAI_MODEL,
  axiosClient = axios,
  env = process.env,
}) {
  const key = env.OPENAI_API_KEY?.trim()
  if (!key)
    throw new Error(`${label}: OPENAI_API_KEY not set`)

  try {
    const { data } = await axiosClient.post(
      OPENAI_URL,
      {
        model,
        messages,
      },
      {
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': `application/json`,
        },
        timeout: timeoutMs,
      },
    )
    const content = data?.choices?.[0]?.message?.content
    if (!content?.trim())
      throw new Error(`${label}: empty OpenAI response`)

    return stripCodeFence(content)
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message
    throw new Error(`${label}: ${msg}`)
  }
}

export async function generateMarkdownReport({
  systemPrompt = `You output only valid markdown. No code blocks around the whole response.`,
  userPrompt,
  timeoutMs = 60_000,
  label = `standup-report`,
  model = DEFAULT_OPENAI_MODEL,
  axiosClient = axios,
  env = process.env,
}) {
  return requestChatCompletion({
    messages: [
      { role: `system`,content: systemPrompt },
      { role: `user`,content: userPrompt },
    ],
    timeoutMs,
    label,
    model,
    axiosClient,
    env,
  })
}

export function buildEmptyStandupReport() {
  return `Repositories
(none)

Commits
(none)

Summary
(no stand-up items)`
}

export function splitSourcesAppendix(markdown = ``) {
  const normalized = String(markdown || ``).replace(/\r\n/g,`\n`).trim()
  const marker = `\n\n${SOURCES_APPENDIX_HEADER}\n`
  const idx = normalized.indexOf(marker)
  if (idx === -1) return { core: normalized,appendix: `` }
  return {
    core: normalized.slice(0,idx).trimEnd(),
    appendix: normalized.slice(idx + 2).trim(),
  }
}

export function validateStandupMarkdown(markdown,{ allowSourcesAppendix = false } = {}) {
  const normalized = String(markdown || ``).replace(/\r\n/g,`\n`).trim()
  if (!normalized)
    throw new Error(`standup markdown is empty`)

  const { core,appendix } = allowSourcesAppendix ? splitSourcesAppendix(normalized) : { core: normalized,appendix: `` }
  if (appendix && !appendix.startsWith(SOURCES_APPENDIX_HEADER))
    throw new Error(`standup markdown has an invalid appendix`)

  if (!core.startsWith(`Repositories\n`))
    throw new Error(`standup markdown must start with Repositories`)

  const match = core.match(/^Repositories\n([\s\S]*?)\n\nCommits\n([\s\S]*?)\n\nSummary\n([\s\S]*)$/)
  if (!match)
    throw new Error(`standup markdown must contain Repositories, Commits, Summary in order`)

  const repositories = match[1].trim()
  const commits = match[2].trim()
  const summary = match[3].trim()
  if (!repositories)
    throw new Error(`Repositories section must not be empty`)
  if (!commits)
    throw new Error(`Commits section must not be empty`)
  if (!summary)
    throw new Error(`Summary section must not be empty`)

  return core
}

export {
  DEFAULT_OPENAI_MODEL,
  OPENAI_URL,
  SOURCES_APPENDIX_HEADER,
  stripCodeFence,
}
