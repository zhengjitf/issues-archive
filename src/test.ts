import {archive} from './service'

async function run(): Promise<void> {
  await archive({
    token: process.env.GITHUB_TOKEN!,
    owner: process.env.GITHUB_REPO!.split('/')[0],
    repo: process.env.GITHUB_REPO!.split('/')[1],
    output: '/'
  })
}
run()
