import * as core from '@actions/core'
import {persist} from './service'

async function run(): Promise<void> {
  // const token: string = core.getInput('token')
  // const repository: string = core.getInput('repository')
  const repository = 'zhengjitf/test'
  const [owner, repo] = repository.split('/')

  await persist('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', owner, repo)
}

run()
