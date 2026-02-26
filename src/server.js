import os from 'os'

import chalk from 'chalk'

import { app } from './app.js'

const PORT = process.env.PORT ?? 3051

app.listen(PORT,`0.0.0.0`,() => {
  const localIP = getLocalIP()
  console.log(chalk.cyan.bold(`Server running at:`))
  console.log(chalk.greenBright(`- Local:           `) + chalk.whiteBright(`http://localhost:${PORT}`))
  console.log(chalk.greenBright(`- On Your Network: `) + chalk.whiteBright(`http://${localIP}:${PORT}`))
  console.log(chalk.magentaBright(`Documentation available at `) + chalk.underline(`http://localhost:${PORT}/docs`))
  console.log(chalk.yellow.bold(`Press Ctrl+C to quit.`))
})

const getLocalIP = () => {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces))
    for (const iface of interfaces[name])
      if (iface.family === `IPv4` && !iface.internal)
        return iface.address

  return `localhost`
}