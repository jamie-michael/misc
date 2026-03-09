import { expect } from 'chai'
import dayjs from 'dayjs'

import {
  buildEmptyStandupReport,
  splitSourcesAppendix,
  validateStandupMarkdown,
} from './lib/standup-ai.js'
import {
  buildDailyReportInput,
  buildDailyReportPrompt,
  run as runDailyReport,
} from '../scripts/daily-standup-report.js'
import {
  buildCombinedInput,
  run as runWeeklyReport,
} from '../scripts/weekly-standup-report.js'

const VALID_STANDUP_MARKDOWN = `Repositories
repo-a
repo-b

Commits
repo-a
  * Added onboarding flow

repo-b
  * Fixed sync issue

Summary
repo-a
    * Shipped onboarding improvements

repo-b
    * (context) Cleaned up sync edge cases`

async function expectRejects(promiseFactory,message) {
  try {
    await promiseFactory()
    throw new Error(`Expected promise to reject`)
  } catch (err) {
    expect(err.message).to.contain(message)
  }
}

function createNoopLogger() {
  return {
    info() {},
    warn() {},
    error() {},
  }
}

function createFileRecorder({ existingFiles = {} } = {}) {
  const writes = []
  const dirs = []
  return {
    writes,
    dirs,
    mkdirSync(dir,options) {
      dirs.push({ dir,options })
    },
    writeFileSync(file,content,encoding) {
      writes.push({ file,content,encoding })
    },
    existsSync(file) {
      return Object.prototype.hasOwnProperty.call(existingFiles,file)
    },
    readFileSync(file) {
      return existingFiles[file]
    },
  }
}

function createOctokitStub({ repos = [],commitsByRepo = {},diffsBySha = {} } = {}) {
  return {
    rest: {
      users: {
        async getAuthenticated() {
          return { data: { login: `jamie` } }
        },
      },
      repos: {
        async listCommits({ repo }) {
          return { data: commitsByRepo[repo] || [] }
        },
        async getCommit({ ref }) {
          return { data: diffsBySha[ref] || `diff --git a/file b/file` }
        },
      },
    },
    paginate: {
      iterator() {
        return (async function * iterator() {
          yield { data: repos }
        })()
      },
    },
  }
}

describe(`standup markdown validation`,() => {
  it(`accepts valid standup markdown`,() => {
    expect(validateStandupMarkdown(VALID_STANDUP_MARKDOWN)).to.equal(VALID_STANDUP_MARKDOWN)
  })

  it(`rejects missing Repositories`,() => {
    expect(() => validateStandupMarkdown(VALID_STANDUP_MARKDOWN.replace(`Repositories\nrepo-a\nrepo-b\n\n`,` `)))
      .to.throw(`must start with Repositories`)
  })

  it(`rejects missing Commits`,() => {
    expect(() => validateStandupMarkdown(VALID_STANDUP_MARKDOWN.replace(`\n\nCommits\nrepo-a\n  * Added onboarding flow\n\nrepo-b\n  * Fixed sync issue`,` `)))
      .to.throw(`must contain Repositories, Commits, Summary in order`)
  })

  it(`rejects missing Summary`,() => {
    expect(() => validateStandupMarkdown(VALID_STANDUP_MARKDOWN.replace(`\n\nSummary\nrepo-a\n    * Shipped onboarding improvements\n\nrepo-b\n    * (context) Cleaned up sync edge cases`,` `)))
      .to.throw(`must contain Repositories, Commits, Summary in order`)
  })

  it(`rejects reordered sections`,() => {
    const reordered = `Repositories
repo-a
repo-b

Summary
repo-a
    * Shipped onboarding improvements

repo-b
    * (context) Cleaned up sync edge cases

Commits
repo-a
  * Added onboarding flow

repo-b
  * Fixed sync issue`
    expect(() => validateStandupMarkdown(reordered))
      .to.throw(`must contain Repositories, Commits, Summary in order`)
  })

  it(`rejects preamble text`,() => {
    expect(() => validateStandupMarkdown(`Intro\n\n${VALID_STANDUP_MARKDOWN}`))
      .to.throw(`must start with Repositories`)
  })

  it(`allows a sources appendix when requested`,() => {
    const withAppendix = `${VALID_STANDUP_MARKDOWN}

---

**Sources (files read):**
- \`reports/daily-standup/standup-2026-03-05.md\``
    const { core,appendix } = splitSourcesAppendix(withAppendix)
    expect(validateStandupMarkdown(withAppendix,{ allowSourcesAppendix: true })).to.equal(VALID_STANDUP_MARKDOWN)
    expect(core).to.equal(VALID_STANDUP_MARKDOWN)
    expect(appendix).to.contain(`**Sources (files read):**`)
  })
})

