export interface Comment {
  title: string
  content: string
}

export interface Issue {
  title: string
  comments: Comment[]
}

export interface Tree {
  sha: string
  tree: {
    path: string
    mode: '100644' | '040000'
    type: 'blob' | 'tree'
    sha: string | null
  }[]
}

export interface TreeMap {
  [dir: string]: {
    sha: string
    files: {name: string; sha: string}[]
  }
}
