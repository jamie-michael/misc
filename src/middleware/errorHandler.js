export const errorHandler = async(err,req,res,next) => {
  console.log(err)
  res.status(err.statusCode || 500).send({ error: err.message })
}
