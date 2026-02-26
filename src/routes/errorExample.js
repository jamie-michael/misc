import { BadRequest } from "../lib/errors.js"

export const errorExample = async(req,res) => {
  throw new BadRequest(`This is an example error`)
}