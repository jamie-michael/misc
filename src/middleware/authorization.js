import axios from 'axios'

import { NotAuthenticated } from "../lib/errors.js"

export const authorization = async(req,res,next) => {
  const { authorization } = req.headers
  if (!authorization || !authorization.includes(`Bearer `))
    throw new NotAuthenticated(`Please provide jwt in Authorization header`)

  const jwt = authorization.split(` `)[1]
  if(!jwt)
    throw new NotAuthenticated(`No Bearer token supplied. Please add an "Authorization" header with value "Bearer 1234" replacing 1234 with your access_token`)

  try {
    const { data } = await axios({
      method: `GET`,
      url: `https://tokens.wakeflow.io/verify`,
      headers: { Authorization: `Bearer ${jwt}` },
    })

    req.user = {
      id: data?.userId,
      email: data?.email,
    }
  }catch(err){
    throw new NotAuthenticated(`Your token could not be verified`)
  }

  next()
}