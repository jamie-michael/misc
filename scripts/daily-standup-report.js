import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import axios from 'axios'
import dayjs from 'dayjs'
import { Octokit } from 'octokit'

import log from '../src/lib/logger.js'

const LIMIT_PER_REPO = 100
const TWENTY_FOUR_HOURS_AGO = dayjs().subtract(48,`hour`)
const OPENAI_URL = `https://api.openai.com/v1/chat/completions`
const DIFF_MAX_CHARS = 6000

const STANDUP_PROMPT_TEMPLATE = `You are an AI assistant generating structured stand-up data from a single Git commit.

Your job is to:
1. Classify the commit.
2. Assess its product impact.
3. Decide whether it should be mentioned in a daily stand-up.
4. Generate a concise, professional bullet point suitable as a speaking prompt.

You must follow ALL rules below.

---

## CONTEXT

Branch name:
{{branch_name}}

Commit message:
{{commit_message}}

Diff:
{{diff}}

---

## INSTRUCTIONS

### 1. Classify the commit into ONE of these categories:
- feature
- user-visible improvement
- bug fix
- infrastructure
- refactor
- tooling
- chore
- experiment

Choose the closest match.

---

### 2. Assign an impact score from 1–5:

5 = Major user-facing feature or significant milestone  
4 = Meaningful user-facing improvement or important bug fix  
3 = Notable progress, moderate bug fix, or backend change affecting behaviour  
2 = Minor tweak, small refactor, low-impact improvement  
1 = Dev-only change, tooling, config, formatting, logging, or not worth mentioning  

Be strict with scoring. Most commits should be 2 or below unless clearly meaningful.

---

### 3. Mark whether this is notable for stand-up.

Rules:
- Set standupNotable = true only if impact_score >= 3 (worth calling out in stand-up).
- If impact_score < 3, set standupNotable = false (still summarize it, but it's not a headline).
- Tooling, config, or automation changes are usually NOT notable unless they significantly improve team velocity.

You still provide a bullet_summary for every commit so the reader sees what was done; standupNotable just distinguishes "headline" vs "for context".

---

### 4. Generate a product-focused bullet point.

Rules:
- Focus on user impact or product progress.
- Do NOT mention file names, function names, libraries, or implementation details.
- Slightly elevate the language to sound professional and intentional.
- Do NOT exaggerate.
- Keep it 1–2 lines max.
- Write it as a speaking prompt (not a full paragraph).

If standupNotable is false, still generate a short neutral summary, but keep it minimal.

---

## OUTPUT FORMAT (JSON ONLY)

Return ONLY valid JSON in this exact structure:

{
  "category": "",
  "impact_score": 0,
  "standupNotable": false,
  "bullet_summary": "",
  "reasoning": ""
}

Where:
- category = chosen classification
- impact_score = number 1–5
- standupNotable = true if worth calling out in stand-up, false if minor but still summarized for context
- bullet_summary = concise speaking-ready bullet (always provide one)
- reasoning = short explanation of why this score was chosen (1–3 sentences)

Do NOT include any additional text outside the JSON.`

function buildStandupPrompt({ branchName = ``,commitMessage = ``,diff = `` }) {
  return STANDUP_PROMPT_TEMPLATE
    .replace(`{{branch_name}}`,branchName)
    .replace(`{{commit_message}}`,commitMessage)
    .replace(`{{diff}}`,diff)
}

function parseStandupResponse(raw) {
  let text = (raw || ``).trim()
  const codeBlock = /^```(?:json)?\s*([\s\S]*?)```\s*$/m
  const match = text.match(codeBlock)
  if (match) text = match[1].trim()
  const out = JSON.parse(text)
  if (typeof out.impact_score !== `number`) out.impact_score = Number(out.impact_score) || 1
  const rawNotable = out.standupNotable ?? out.standup_notable ?? out.include_in_standup
  if (typeof out.standupNotable !== `boolean`) out.standupNotable = Boolean(rawNotable)
  return out
}

