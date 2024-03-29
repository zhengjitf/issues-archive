import pathUtils from 'path'
import * as github from '@actions/github'
import parseLink from 'parse-link-header'
import {parseBody, tryCatch} from './utils'
import {Issue, TreeMap, Comment, Tree} from './types'

export class GitService {
  owner
  repo
  octokit
  constructor({
    token,
    owner,
    repo
  }: {
    token: string
    owner: string
    repo: string
  }) {
    this.owner = owner
    this.repo = repo
    this.octokit = github.getOctokit(token)
  }
  public createBlob(content: string | Record<string, any>) {
    return this.octokit.rest.git.createBlob({
      owner: this.owner,
      repo: this.repo,
      content: typeof content === 'string' ? content : JSON.stringify(content)
    })
  }

  public createOrUpdateFileContents({
    path,
    content,
    message
  }: {
    path: string
    content: string | object
    message: string
  }) {
    return this.octokit.rest.repos.createOrUpdateFileContents({
      owner: this.owner,
      repo: this.repo,
      path,
      message,
      content: Buffer.from(JSON.stringify(content)).toString('base64')
    })
  }

  public createTree({
    base_tree,
    tree
  }: {
    tree: Tree['tree']
    base_tree: string
  }) {
    return this.octokit.rest.git.createTree({
      owner: this.owner,
      repo: this.repo,
      tree,
      base_tree
    })
  }

  public createCommit({
    treeSha,
    parentSha,
    message
  }: {
    treeSha: string
    parentSha: string
    message: string
  }) {
    return this.octokit.rest.git.createCommit({
      owner: this.owner,
      repo: this.repo,
      message,
      tree: treeSha,
      parents: parentSha ? [parentSha] : undefined
    })
  }

  public updateRef(commitSha: string, ref = 'heads/main') {
    return this.octokit.rest.git.updateRef({
      ref,
      owner: this.owner,
      repo: this.repo,
      sha: commitSha,
      force: true
    })
  }

  public getRef(ref = 'heads/main') {
    return this.octokit.rest.git.getRef({
      owner: this.owner,
      repo: this.repo,
      ref
    })
  }
}

export const getIssues = async (
  token: string,
  owner: string,
  repo: string
): Promise<Issue[]> => {
  const octokit = github.getOctokit(token)

  // 获取 issues 条数
  const {
    headers: {link},
    data: {length}
  } = await octokit.rest.issues.listForRepo({
    owner,
    repo,
    per_page: 1
  })
  const total = (() => {
    if (link) {
      return +parseLink(link)!.last!.page || 0
    }

    return length
  })()

  // 每页 10 条，并发获取所有数据
  const issuesGroup = await Promise.all(
    Array.from({length: Math.ceil(total / 10)}, async (_, index) => {
      const {data: list} = await octokit.rest.issues.listForRepo({
        owner,
        repo,
        per_page: 10,
        page: index + 1
      })

      const issues: Issue[] = await Promise.all(
        list.map(async ({number: issue_number, title, body: issueBody}) => {
          const {data} = await octokit.rest.issues.listComments({
            owner,
            repo,
            issue_number
          })

          const bodies: string[] = [issueBody!]
            .concat(data.map(({body}) => body!))
            .filter(Boolean)
          const comments = bodies.map(parseBody)

          return {
            title,
            comments
          }
        })
      )

      return issues
    })
  )

  return issuesGroup.reduce((sum, group) => [...sum, ...group], [])
}

export const getTree = async (token: string, owner: string, repo: string) => {
  const octokit = github.getOctokit(token)

  const {data: commits} = await octokit.rest.repos.listCommits({
    owner,
    repo
  })

  const commit = commits[0]

  const {
    commit: {
      tree: {sha: tree_sha}
    },
    sha: commit_sha
  } = commit

  try {
    // TIPS: 当为空时，会报错
    const {
      data: {tree}
    } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha,
      recursive: 'true'
    })

    return {
      tree_sha,
      commit_sha,
      tree
    }
  } catch {
    return {
      tree_sha,
      commit_sha,
      tree: []
    }
  }
}

