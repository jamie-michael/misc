import { expect } from 'chai'
import dayjs from 'dayjs'

import { getReportingWindowStart } from '../scripts/daily-standup-report.js'

describe(`getReportingWindowStart`,() => {
  it(`uses the previous business afternoon window on Monday`,() => {
    const now = dayjs(`2026-03-09T04:00:00Z`)

    expect(getReportingWindowStart(now).toISOString()).to.equal(`2026-03-06T04:00:00.000Z`)
  })

  it(`uses the previous 24 hours on non-Mondays`,() => {
    const now = dayjs(`2026-03-10T03:00:00Z`)

    expect(getReportingWindowStart(now).toISOString()).to.equal(`2026-03-09T03:00:00.000Z`)
  })
})
