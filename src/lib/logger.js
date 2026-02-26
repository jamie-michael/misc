import chalk from 'chalk'

/**
 * Get the current timestamp in ISO format.
 * @returns {string} ISO timestamp string
 */
function timestamp() {
  return new Date().toISOString()
}

/**
 * Core logging function.
 * @param {string} level - Log level (info, warn, error, etc.)
 * @param {function(string): string} colourFn - Chalk function to style the level label
 * @param {string} message - The main log message
 * @param {...any} args - Additional values to log
 */
function logfn(level,colourFn,message,...args) {
  console.log(
    chalk.grey(`[${timestamp()}]`),
    colourFn(level.toUpperCase().padEnd(5)),
    message,
    ...args,
  )
}

/**
 * Log an informational message.
 * @param {string} message - Info message
 * @param {...any} args - Additional info values
 */
export function info(message,...args) {
  logfn(`info`,chalk.cyan,message,...args)
}

/**
 * Log a warning message.
 * @param {string} message - Warning message
 * @param {...any} args - Additional warning values
 */
export function warn(message,...args) {
  logfn(`warn`,chalk.yellow,message,...args)
}

/**
 * Log an error message.
 * @param {string} message - Error message
 * @param {...any} args - Additional error values
 */
export function error(message,...args) {
  logfn(`error`,chalk.red,message,...args)
}

/**
 * Express middleware to log HTTP requests.
 * Logs method, URL, status code, user info, and duration.
 * @returns {import('express').RequestHandler} Express middleware function
 */
export function request() {
  return (req,res,next) => {
    const start = process.hrtime.bigint()

    res.once(`finish`,() => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6
      const statusColour =
        res.statusCode < 400
          ? chalk.green
          : res.statusCode < 500
            ? chalk.yellow
            : chalk.red

      const userTag = req.user
        ? chalk.magenta(`[user:${req.user?.email || req.user?.id}]`)
        : chalk.dim(`[guest]`)

      const captchaTag = req.captcha?.valid
        ? chalk.green(`[captcha:${req.captcha.score.toFixed(5)}]`)
        : req.captcha?.valid === false
          ? chalk.red(`[captcha:${req.captcha.score.toFixed(5)}]`)
          : ``

      console.log(
        chalk.grey(`[${timestamp()}]`),
        statusColour(req.method).padEnd(5),
        statusColour(res.statusCode),
        chalk.whiteBright(req.originalUrl),
        userTag,
        captchaTag,
        chalk.dim(`${durationMs.toFixed(2)}ms`),
      )
    })

    next()
  }
}

const log = {
  info,
  warn,
  error,
  request,
}

export default log