export interface ArchiveOptions {
  token: string
  owner: string
  repo: string
  output: string
}
export const archive = async ({token, owner, repo, output}: ArchiveOptions) => {
  const relativePath = (resolvedPath: string) => {
    return pathUtils.relative(output, pathUtils.resolve('/', resolvedPath))
  }
  const resolvePath = (relativedPath: string) => {
    return pathUtils.relative('/', pathUtils.join(output, relativedPath))
  }

  const gitService = new GitService({
    token,
    owner,
    repo
  })

  let tree_sha: undefined | string = undefined
  let commit_sha: undefined | string = undefined
  const removeds: Tree['tree'] = []
  const updates: Tree['tree'] = []
  const creates: Tree['tree'] = []

  // 1. get a reference
  const [err] = await tryCatch(gitService.getRef())

  if (err) {
    await gitService.createOrUpdateFileContents({
      path: 'README.md',
      message: 'chore: init',
      content: ''
    })
  }
  // 2. 获取当前仓库文件
  const treeData = await getTree(token, owner, repo)
  tree_sha = treeData.tree_sha
  commit_sha = treeData.commit_sha
  const {tree} = treeData

  const treeMap = tree
    // TODO:
    .filter(item => pathUtils.resolve('/', item.path!).indexOf(output) === 0)
    .map(item => ({
      ...item,
      path: relativePath(item.path!)
    }))
    .reduce((map, item) => {
      // 忽略 .开头的目录
      if (item.path[0] === '.') {
        return map
      }

      if (item.type === 'tree') {
        // 文件夹
        map[item.path] = {
          sha: item.sha!,
          files: []
        }
      } else if (item.type === 'blob') {
        // 文件
        const [dir, filename] = item.path?.split('/') || []
        // TIPS: 忽略根路径下的文件及非 .md 后缀的文件
        if (filename && filename.match(/^(.+)\.md$/)) {
          map[dir].files.push({
            name: filename.match(/^(.+)\.md$/)![1],
            sha: item.sha!
          })
        }
      }

      return map
    }, {} as TreeMap)

  // 3. 要存储的 issues
  const issues = await getIssues(token, owner, repo)
  const issuesMap = issues.reduce((map, item) => {
    map[item.title] = item.comments
    return map
  }, {} as {[title: string]: Comment[]})

  for (const [dir, {files}] of Object.entries(treeMap)) {
    const comments = issuesMap[dir]

    // 要删除的文件夹
    if (!comments) {
      // TIPS: 删除目录下的所有文件，文件夹会被一起删除
      for (const {name} of files) {
        removeds.push({
          path: resolvePath(`${dir}/${name}.md`),
          mode: '100644',
          sha: null,
          type: 'blob'
        })
      }

      continue
    }

    delete issuesMap[dir]

    const commentsMap = comments.reduce((map, item) => {
      map[item.title] = item.content
      return map
    }, {} as {[title: string]: string})

    for (const file of files) {
      const comment = commentsMap[file.name]

      // 要删除的文件
      if (!comment) {
        removeds.push({
          path: resolvePath(`${dir}/${file.name}.md`),
          mode: '100644',
          sha: null,
          type: 'blob'
        })

        continue
      }

      delete commentsMap[file.name]

      const {data: blob} = await gitService.createBlob(comment)
      // 要更新的文件
      if (blob.sha !== file.sha) {
        updates.push({
          path: resolvePath(`${dir}/${file.name}.md`),
          mode: '100644',
          sha: blob.sha,
          type: 'blob'
        })
      }
    }

    // 要新增的文件
    for (const [title, content] of Object.entries(commentsMap)) {
      const {data: blob} = await gitService.createBlob(content)

      creates.push({
        path: resolvePath(`${dir}/${title}.md`),
        mode: '100644',
        sha: blob.sha,
        type: 'blob'
      })
    }
  }

  // 要新增的文件
  for (const [issueTitle, comments] of Object.entries(issuesMap)) {
    // TIPS: 不用单独新建文件夹
    for (const {title, content} of comments) {
      const {data: blob} = await gitService.createBlob(content)
      creates.push({
        path: resolvePath(`${issueTitle}/${title}.md`),
        mode: '100644',
        sha: blob.sha,
        type: 'blob'
      })
    }
  }

  const effects = [...removeds, ...updates, ...creates]

  if (effects.length === 0) {
    console.log('无更新')
    return
  }

  const newTree = await gitService.createTree({
    tree: effects,
    base_tree: tree_sha
  })

  // commit
  const commit = await gitService.createCommit({
    message: 'update',
    treeSha: newTree.data.sha,
    parentSha: commit_sha
  })

  await gitService.updateRef(commit.data.sha)
}
