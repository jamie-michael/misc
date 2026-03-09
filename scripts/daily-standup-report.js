/* global console, process */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import axios from 'axios'
import dayjs from 'dayjs'
import { Octokit } from 'octokit'

import log from '../src/lib/logger.js'
import { sendEmail } from '../src/lib/email.js'
import {
  buildEmptyStandupReport,
  generateMarkdownReport,
  requestChatCompletion,
  validateStandupMarkdown,
} from '../src/lib/standup-ai.js'

const LIMIT_PER_REPO = 100
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

5 = Major user-facing feature or significant milestone; or major internal win (e.g. big perf/reliability improvement)  
4 = Meaningful user-facing improvement or important bug fix; or meaningful internal work (e.g. DB performance, API reliability, cleanup that reduces tech debt)  
3 = Notable progress: moderate bug fix, backend change affecting behaviour, or substantive internal work that affects the whole team or system (refactors, performance, tidying, cleanups that matter)  
2 = Minor tweak, small refactor, low-impact improvement; or small dev convenience that only helps one person's workflow  
1 = Trivial only: lockfile/dependency file changes, config-only tweak, formatting-only, logging-only, or genuinely not worth mentioning  

Important: Score 3+ for internal work that is substantive and team- or system-wide (DB performance, reliability, real cleanups). Do NOT score 3+ for: lockfile or package-manager file changes; small personal dev conveniences (e.g. pre-filling a form from last commit); tooling that only streamlines one person's workflow. Those are 1–2 and not stand-up headline material.

---

### 3. Mark whether this is notable for stand-up.

Rules:
- Set standupNotable = true when impact_score >= 3 (worth calling out in stand-up).
- If impact_score < 3, set standupNotable = false (still summarize it, but it's not a headline).
- Internal work that affects the team or system (DB performance, reliability, real cleanups) CAN be notable. Lockfile/dependency changes and small personal dev conveniences (e.g. "pre-fill from last commit") are NOT notable—keep them (context) only.

You still provide a bullet_summary for every commit so the reader sees what was done; standupNotable just distinguishes "headline" vs "for context".

---

### 4. Generate a concise bullet point.

Rules:
- For user-facing work: focus on user impact or product progress.
- For internal work (performance, cleanups, refactors, tooling): focus on what was improved or why it matters to the team (e.g. "Improved DB query performance for X", "Cleaned up Y to reduce tech debt").
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

const DAILY_REPORT_PROMPT_TEMPLATE = `You are an AI assistant composing a daily engineering stand-up report from structured commit classifications.

You will receive JSON describing the day's work grouped by repository. Every commit already includes:
- subject
- shortHash
- timestamp
- category
- impact_score
- standupNotable
- bullet_summary
- reasoning

Your task is to output markdown in this EXACT structure:

Repositories
repo-a
repo-b

Commits
repo-a
  * meaningful subject
  * another meaningful subject

repo-b
  * meaningful subject

Summary
repo-a
    * notable outcome
    * (context) lower-priority item

repo-b
    * notable outcome

Rules:
- Output ONLY markdown. No code fences. No preamble.
- The report MUST start with "Repositories".
- Use the exact section titles: Repositories, Commits, Summary.
- Include every repository that had work.
- In Commits, include only the most meaningful subjects for each repo. Skip trivial subjects when they add no value.
- In Summary, use only:
  - "    * " for notable items
  - "    * (context) " for lower-priority items
- Do not invent work that is not in the JSON.
- Prefer the provided bullet_summary and standupNotable signals over raw commit subjects when writing the Summary.
- Keep the tone concise and professional.

Report date: {{report_date}}

Structured input JSON:
{{report_input}}`

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
  if (!out.category || !out.bullet_summary)
    throw new Error(`standup classification missing required fields`)
  return out
}

function buildDailyReportPrompt({ reportDate,reportInput }) {
  return DAILY_REPORT_PROMPT_TEMPLATE
    .replace(`{{report_date}}`,reportDate)
    .replace(`{{report_input}}`,JSON.stringify(reportInput,null,2))
}

function buildDailyReportInput(allCommits) {
  const repoOrder = [...new Set(allCommits.map(c => c.repoName))]
  return {
    repositories: repoOrder.map(repoName => ({
      repoName,
      commits: allCommits
        .filter(c => c.repoName === repoName)
        .map(c => ({
          shortHash: c.shortHash,
          subject: c.subject || `(no subject)`,
          timestamp: c.timestamp,
          category: c.standup.category,
          impact_score: c.standup.impact_score,
          standupNotable: c.standup.standupNotable,
          bullet_summary: c.standup.bullet_summary,
          reasoning: c.standup.reasoning,
        })),
    })),
  }
}

