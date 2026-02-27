import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: process.env.ENV_FILE || '.env' })
import dayjs from 'dayjs'
import { run } from '../src/commits-report.js'

const outputPath = path.join(process.cwd(), 'standups', `standup-${dayjs().format('YYYY-MM-DD')}.md`)
process.env.REPORT_OUTPUT_PATH = outputPath

await run()
