import * as core from '@actions/core'
import {archive} from './service'

async function run(): Promise<void> {
  const token: string = core.getInput('token')
  const repository: string = core.getInput('repository')
  const output: string = core.getInput('output') || '/'
  const [owner, repo] = repository.split('/')

  await archive({token, owner, repo, output})
}

run()