async function classifyCommitForStandup({ branchName = ``,commitMessage = ``,diff = `` }) {
  const key = process.env.OPENAI_API_KEY?.trim()
  if (!key) {
    log.warn(`commits: OPENAI_API_KEY not set, skipping classification`)
    return null
  }
  const truncatedDiff = typeof diff === `string` && diff.length > DIFF_MAX_CHARS
    ? diff.slice(0,DIFF_MAX_CHARS) + `\n... (truncated)`
    : (diff || ``)
  const prompt = buildStandupPrompt({ branchName,commitMessage: commitMessage || ``,diff: truncatedDiff })
  try {
    const { data } = await axios.post(
      OPENAI_URL,
      {
        model: `gpt-4o-mini`,
        messages: [
          { role: `system`,content: `You output only valid JSON. No markdown, no explanation outside the JSON.` },
          { role: `user`,content: prompt },
        ],
      },
      {
        headers: { Authorization: `Bearer ${key}`,'Content-Type': `application/json` },
        timeout: 30_000,
      },
    )
    const content = data?.choices?.[0]?.message?.content
    if (!content) return null
    return parseStandupResponse(content)
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message
    log.warn(`commits: classification failed`,msg)
    return null
  }
}

function normalizeCommit(apiCommit,repoName,diff = null) {
  const c = apiCommit.commit
  const author = c?.author || {}
  const date = author.date ? dayjs(author.date) : null
  const message = c?.message || ``
  const subject = message.split(`\n`)[0] || ``
  return {
    hash: apiCommit.sha,
    shortHash: apiCommit.sha?.slice(0,7) || ``,
    subject,
    message,
    authorName: author.name || ``,
    authorEmail: author.email || ``,
    date: author.date || ``,
    timestamp: date ? date.unix() : 0,
    repoName,
    url: apiCommit.html_url,
    ...(diff != null && { diff }),
  }
}

