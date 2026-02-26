import { expect,use } from 'chai'
import chaiHttp from 'chai-http'

import { app } from '../app.js'

const chai = use(chaiHttp)
const request = chai.request.execute
chai.should()

describe(`hello world`,() => {

  it(`says hello world`,async() => {
    const response = await request(app).get(`/hello`)
    const { hello } = response.body
    expect(hello).to.equal(`world`)
  })
})
