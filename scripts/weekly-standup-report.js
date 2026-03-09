/* global console, process */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import axios from 'axios'
import dayjs from 'dayjs'

import log from '../src/lib/logger.js'
import { sendEmail } from '../src/lib/email.js'
import {
  generateMarkdownReport,
  validateStandupMarkdown,
} from '../src/lib/standup-ai.js'

// Week = previous Friday + Mon, Tue, Wed, Thu (run just after Thursday night's daily)
const THURSDAY_DOW = 4 // 0 = Sunday in JS
const DAILY_STANDUP_DIR = path.join(process.cwd(), 'reports', 'daily-standup')
const WEEKLY_STANDUP_DIR = path.join(process.cwd(), 'reports', 'weekly-standup')

const WEEKLY_SUMMARY_PROMPT = `You are an AI assistant that merges multiple daily stand-up reports into one weekly report.

You will receive 1–5 daily stand-up reports. Each has:
- Repositories
- Commits (by repo, with subject lines)
- Summary (by repo: • for notable bullets, (context) for minor/context items)

Your job is to output a SINGLE report in the EXACT same format as a daily stand-up:

1) Repositories
   A single list of repo names that had work this week (one per line, no bullets).

2) Commits
   For each repo that had work, list only the MOST NOTEWORTHY commit subjects (not every commit). Skip trivial ones (lockfile, formatting, tiny tweaks). Use "  * " before each subject. One repo name as heading, then indented "  * subject" lines.

3) Summary
   For each repo, write a short list of the most noteworthy outcomes from the week. Use "    * " for headline items (user-facing or important internal work) and "    * (context) " for lower-priority items. Merge repeated or similar points across days into one bullet. Keep the same professional, concise bullet style as the daily summaries.

Rules:
- Use the EXACT section titles: "Repositories", "Commits", "Summary" (no extra headings like "Weekly" or "Week ending").
- No preamble. Output must start with "Repositories" and follow the structure above.
- Pick what is most noteworthy; do not list every commit or every bullet from every day.`

function getStandupPathForDate(date) {
  const dateStr = dayjs(date).format('YYYY-MM-DD')
  return path.join(DAILY_STANDUP_DIR, `standup-${dateStr}.md`)
}

function getWeekEndingThursday(refDate = dayjs()) {
  const d = dayjs(refDate)
  const dow = d.day()
  if (dow === THURSDAY_DOW) return d
  const daysBack = dow < THURSDAY_DOW ? dow + (7 - THURSDAY_DOW) : dow - THURSDAY_DOW
  return d.subtract(daysBack, 'day')
}

/** Returns [previous Friday, Monday, Tuesday, Wednesday, Thursday] for the week ending on the given Thursday. */
function getWeekDates(weekEndingThursday) {
  const thu = dayjs(weekEndingThursday)
  return [
    thu.subtract(6, 'day'),  // previous Friday
    thu.subtract(3, 'day'),  // Monday
    thu.subtract(2, 'day'),  // Tuesday
    thu.subtract(1, 'day'),  // Wednesday
    thu,                     // Thursday
  ]
}

function gatherWeekStandups({ fsMod = fs,logMod = log,refDate = dayjs() } = {}) {
  const weekEnding = getWeekEndingThursday(refDate)
  const dates = getWeekDates(weekEnding)
  const files = []
  for (const d of dates) {
    const filePath = getStandupPathForDate(d)
    if (fsMod.existsSync(filePath)) {
      const content = fsMod.readFileSync(filePath, 'utf8')
      const dateStr = d.format('YYYY-MM-DD')
      files.push({ date: dateStr, path: filePath, content })
    } else {
      logMod.info(`weekly: no standup file for ${d.format('YYYY-MM-DD')}, skipping`)
    }
  }
  return { files, weekEnding: weekEnding.format('YYYY-MM-DD') }
}

function buildCombinedInput(standupFiles) {
  const parts = standupFiles.map(
    ({ date, content }) => `## Day: ${date}\n\n${content}`,
  )
  return parts.join('\n\n---\n\n')
}

function buildWeeklyReportPrompt(combinedMarkdown) {
  return `${WEEKLY_SUMMARY_PROMPT}\n\n## Daily stand-up reports\n\n${combinedMarkdown}`
}

async function run({
  env = process.env,
  now = dayjs(),
  fsMod = fs,
  pathMod = path,
  generateReport = generateMarkdownReport,
  sendEmailFn = sendEmail,
  logMod = log,
} = {}) {
  const { files: standupFiles, weekEnding } = gatherWeekStandups({
    fsMod,
    logMod,
    refDate: now,
  })
  if (standupFiles.length === 0) {
    throw new Error(`weekly: no daily standup files found for week ending ${weekEnding} (Fri–Thu)`)
  }

  logMod.info('weekly: week ending', weekEnding, '— found', standupFiles.length, 'standup files', standupFiles.map(f => f.date).join(', '))

  const combined = buildCombinedInput(standupFiles)
  const summary = await generateReport({
    userPrompt: buildWeeklyReportPrompt(combined),
    timeoutMs: 60_000,
    label: `weekly-report`,
    env,
    axiosClient: axios,
  })
  const validatedSummary = validateStandupMarkdown(summary)

  const outputFileName = `weekly-standup-${weekEnding}.md`
  const outputPath = env.WEEKLY_REPORT_OUTPUT_PATH?.trim() ||
    pathMod.join(WEEKLY_STANDUP_DIR, outputFileName)

  fsMod.mkdirSync(pathMod.dirname(outputPath), { recursive: true })
  const sourcesBlock = [
    '',
    '---',
    '',
    '**Sources (files read):**',
    ...standupFiles.map(f => `- \`reports/daily-standup/standup-${f.date}.md\``),
  ].join('\n')
  const fullContent = validatedSummary + sourcesBlock

  fsMod.writeFileSync(outputPath, fullContent, 'utf8')
  logMod.info('weekly: report written', outputPath)

  const emailResult = await sendEmailFn({
    subject: `Weekly standup week ending ${weekEnding}`,
    body: fullContent,
  })
  if (emailResult.sent) logMod.info('weekly: email sent', emailResult.to)
  else if (emailResult.skipped) logMod.warn('weekly: email skipped', emailResult.reason)

  console.log(fullContent)
  return fullContent
}

export {
  buildCombinedInput,
  buildWeeklyReportPrompt,
  gatherWeekStandups,
  run,
}

const isMain = path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])
if (isMain) {
  run().catch(err => {
    log.error('weekly:', err.message)
    process.exit(1)
  })
}