describe(`daily standup report`,() => {
  it(`builds structured report input grouped by repo`,() => {
    const input = buildDailyReportInput([
      {
        repoName: `repo-a`,
        shortHash: `abc1234`,
        subject: `feature a`,
        timestamp: 2,
        standup: {
          category: `feature`,
          impact_score: 4,
          standupNotable: true,
          bullet_summary: `Shipped feature A`,
          reasoning: `important`,
        },
      },
      {
        repoName: `repo-b`,
        shortHash: `def5678`,
        subject: `fix b`,
        timestamp: 1,
        standup: {
          category: `bug fix`,
          impact_score: 3,
          standupNotable: true,
          bullet_summary: `Fixed bug B`,
          reasoning: `important`,
        },
      },
    ])

    expect(input.repositories.map(r => r.repoName)).to.deep.equal([`repo-a`,`repo-b`])
    expect(input.repositories[0].commits[0].bullet_summary).to.equal(`Shipped feature A`)
  })

  it(`includes structured JSON in the daily report prompt`,() => {
    const prompt = buildDailyReportPrompt({
      reportDate: `2026-03-09`,
      reportInput: { repositories: [{ repoName: `repo-a`,commits: [] }] },
    })
    expect(prompt).to.contain(`Report date: 2026-03-09`)
    expect(prompt).to.contain(`"repoName": "repo-a"`)
  })

  it(`emits the structured empty report when there are no commits`,async() => {
    const fsMod = createFileRecorder()
    let generateCalled = false
    const notes = await runDailyReport({
      env: {
        GITHUB_TOKEN: `token`,
        GITHUB_AUTHOR: `jamie`,
        REPORT_OUTPUT_PATH: `/tmp/daily.md`,
      },
      now: dayjs(`2026-03-09T08:00:00Z`),
      fsMod,
      octokitFactory: () => createOctokitStub({ repos: [] }),
      generateReport: async() => {
        generateCalled = true
        return VALID_STANDUP_MARKDOWN
      },
      sendEmailFn: async() => ({ skipped: true,reason: `test` }),
      logMod: createNoopLogger(),
    })

    expect(notes).to.equal(buildEmptyStandupReport())
    expect(generateCalled).to.equal(false)
    expect(fsMod.writes).to.have.length(1)
    expect(fsMod.writes[0].content).to.equal(buildEmptyStandupReport())
  })

  it(`fails the run and avoids writing or emailing when commit classification fails`,async() => {
    const fsMod = createFileRecorder()
    let emailed = false
    await expectRejects(
      () => runDailyReport({
        env: {
          GITHUB_TOKEN: `token`,
          GITHUB_AUTHOR: `jamie`,
          REPORT_OUTPUT_PATH: `/tmp/daily.md`,
        },
        now: dayjs(`2026-03-09T08:00:00Z`),
        fsMod,
        octokitFactory: () => createOctokitStub({
          repos: [
            {
              name: `repo-a`,
              updated_at: `2026-03-09T07:00:00Z`,
              owner: { login: `wakeflow` },
            },
          ],
          commitsByRepo: {
            'repo-a': [
              {
                sha: `abc1234567`,
                html_url: `https://example.com/commit/abc1234567`,
                commit: {
                  author: { name: `Jamie`,email: `jamie@example.com`,date: `2026-03-09T07:30:00Z` },
                  message: `Break things`,
                },
              },
            ],
          },
        }),
        classifyCommit: async() => {
          throw new Error(`classification failed`)
        },
        generateReport: async() => VALID_STANDUP_MARKDOWN,
        sendEmailFn: async() => {
          emailed = true
          return { sent: true,to: `jamie@wakeflow.io` }
        },
        logMod: createNoopLogger(),
      }),
      `classification failed`,
    )

    expect(fsMod.writes).to.have.length(0)
    expect(emailed).to.equal(false)
  })

  it(`fails the run and avoids writing or emailing when final markdown is invalid`,async() => {
    const fsMod = createFileRecorder()
    let emailed = false
    await expectRejects(
      () => runDailyReport({
        env: {
          GITHUB_TOKEN: `token`,
          GITHUB_AUTHOR: `jamie`,
          REPORT_OUTPUT_PATH: `/tmp/daily.md`,
        },
        now: dayjs(`2026-03-09T08:00:00Z`),
        fsMod,
        octokitFactory: () => createOctokitStub({
          repos: [
            {
              name: `repo-a`,
              updated_at: `2026-03-09T07:00:00Z`,
              owner: { login: `wakeflow` },
            },
          ],
          commitsByRepo: {
            'repo-a': [
              {
                sha: `abc1234567`,
                html_url: `https://example.com/commit/abc1234567`,
                commit: {
                  author: { name: `Jamie`,email: `jamie@example.com`,date: `2026-03-09T07:30:00Z` },
                  message: `Ship feature`,
                },
              },
            ],
          },
        }),
        classifyCommit: async() => ({
          category: `feature`,
          impact_score: 4,
          standupNotable: true,
          bullet_summary: `Shipped feature`,
          reasoning: `important`,
        }),
        generateReport: async() => `bad output`,
        sendEmailFn: async() => {
          emailed = true
          return { sent: true,to: `jamie@wakeflow.io` }
        },
        logMod: createNoopLogger(),
      }),
      `must start with Repositories`,
    )

    expect(fsMod.writes).to.have.length(0)
    expect(emailed).to.equal(false)
  })
})