async function classifyCommitForStandup({
  branchName = ``,
  commitMessage = ``,
  diff = ``,
  requestChat = requestChatCompletion,
  env = process.env,
}) {
  const truncatedDiff = typeof diff === `string` && diff.length > DIFF_MAX_CHARS
    ? diff.slice(0,DIFF_MAX_CHARS) + `\n... (truncated)`
    : (diff || ``)
  const prompt = buildStandupPrompt({ branchName,commitMessage: commitMessage || ``,diff: truncatedDiff })
  const content = await requestChat({
    messages: [
      { role: `system`,content: `You output only valid JSON. No markdown, no explanation outside the JSON.` },
      { role: `user`,content: prompt },
    ],
    timeoutMs: 30_000,
    label: `daily-classification`,
    axiosClient: axios,
    env,
  })
  return parseStandupResponse(content)
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

async function run({
  env = process.env,
  now = dayjs(),
  fsMod = fs,
  pathMod = path,
  octokitFactory = auth => new Octokit({ auth }),
  classifyCommit = classifyCommitForStandup,
  generateReport = generateMarkdownReport,
  sendEmailFn = sendEmail,
  logMod = log,
} = {}) {
  const today = dayjs(now)
  const sinceDate = today.subtract(1,`day`)
  const outputPath = env.REPORT_OUTPUT_PATH?.trim() ||
    pathMod.join(process.cwd(), 'reports', 'daily-standup', `standup-${today.format('YYYY-MM-DD')}.md`)

  const token = env.GITHUB_TOKEN
  if (!token?.trim()) {
    throw new Error(`commits: GITHUB_TOKEN is not set`)
  }

  const org = env.GITHUB_ORG || `wakeflow`
  let author = env.GITHUB_AUTHOR?.trim() || ``
  const since = sinceDate.toISOString()

  const octokit = octokitFactory(token)
  if (!author) {
    const { data: me } = await octokit.rest.users.getAuthenticated()
    author = me.login
  }
  logMod.info(`commits: fetching`,{ org,author,since })

  let repos = []
  try {
    const iterator = octokit.paginate.iterator(octokit.rest.repos.listForOrg,{
      org,
      type: `all`,
      per_page: 100,
    })
    for await (const { data: page } of iterator)
      repos = repos.concat(page)

    const updatedSince = sinceDate.valueOf()
    repos = repos.filter(r => dayjs(r.updated_at).valueOf() >= updatedSince)
    logMod.info(`commits: listed repos`,repos.length,`repos (updated in last 24h)`,repos.map(r => r.name).join(`, `))
  } catch (err) {
    const status = err.response?.status || 500
    const message = err.response?.data?.message || err.message || `Failed to list repos`
    throw new Error(`commits: listForOrg failed ${status} ${message}`)
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
        logMod.info(`commits:`,r.name,data.length,`commits`)

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
          logMod.warn(`commits: getCommit diff failed`,r.name,apiCommit.sha?.slice(0,7),err.message)
        }
        allCommits.push(normalizeCommit(apiCommit,r.name,diff))
      }

    } catch (err) {
      if (err.response?.status === 409) continue
      lastError = err.response?.data?.message || err.message
      logMod.warn(`commits: listCommits failed for`,r.name,err.response?.status,lastError)
    }

  allCommits.sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0))

  let notes = ``
  if (allCommits.length > 0) {
    for (const commit of allCommits) {
      const standup = await classifyCommit({
        branchName: ``,
        commitMessage: commit.message || commit.subject,
        diff: commit.diff ?? ``,
        env,
      })
      commit.standup = standup
      logMod.info(`commits: classified`,commit.shortHash,commit.repoName,commit.subject?.slice(0,50),{
        category: standup.category,
        impact_score: standup.impact_score,
        standupNotable: standup.standupNotable,
        bullet_summary: standup.bullet_summary?.slice(0,80),
        reasoning: standup.reasoning?.slice(0,120),
      })
    }
    const reportInput = buildDailyReportInput(allCommits)
    notes = await generateReport({
      userPrompt: buildDailyReportPrompt({
        reportDate: today.format(`YYYY-MM-DD`),
        reportInput,
      }),
      timeoutMs: 60_000,
      label: `daily-report`,
      env,
    })
    validateStandupMarkdown(notes)
    logMod.info(`commits: done`,allCommits.length,`commits`,reportInput.repositories.length,`repos in report`)
  } else {
    notes = buildEmptyStandupReport()
    logMod.info(`commits: done`,allCommits.length,`total commits`)
  }

  if (outputPath) {
    const dir = pathMod.dirname(outputPath)
    fsMod.mkdirSync(dir,{ recursive: true })
    fsMod.writeFileSync(outputPath,notes,`utf8`)
    logMod.info(`commits: report written`,outputPath)
  }

  const emailResult = await sendEmailFn({
    subject: `Standup ${today.format('YYYY-MM-DD')}`,
    body: notes,
  })
  if (emailResult.sent) logMod.info(`commits: email sent`, emailResult.to)
  else if (emailResult.skipped) logMod.warn(`commits: email skipped`, emailResult.reason)

  console.log(notes)
  return notes
}

export {
  buildDailyReportInput,
  buildDailyReportPrompt,
  classifyCommitForStandup,
  parseStandupResponse,
  run,
}

const isMain = path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])
if (isMain)
  run().catch(err => {
    log.error(`commits:`,err.message)
    process.exit(1)
  })
