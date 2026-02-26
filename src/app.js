import 'dotenv/config'
import express from 'express'

import log from './lib/logger.js'
import { authorization } from './middleware/authorization.js'
import { errorHandler } from './middleware/errorHandler.js'
import { callFunction } from './routes/callFunction.js'
import { errorExample } from './routes/errorExample.js'
import { helloWorld } from './routes/helloWorld.js'


export const app = express()
app.use(express.json())
app.use(log.request())

app.get(`/hello`,helloWorld)
app.use(authorization)
app.post(`/url`,callFunction)
app.get(`/error`,errorExample)

app.use(errorHandler)