describe(`weekly standup report`,() => {
  it(`builds the combined daily-markdown input`,() => {
    const combined = buildCombinedInput([
      { date: `2026-03-05`,content: VALID_STANDUP_MARKDOWN },
      { date: `2026-03-06`,content: buildEmptyStandupReport() },
    ])
    expect(combined).to.contain(`## Day: 2026-03-05`)
    expect(combined).to.contain(`## Day: 2026-03-06`)
  })

  it(`writes a weekly report with the sources appendix preserved`,async() => {
    const dailyFiles = {
      [`${process.cwd()}/reports/daily-standup/standup-2026-02-27.md`]: VALID_STANDUP_MARKDOWN,
      [`${process.cwd()}/reports/daily-standup/standup-2026-03-02.md`]: VALID_STANDUP_MARKDOWN,
      [`${process.cwd()}/reports/daily-standup/standup-2026-03-03.md`]: VALID_STANDUP_MARKDOWN,
      [`${process.cwd()}/reports/daily-standup/standup-2026-03-04.md`]: VALID_STANDUP_MARKDOWN,
      [`${process.cwd()}/reports/daily-standup/standup-2026-03-05.md`]: VALID_STANDUP_MARKDOWN,
    }
    const fsMod = createFileRecorder({ existingFiles: dailyFiles })

    const output = await runWeeklyReport({
      env: { WEEKLY_REPORT_OUTPUT_PATH: `/tmp/weekly.md` },
      now: dayjs(`2026-03-06T08:00:00Z`),
      fsMod,
      generateReport: async() => VALID_STANDUP_MARKDOWN,
      sendEmailFn: async() => ({ skipped: true,reason: `test` }),
      logMod: createNoopLogger(),
    })

    expect(output).to.contain(`**Sources (files read):**`)
    expect(output).to.contain(`reports/daily-standup/standup-2026-03-05.md`)
    expect(fsMod.writes).to.have.length(1)
  })

  it(`fails when no daily files are found`,async() => {
    await expectRejects(
      () => runWeeklyReport({
        env: { WEEKLY_REPORT_OUTPUT_PATH: `/tmp/weekly.md` },
        now: dayjs(`2026-03-06T08:00:00Z`),
        fsMod: createFileRecorder(),
        generateReport: async() => VALID_STANDUP_MARKDOWN,
        sendEmailFn: async() => ({ sent: true,to: `jamie@wakeflow.io` }),
        logMod: createNoopLogger(),
      }),
      `no daily standup files found`,
    )
  })

  it(`fails and avoids writing or emailing when weekly AI output is invalid`,async() => {
    const dailyFiles = {
      [`${process.cwd()}/reports/daily-standup/standup-2026-02-27.md`]: VALID_STANDUP_MARKDOWN,
      [`${process.cwd()}/reports/daily-standup/standup-2026-03-03.md`]: VALID_STANDUP_MARKDOWN,
      [`${process.cwd()}/reports/daily-standup/standup-2026-03-04.md`]: VALID_STANDUP_MARKDOWN,
      [`${process.cwd()}/reports/daily-standup/standup-2026-03-05.md`]: VALID_STANDUP_MARKDOWN,
    }
    const fsMod = createFileRecorder({ existingFiles: dailyFiles })
    let emailed = false

    await expectRejects(
      () => runWeeklyReport({
        env: { WEEKLY_REPORT_OUTPUT_PATH: `/tmp/weekly.md` },
        now: dayjs(`2026-03-06T08:00:00Z`),
        fsMod,
        generateReport: async() => `not valid`,
        sendEmailFn: async() => {
          emailed = true
          return { sent: true,to: `jamie@wakeflow.io` }
        },
        logMod: createNoopLogger(),
      }),
      `must start with Repositories`,
    )

    expect(fsMod.writes).to.have.length(0)
    expect(emailed).to.equal(false)
  })
})
