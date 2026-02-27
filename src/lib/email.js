import axios from 'axios'

const WAKEFLOW_EMAIL_URL = `https://emails.wakeflow.io`

function escapeHtml(text) {
  if (typeof text !== `string`) return ``
  return text
    .replace(/&/g,`&amp;`)
    .replace(/</g,`&lt;`)
    .replace(/>/g,`&gt;`)
    .replace(/"/g,`&quot;`)
}

export async function sendEmail({ subject = ``,body = ``,to = ``,from = ``,bodyIsHtml = false }) {
  try {
    const token = process.env.WAKEFLOW_TOKEN
    console.log(`token`,token)
    if (!token)
      return { skipped: true,reason: `WAKEFLOW_TOKEN not set` }


    const emailTo = `jamie@wakeflow.io`
    const emailFrom = `jamie@wakeflow.io`
    const emailHtml = bodyIsHtml ? body : `<pre style="white-space: pre-wrap; font-family: sans-serif;">${escapeHtml(body)}</pre>`
    const config = {
      method: `POST`,
      url: WAKEFLOW_EMAIL_URL,
      headers: { Authorization: `Bearer ${token}` },
      data: {
        to: emailTo,
        from: emailFrom,
        subject,
        body: emailHtml,
      },
    }
    console.log(`config`,config)
    await axios(config)

    return { sent: true,to: emailTo }
  } catch (error) {
    const status = error.response?.status
    const reason = status === 401
      ? `Email failed: 401 Unauthorized — check WAKEFLOW_TOKEN is valid`
      : `Email failed: ${error.message}${status ? ` (${status})` : ``}`
    return { skipped: true,reason }
  }
}

export default { sendEmail }