async function run() {
  if (!process.env.REPORT_OUTPUT_PATH?.trim()) {
    process.env.REPORT_OUTPUT_PATH = path.join(process.cwd(), 'daily-standup', `standup-${dayjs().format('YYYY-MM-DD')}.md`)
  }
  const token = process.env.GITHUB_TOKEN
  if (!token?.trim()) {
    log.error(`commits: GITHUB_TOKEN is not set`)
    process.exit(1)
  }

  const org = process.env.GITHUB_ORG || `wakeflow`
  let author = process.env.GITHUB_AUTHOR?.trim() || ``
  const since = TWENTY_FOUR_HOURS_AGO.toISOString()

  const octokit = new Octokit({ auth: token })
  if (!author) {
    const { data: me } = await octokit.rest.users.getAuthenticated()
    author = me.login
  }
  log.info(`commits: fetching`,{ org,author,since })

  let repos = []
  try {
    const iterator = octokit.paginate.iterator(octokit.rest.repos.listForOrg,{
      org,
      type: `all`,
      per_page: 100,
    })
    for await (const { data: page } of iterator)
      repos = repos.concat(page)

    const updatedSince = TWENTY_FOUR_HOURS_AGO.valueOf()
    repos = repos.filter(r => dayjs(r.updated_at).valueOf() >= updatedSince)
    log.info(`commits: listed repos`,repos.length,`repos (updated in last 24h)`,repos.map(r => r.name).join(`, `))
  } catch (err) {
    const status = err.response?.status || 500
    const message = err.response?.data?.message || err.message || `Failed to list repos`
    log.error(`commits: listForOrg failed`,status,message)
    process.exit(1)
  }

  const allCommits = []
  let lastError = null
  for (const r of repos)
    try {
      const { data } = await octokit.rest.repos.listCommits({
        owner: r.owner.login,
        repo: r.name,
        since,
        author,
        per_page: LIMIT_PER_REPO,
      })
      if (data.length > 0)
        log.info(`commits:`,r.name,data.length,`commits`)

      for (const apiCommit of data) {
        let diff = null
        try {
          const { data: diffData } = await octokit.rest.repos.getCommit({
            owner: r.owner.login,
            repo: r.name,
            ref: apiCommit.sha,
            mediaType: { format: `diff` },
          })
          diff = typeof diffData === `string` ? diffData : null
        } catch (err) {
          log.warn(`commits: getCommit diff failed`,r.name,apiCommit.sha?.slice(0,7),err.message)
        }
        allCommits.push(normalizeCommit(apiCommit,r.name,diff))
      }

    } catch (err) {
      if (err.response?.status === 409) continue
      lastError = err.response?.data?.message || err.message
      log.warn(`commits: listCommits failed for`,r.name,err.response?.status,lastError)
    }

  allCommits.sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0))

  let notes = ``
  if (allCommits.length > 0) {
    for (const commit of allCommits) {
      const standup = await classifyCommitForStandup({
        branchName: ``,
        commitMessage: commit.message || commit.subject,
        diff: commit.diff ?? ``,
      })
      if (standup) {
        commit.standup = standup
        log.info(`commits: classified`,commit.shortHash,commit.repoName,commit.subject?.slice(0,50),{
          category: standup.category,
          impact_score: standup.impact_score,
          standupNotable: standup.standupNotable,
          bullet_summary: standup.bullet_summary?.slice(0,80),
          reasoning: standup.reasoning?.slice(0,120),
        })
      } else
        log.warn(`commits: no classification`,commit.shortHash,commit.repoName,commit.subject?.slice(0,50))
    }
    const repoOrder = [...new Set(allCommits.map(c => c.repoName))]
    const commitsByRepo = new Map()
    for (const c of allCommits) {
      if (!commitsByRepo.has(c.repoName)) commitsByRepo.set(c.repoName,[])
      commitsByRepo.get(c.repoName).push(c.subject || `(no subject)`)
    }
    const notableByRepo = new Map()
    const otherByRepo = new Map()
    for (const c of allCommits) {
      if (!c.standup?.bullet_summary) continue
      const isNotable = c.standup.standupNotable
      const map = isNotable ? notableByRepo : otherByRepo
      if (!map.has(c.repoName)) map.set(c.repoName,[])
      map.get(c.repoName).push(c.standup.bullet_summary)
    }

    const sections = []
    sections.push(`Repositories`)
    sections.push(repoOrder.join(`\n`))
    sections.push(``)
    sections.push(`Commits`)
    for (const repo of repoOrder) {
      const subjects = commitsByRepo.get(repo) || []
      sections.push(repo)
      for (const subj of subjects)
        sections.push(`  * ${subj}`)
      sections.push(``)
    }
    sections.push(`Summary`)
    const hasAnySummary = notableByRepo.size > 0 || otherByRepo.size > 0
    if (hasAnySummary)
      for (const repo of repoOrder) {
        const notable = notableByRepo.get(repo) || []
        const other = otherByRepo.get(repo) || []
        if (notable.length === 0 && other.length === 0) continue
        sections.push(repo)
        for (const b of notable)
          sections.push(`    • ${b}`)
        for (const b of other)
          sections.push(`    (context) ${b}`)
        sections.push(``)
      }
    else
      sections.push(`(no stand-up items)`)
    notes = sections.join(`\n`).trimEnd()
    log.info(`commits: done`,allCommits.length,`commits`,notableByRepo.size,`repos with notable bullets`)
  } else {
    notes = `No commits for today.`
    log.info(`commits: done`,allCommits.length,`total commits`)
  }

  const outputPath = process.env.REPORT_OUTPUT_PATH?.trim()
  if (outputPath) {
    const dir = path.dirname(outputPath)
    fs.mkdirSync(dir,{ recursive: true })
    fs.writeFileSync(outputPath,notes,`utf8`)
    log.info(`commits: report written`,outputPath)
  }
  console.log(notes)
}

export { run }

const isMain = path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])
if (isMain)
  run().catch(err => {
    log.error(`commits:`,err.message)
    process.exit(1)
  })
