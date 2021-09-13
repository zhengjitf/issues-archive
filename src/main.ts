import * as core from '@actions/core'
import {persist} from './service'

async function run(): Promise<void> {
  const token: string = core.getInput('token')
  const repository: string = core.getInput('repository')
  const [owner, repo] = repository.split('/')

  await persist(token, owner, repo)
}

run()
